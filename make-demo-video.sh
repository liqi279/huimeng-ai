#!/bin/bash
# 上色模块演示视频合成脚本
set -e

SNAP=/data/tool/browser_snapshots
FONT=/usr/share/fonts/opentype/noto-cjk-otf/NotoSansCJKsc-Regular.otf
OUT=/workspace/anidream/paint-demo.mp4
TMPDIR=$(mktemp -d)

# 每张截图的字幕文字
declare -a CAPTIONS=(
  "绘梦 AI · 上色模块演示"
  "第1步：导入线稿（自动去除白底）"
  "第2步：选择肌肤色 · 油漆桶填充脸部"
  "第3步：选择头发色 · 填充头发区域"
  "第4步：依次填充衣服 · 眼白 · 瞳孔"
  "第5步：色指定表自动统计颜色使用次数"
)

# 生成每张图的视频片段（带字幕 + 淡入淡出）
for i in 1 2 3 4 5 6; do
  idx=$((i-1))
  img=$(ls $SNAP/paint-0${i}-*.png | head -1)
  caption="${CAPTIONS[$idx]}"
  duration=3

  ffmpeg -y -loop 1 -i "$img" -t $duration \
    -vf "scale=900:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#1a1a2e, \
         drawtext=fontfile=$FONT:text='$caption':fontcolor=white:fontsize=36: \
         x=(w-text_w)/2:y=h-90:shadowcolor=black:shadowx=2:shadowy=2, \
         fade=t=in:st=0:d=0.5,fade=t=out:st=$((duration-1)):d=0.8" \
    -c:v libx264 -pix_fmt yuv420p -r 30 \
    "$TMPDIR/seg${i}.mp4" 2>/dev/null

  echo "片段 $i 完成: $caption"
done

# 生成片段列表
for i in 1 2 3 4 5 6; do
  echo "file '$TMPDIR/seg${i}.mp4'" >> "$TMPDIR/list.txt"
done

# 合并所有片段
ffmpeg -y -f concat -safe 0 -i "$TMPDIR/list.txt" -c copy "$OUT" 2>/dev/null

# 清理
rm -rf "$TMPDIR"

echo "视频已生成: $OUT"
ls -lh "$OUT"
