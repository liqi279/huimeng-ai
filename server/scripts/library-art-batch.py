#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
原画资料批量入库：解压 -> 图片转 PDF（长边2000/JPEG70）-> 超70MB分卷 -> 传 COS -> 写书目。
按目录逐个执行，可重复运行（同 category+title 已存在则跳过）。

用法：
  python art_upload.py --dir "东京残响"            # 只规划，不写库
  python art_upload.py --dir "东京残响" --apply     # 实际解压/上传/写库
  python art_upload.py --inventory                  # 盘点剩余目录与体积

口令：环境变量 ART_7Z_PASS（仅本次进程内存中使用，不落盘）
密钥：环境变量 COS_SECRET_ID / COS_SECRET_KEY（官方 SDK 读取，不打印）
"""
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image
from qcloud_cos import CosConfig, CosS3Client

ROOT = os.environ.get("ART_ROOT", r"E:\藏书阁（暂）\原画资料\动画原画线稿资料库【日式】")
WORK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_work")
BACKUP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backup")
SEVEN_ZIP = os.environ.get("SEVEN_ZIP", r"C:\Program Files\NVIDIA Corporation\NVIDIA App\7z.exe")

API_BASE = "https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com"
BUCKET = "huimeng-1527498271"
REGION = "ap-guangzhou"
ASSET_HOST = "https://%s.cos.%s.myqcloud.com" % (BUCKET, REGION)

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
ARC_EXT = {".zip", ".7z", ".rar"}
MAX_EDGE = 2000
JPEG_Q = 70
COVER_W = 900
COVER_Q = 85
TARGET = 68 * 1024 * 1024  # 分卷目标上限，低于 70MB 留余量


def log(msg):
    print(msg, flush=True)


def human(n):
    return "%.1f MB" % (n / 1048576.0)


def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def sevenzip():
    if os.path.exists(SEVEN_ZIP):
        return SEVEN_ZIP
    for p in (r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe", "7z"):
        if p == "7z" or os.path.exists(p):
            return p
    raise SystemExit("找不到 7z 可执行文件")


def extract(archive, out_dir, password):
    os.makedirs(out_dir, exist_ok=True)
    args = [sevenzip(), "x", archive, "-o" + out_dir, "-y", "-bd", "-bso0", "-bsp0"]
    if password:
        args.append("-p" + password)
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode not in (0, 1):
        err = (p.stderr or b"").decode("utf-8", "replace")[-300:]
        raise RuntimeError("解压失败 rc=%s %s" % (p.returncode, err.strip()))
    return p.returncode


def collect_images(root):
    out = []
    for base, _dirs, names in os.walk(root):
        for n in names:
            if os.path.splitext(n)[1].lower() in IMG_EXT:
                out.append(os.path.join(base, n))
    out.sort(key=lambda p: natkey(os.path.relpath(p, root)))
    return out


def nested_extract(root, password, depth=0):
    """把解压出来的嵌套压缩包继续展开（最多两层），返回被展开的包数量。"""
    if depth >= 2:
        return 0
    count = 0
    for base, _dirs, names in list(os.walk(root)):
        for n in names:
            if os.path.splitext(n)[1].lower() not in ARC_EXT:
                continue
            arc = os.path.join(base, n)
            out = os.path.join(base, os.path.splitext(n)[0] + "_x")
            try:
                extract(arc, out, password)
                count += 1
                os.remove(arc)
                count += nested_extract(out, password, depth + 1)
            except Exception as e:
                log("  嵌套解压失败 %s: %s" % (n, e))
    return count


def load_page(path):
    im = Image.open(path)
    im.load()
    if im.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        rgba = im.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    w, h = im.size
    scale = min(1.0, float(MAX_EDGE) / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=JPEG_Q, optimize=True)
    return buf.getvalue(), im.size


def write_pdf(pages, out_path):
    """pages: [(jpeg_bytes, (w,h))] — 直接嵌入 JPEG 流，不再二次压缩。"""
    chunks = [b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]
    offsets = [0]

    def add(obj):
        offsets.append(sum(len(c) for c in chunks))
        chunks.append(obj)

    # 1 catalog / 2 pages 占位，稍后按真实 id 回填
    ids = []
    nid = 3
    for _ in pages:
        ids.append((nid, nid + 1, nid + 2))
        nid += 3

    add(b"<< /Type /Catalog /Pages 2 0 R >>\n")
    kids = " ".join("%d 0 R" % a for a, _b, _c in ids)
    add(("<< /Type /Pages /Kids [%s] /Count %d >>\n" % (kids, len(pages))).encode())

    for (jpg, (w, h)), (page_id, content_id, img_id) in zip(pages, ids):
        pw = max(1, int(round(w * 72.0 / 150.0)))
        ph = max(1, int(round(h * 72.0 / 150.0)))
        content = ("q\n%d 0 0 %d 0 0 cm\n/Im0 Do\nQ\n" % (pw, ph)).encode()
        add(("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>\n"
             % (pw, ph, img_id, content_id)).encode())
        add(("<< /Length %d >>\nstream\n" % len(content)).encode() + content + b"\nendstream\n")
        add(("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
             % (w, h, len(jpg))).encode() + jpg + b"\nendstream\n")

    xref_pos = sum(len(c) for c in chunks)
    total = len(offsets)
    xref = ["xref\n0 %d\n" % total, "0000000000 65535 f \n"]
    for off in offsets[1:]:
        xref.append("%010d 00000 n \n" % off)
    trailer = ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (total, xref_pos)).encode()
    with open(out_path, "wb") as f:
        for c in chunks:
            f.write(c)
        f.write("".join(xref).encode())
        f.write(trailer)


def jpeg_cover(page, out_path):
    jpg, _size = page
    im = Image.open(io.BytesIO(jpg))
    w, h = im.size
    nw = min(COVER_W, w)
    nh = max(1, int(round(h * nw / float(w))))
    im = im.resize((nw, nh), Image.LANCZOS)
    im.save(out_path, "JPEG", quality=COVER_Q, optimize=True)


def cos_client():
    cfg = CosConfig(Region=REGION, SecretId=os.environ["COS_SECRET_ID"],
                    SecretKey=os.environ["COS_SECRET_KEY"], Scheme="https")
    return CosS3Client(cfg)


def http_json(url, payload=None, method=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def clean_name(name):
    s = os.path.splitext(name)[0]
    s = re.sub(r"^(\[[^\]]*\]|\【[^】]*\】)\s*", "", s)
    s = re.sub(r"\s*(\[[^\]]*\]|\【[^】]*\】)\s*$", "", s)
    s = re.sub(r"^\[\d{8}\]", "", s).strip()
    return s or os.path.splitext(name)[0]


def safe_slug(text, limit=40):
    s = re.sub(r"[^0-9A-Za-z]+", "-", text).strip("-").lower()
    if len(s) < 3:
        s = "art-" + hashlib.md5(text.encode("utf-8")).hexdigest()[:10]
    return s[:limit]


def list_units(author_dir):
    """返回 [(unit_name, [archives], [loose_image_dirs])]"""
    units = []
    entries = sorted(os.listdir(author_dir))
    for ent in entries:
        p = os.path.join(author_dir, ent)
        if not os.path.isdir(p):
            if os.path.splitext(ent)[1].lower() in ARC_EXT:
                units.append((clean_name(ent), [p], []))
            continue
        arcs, loose = [], []
        for base, _dirs, names in os.walk(p):
            for n in names:
                fp = os.path.join(base, n)
                if os.path.splitext(n)[1].lower() in ARC_EXT:
                    arcs.append(fp)
                elif os.path.splitext(n)[1].lower() in IMG_EXT:
                    loose.append(fp)
        if arcs:
            groups = {}
            for a in arcs:
                key = re.sub(r"\s*(\(\d+\)|- 副本|副本)$", "", os.path.splitext(os.path.basename(a))[0])
                groups.setdefault(key, []).append(a)
            if len(groups) == 1:
                units.append((ent, list(groups.values())[0], []))
            else:
                for key, files in groups.items():
                    units.append((clean_name(key), files, []))
        elif loose:
            units.append((ent, [], [p]))
    return units


def build_books(unit_name, images, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    pages = []
    for p in images:
        try:
            pages.append(load_page(p))
        except Exception as e:
            log("  跳过图片 %s: %s" % (os.path.basename(p), e))
    if not pages:
        raise RuntimeError("没有可解码的图片")

    parts, cur, cur_bytes = [], [], 0
    for pg in pages:
        n = len(pg[0])
        if cur and cur_bytes + n > TARGET:
            parts.append(cur)
            cur, cur_bytes = [], 0
        cur.append(pg)
        cur_bytes += n
    if cur:
        parts.append(cur)

    out = []
    total = len(pages)
    start = 1
    for i, part in enumerate(parts, 1):
        suffix = ""
        if len(parts) > 1:
            suffix = " · " + ("上中下"[i - 1] if len(parts) <= 3 else "第%d卷" % i)
        name = safe_slug(re.sub(r"\s+", "-", unit_name)) + "-%02d" % i
        pdf_path = os.path.join(out_dir, name + ".pdf")
        cover_path = os.path.join(out_dir, name + ".jpg")
        write_pdf(part, pdf_path)
        jpeg_cover(part[0], cover_path)
        out.append({
            "title_suffix": unit_name + suffix,
            "pdf": pdf_path,
            "cover": cover_path,
            "pages": len(part),
            "start": start,
            "total": total,
            "parts": len(parts),
            "index": i,
        })
        start += len(part)
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out


def snapshot(cos):
    data = http_json(API_BASE + "/api/library/books")
    items = data.get("items", [])
    areas = {}
    for b in items:
        areas[b.get("area") or "unknown"] = areas.get(b.get("area") or "unknown", 0) + 1
    snap = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": "scf-library",
        "total": len(items),
        "areas": areas,
        "books": items,
    }
    os.makedirs(BACKUP, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    local = os.path.join(BACKUP, "library-snapshot-%s.json" % stamp)
    raw = json.dumps(snap, ensure_ascii=False, indent=2).encode("utf-8")
    with open(local, "wb") as f:
        f.write(raw)
    key = "library/_snapshots/library-snapshot-%s.json" % stamp
    cos.put_object(Bucket=BUCKET, Body=raw, Key=key, ContentType="application/json")
    return {"local": local, "cos": key, "total": len(items), "areas": areas, "bytes": len(raw)}


def run_dir(author, apply, reuse=False):
    author_dir = os.path.join(ROOT, author) if not os.path.isabs(author) else author
    if not os.path.isdir(author_dir):
        raise SystemExit("目录不存在: " + author_dir)
    password = os.environ.get("ART_7Z_PASS", "")
    if not password:
        raise SystemExit("缺少 ART_7Z_PASS（解压口令只从环境变量传入）")

    existing = http_json(API_BASE + "/api/library/books").get("items", [])
    have = set((b.get("category") or "", b.get("title") or "") for b in existing)

    units = list_units(author_dir)
    log("== %s：%d 个子项" % (author, len(units)))
    work_dir = os.path.join(WORK, safe_slug(author) or "author")
    os.makedirs(work_dir, exist_ok=True)
    cos = cos_client() if apply else None
    stamp = time.strftime("%Y%m%d")
    made = []

    seen = {}
    for unit_name, archives, loose_dirs in units:
        log("-- 子项：%s（%d 个包）" % (unit_name, len(archives)))
        if archives:
            archive = archives[0]
            if len(archives) > 1:
                sizes = sorted(set(os.path.getsize(a) for a in archives))
                log("   同名副本 %d 个，体积集合 %s" % (len(archives), sizes))
            extract_dir = os.path.join(work_dir, safe_slug(unit_name))
            if reuse and os.path.isdir(extract_dir) and os.listdir(extract_dir):
                log("   复用已解压目录")
            else:
                if os.path.isdir(extract_dir):
                    shutil.rmtree(extract_dir)
                log("   解压 %s（%s）" % (os.path.basename(archive), human(os.path.getsize(archive))))
                extract(archive, extract_dir, password)
                n = nested_extract(extract_dir, password)
                if n:
                    log("   嵌套解包 %d 个" % n)
            images = collect_images(extract_dir)
        else:
            images = collect_images(loose_dirs[0])
            extract_dir = loose_dirs[0]
        log("   图片 %d 张" % len(images))
        if not images:
            continue
        sig = (sum(os.path.getsize(p) for p in images), len(images))
        if sig in seen:
            log("   与「%s」体积+页数一致，判定副本，跳过" % seen[sig])
            continue
        seen[sig] = unit_name

        pdf_dir = os.path.join(work_dir, "pdf", safe_slug(unit_name))
        manifest = os.path.join(pdf_dir, "manifest.json")
        if reuse and os.path.exists(manifest):
            with open(manifest, encoding="utf-8") as f:
                books = json.load(f)
        else:
            books = build_books(unit_name, images, pdf_dir)
        for b in books:
            title = "%s · %s" % (author, b["title_suffix"])
            size = os.path.getsize(b["pdf"])
            log("   PDF %s：%d 页 / %s" % (b["title_suffix"], b["pages"], human(size)))
            if (author, title) in have:
                log("   已存在同名单册，跳过上传")
                continue
            if not apply:
                continue
            uniq = hashlib.md5((author + "/" + unit_name).encode("utf-8")).hexdigest()[:12]
            key_pdf = "library/books/%s-%s-%s-%02d.pdf" % (safe_slug(unit_name), uniq, stamp, b["index"])
            key_jpg = "library/covers/%s-%s-%s-%02d.jpg" % (safe_slug(unit_name), uniq, stamp, b["index"])
            with open(b["pdf"], "rb") as f:
                cos.put_object(Bucket=BUCKET, Body=f, Key=key_pdf, ContentType="application/pdf")
            with open(b["cover"], "rb") as f:
                cos.put_object(Bucket=BUCKET, Body=f, Key=key_jpg, ContentType="image/jpeg")
            intro = "来源：本机原画资料《%s》；原包《%s》。第 %d-%d 页（共 %d 页%s）。" % (
                author, unit_name, b["start"], b["start"] + b["pages"] - 1, b["total"],
                "，分 %d 卷" % b["parts"] if b["parts"] > 1 else "")
            book = {
                "title": title,
                "author": "萌绘图库",
                "category": author,
                "tags": [author, "原画资料", "原画集"],
                "intro": intro,
                "area": "concept",
                "pageCount": b["pages"],
                "toc": [],
                "pdfUrl": API_BASE + "/api/library/file/" + key_pdf,
                "coverUrl": ASSET_HOST + "/" + key_jpg,
            }
            res = http_json(API_BASE + "/api/library/books", book)
            got = res.get("book") or {}
            log("   入库 id=%s 标题=%s" % (got.get("id"), got.get("title")))
            made.append(got.get("id"))
            have.add((author, title))

    if apply:
        snap = snapshot(cos)
        log("快照：本机 %s（%d 册，%s）" % (snap["local"], snap["total"], snap["areas"]))
        log("快照：COS %s（%s）" % (snap["cos"], human(snap["bytes"])))
        shutil.rmtree(work_dir, ignore_errors=True)
    return made


def inventory():
    rows = []
    for name in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, name)
        if not os.path.isdir(p):
            continue
        size = 0
        for base, _d, names in os.walk(p):
            for n in names:
                try:
                    size += os.path.getsize(os.path.join(base, n))
                except OSError:
                    pass
        rows.append((size, name))
    rows.sort()
    for size, name in rows:
        log("%-42s %8.1f MB" % (name, size / 1048576.0))
    log("合计 %d 个目录 / %.1f GB" % (len(rows), sum(r[0] for r in rows) / 1073741824.0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--reuse", action="store_true")
    ap.add_argument("--inventory", action="store_true")
    a = ap.parse_args()
    if a.inventory:
        inventory()
        return
    if not a.dir:
        raise SystemExit("需要 --dir 或 --inventory")
    run_dir(a.dir, a.apply, a.reuse)


if __name__ == "__main__":
    main()
