'use strict';

/* =============================================================
 * 桌面文档合并器（folders / stacks / assigns / names / positions）
 * -------------------------------------------------------------
 * 背景：同一账号可能在两台电脑上使用不同版本的前端，旧版只认识
 * folders（叠放是 mode:'stack' 的文件夹），新版用 stacks 表示叠放。
 * 之前 PUT /desk 是整包覆盖，任何一台设备保存都会把另一份实现的数据
 * （或另一台设备尚未拉到的文件夹）整段抹掉。
 *
 * 这里改成「写入时合并」：按 id 求并集 + 删除墓碑，任何客户端都无法
 * 通过提交旧快照删掉别人新建的文件夹/叠放/作品归属。
 * 不修改已有数据的语义：字段缺失时保留已存的值，旧文档无需迁移。
 * ============================================================= */

function num(v) { return Number(v) || 0; }

function folderTs(f) {
  return num(f && f.updatedAt) || num(f && f.createdAt);
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function mergeDesk(stored, incoming) {
  const oldDoc = asObject(stored);
  const newDoc = asObject(incoming);
  const oldTs = num(oldDoc.updatedAt);
  const newTs = num(newDoc.updatedAt);

  const out = {
    folders: [],
    stacks: [],
    positions: {},
    assigns: {},
    names: {},
    tombstones: {},
    updatedAt: Math.max(oldTs, newTs),
  };

  /* ---- 墓碑：同一个 id 取较晚的删除时间 ---- */
  const tombs = {};
  [oldDoc.tombstones, newDoc.tombstones].forEach((t) => {
    if (!t || typeof t !== 'object') return;
    Object.keys(t).forEach((k) => { tombs[k] = Math.max(num(tombs[k]), num(t[k])); });
  });

  /* ---- 文件夹：按 id 合并，较新的名字/父级覆盖旧的；缺 mode 时保留另一边的 ---- */
  const folderMap = {};
  const folderOrder = [];
  function addFolder(f) {
    if (!f || !f.id || !f.name) return;
    const id = String(f.id);
    const cur = folderMap[id];
    if (!cur) {
      folderMap[id] = Object.assign({}, f, { id });
      folderOrder.push(id);
      return;
    }
    const base = folderTs(f) > folderTs(cur)
      ? Object.assign({}, cur, f, { id })
      : Object.assign({}, f, cur, { id });
    if (!base.mode) base.mode = f.mode || cur.mode;
    if (!base.parentId) base.parentId = f.parentId || cur.parentId || null;
    folderMap[id] = base;
  }
  (Array.isArray(oldDoc.folders) ? oldDoc.folders : []).forEach(addFolder);
  (Array.isArray(newDoc.folders) ? newDoc.folders : []).forEach(addFolder);
  out.folders = folderOrder
    .map((id) => folderMap[id])
    .filter((f) => {
      const t = num(tombs[f.id]);
      return !(t && t >= folderTs(f));
    });

  /* ---- 叠放：按 id 合并，成员取并集（删除靠墓碑） ---- */
  const stackMap = {};
  const stackOrder = [];
  function addStack(s) {
    if (!s || !s.id) return;
    const id = String(s.id);
    const cur = stackMap[id];
    if (!cur) {
      stackMap[id] = Object.assign({}, s, {
        id,
        memberIds: Array.isArray(s.memberIds) ? s.memberIds.filter(Boolean) : [],
      });
      stackOrder.push(id);
      return;
    }
    if (!Array.isArray(cur.memberIds)) cur.memberIds = [];
    (Array.isArray(s.memberIds) ? s.memberIds : []).forEach((m) => {
      if (m && cur.memberIds.indexOf(m) < 0) cur.memberIds.push(m);
    });
    if (num(s.updatedAt) > num(cur.updatedAt) && s.name) {
      cur.name = s.name;
      cur.updatedAt = num(s.updatedAt);
    }
    if (!cur.panel && s.panel) cur.panel = s.panel;
    if (!cur.createdAt) cur.createdAt = num(s.createdAt);
  }
  (Array.isArray(oldDoc.stacks) ? oldDoc.stacks : []).forEach(addStack);
  (Array.isArray(newDoc.stacks) ? newDoc.stacks : []).forEach(addStack);
  out.stacks = stackOrder
    .map((id) => stackMap[id])
    .filter((s) => {
      const t = num(tombs[s.id]);
      return !(t && t >= num(s.createdAt));
    });

  /* ---- 作品归属 / 命名 / 位置：按 key 求并集，缺的补齐（不丢已有值） ---- */
  ['positions', 'assigns', 'names'].forEach((key) => {
    const merged = {};
    [oldDoc[key], newDoc[key]].forEach((src) => {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach((k) => { merged[k] = src[k]; });
    });
    out[key] = merged;
  });

  /* ---- 作品「移出文件夹 / 删除」：a:<workId> 墓碑。
         只有「仍带有该归属的那份文档」比墓碑旧时才删除，
         删除后又被重新归入的作品（写入方时间更新）不会被误删 ---- */
  const oldAssigns = asObject(oldDoc.assigns);
  const newAssigns = asObject(newDoc.assigns);
  Object.keys(out.assigns).forEach((wid) => {
    const tomb = num(tombs['a:' + wid]);
    if (!tomb) return;
    let ownerTs = 0;
    if (Object.prototype.hasOwnProperty.call(oldAssigns, wid)) ownerTs = Math.max(ownerTs, oldTs);
    if (Object.prototype.hasOwnProperty.call(newAssigns, wid)) ownerTs = Math.max(ownerTs, newTs);
    if (tomb > ownerTs) delete out.assigns[wid];
  });

  /* ---- 当前停留位置：以本次写入方为准，避免刷新后被别的设备拽走 ---- */
  if (newDoc.activeFolder !== undefined) out.activeFolder = newDoc.activeFolder;
  else if (oldDoc.activeFolder !== undefined) out.activeFolder = oldDoc.activeFolder;
  if (newDoc.activeStack !== undefined) out.activeStack = newDoc.activeStack;
  else if (oldDoc.activeStack !== undefined) out.activeStack = oldDoc.activeStack;

  return out;
}

module.exports = { mergeDesk, folderTs, mergeAndSave, applyOps };

/* =============================================================
 * 逐项操作（云端权威）
 * -------------------------------------------------------------
 * 新客户端不再整包写 desk，而是把每个变更拆成一条 op，服务端在
 * 当前云端文档上逐项应用后自增 rev。op 均为幂等：
 *  - add 已存在则忽略/补成员；delete 已不存在也视为成功
 *  - set/del 按 workId 覆盖
 * 这样任何一条操作都不会把整份文档其它部分覆盖掉。
 * ============================================================= */
const OP_LIMIT = 2000;

function cloneJson(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function applyOps(input, ops) {
  const src = asObject(input);
  const doc = {
    folders: Array.isArray(src.folders) ? cloneJson(src.folders) : [],
    stacks: Array.isArray(src.stacks) ? cloneJson(src.stacks) : [],
    positions: asObject(src.positions),
    assigns: asObject(src.assigns),
    names: asObject(src.names),
    tombstones: asObject(src.tombstones),
    updatedAt: num(src.updatedAt),
  };
  const list = Array.isArray(ops) ? ops.slice(0, OP_LIMIT) : [];
  const now = Date.now();
  let changed = false;
  /* 删除墓碑延后写：旧版「叠放 (N)」文件夹迁成 stack 时，同一批会先 folder.delete
     再 stack.add 且沿用同一个 id；如果立刻给该 id 写墓碑，旧客户端下次整包合并
     会按「墓碑不早于 createdAt」把刚迁好的叠放过滤掉。这里统一等所有 op 应用完，
     再给「确实已经不存在同名文件夹/叠放」的 id 写墓碑。 */
  const tombWrites = [];

  function idOf(v) { return v == null ? '' : String(v); }

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const type = String(raw.type || '');
    const op = raw;

    if (type === 'folder.add') {
      const f = asObject(op.folder);
      const id = idOf(f.id);
      if (!id || typeof f.name !== 'string' || !f.name) continue;
      const idx = doc.folders.findIndex((x) => x && idOf(x.id) === id);
      if (idx < 0) {
        doc.folders.push({
          id,
          name: f.name,
          parentId: f.parentId ? idOf(f.parentId) : null,
          mode: f.mode || undefined,
          createdAt: num(f.createdAt) || now,
          updatedAt: num(f.updatedAt) || now,
        });
        changed = true;
      }
    } else if (type === 'folder.update') {
      const id = idOf(op.id);
      const f = doc.folders.find((x) => x && idOf(x.id) === id);
      if (!f) continue;
      const p = asObject(op.patch);
      let touched = false;
      if (typeof p.name === 'string' && p.name && p.name !== f.name) { f.name = p.name; touched = true; }
      if (p.parentId !== undefined) {
        const pid = p.parentId ? idOf(p.parentId) : null;
        if (pid !== (f.parentId || null)) { f.parentId = pid; touched = true; }
      }
      if (p.mode !== undefined && p.mode !== f.mode) { f.mode = p.mode; touched = true; }
      if (touched) { f.updatedAt = num(p.updatedAt) || now; changed = true; }
    } else if (type === 'folder.delete') {
      const id = idOf(op.id);
      const before = doc.folders.length;
      doc.folders = doc.folders.filter((x) => !x || idOf(x.id) !== id);
      tombWrites.push([id, num(op.ts) || now]);
      Object.keys(doc.assigns).forEach((wid) => { if (idOf(doc.assigns[wid]) === id) delete doc.assigns[wid]; });
      if (doc.folders.length !== before) changed = true;
    } else if (type === 'stack.add') {
      const s = asObject(op.stack);
      const id = idOf(s.id);
      if (!id) continue;
      const members = Array.isArray(s.memberIds) ? s.memberIds.map(idOf).filter(Boolean) : [];
      const cur = doc.stacks.find((x) => x && idOf(x.id) === id);
      if (!cur) {
        doc.stacks.push({
          id,
          name: typeof s.name === 'string' && s.name ? s.name : '叠放 (' + members.length + ')',
          createdAt: num(s.createdAt) || now,
          updatedAt: num(s.updatedAt) || now,
          memberIds: members,
          panel: s.panel || undefined,
        });
        changed = true;
      } else {
        if (!Array.isArray(cur.memberIds)) cur.memberIds = [];
        members.forEach((m) => { if (cur.memberIds.indexOf(m) < 0) { cur.memberIds.push(m); changed = true; } });
      }
    } else if (type === 'stack.update') {
      const id = idOf(op.id);
      const s = doc.stacks.find((x) => x && idOf(x.id) === id);
      if (!s) continue;
      const p = asObject(op.patch);
      if (typeof p.name === 'string' && p.name && p.name !== s.name) { s.name = p.name; s.updatedAt = num(p.updatedAt) || now; changed = true; }
      if (Array.isArray(p.memberIds)) {
        const next = p.memberIds.map(idOf).filter(Boolean);
        const prev = Array.isArray(s.memberIds) ? s.memberIds : [];
        if (next.join(',') !== prev.join(',')) { s.memberIds = next; s.updatedAt = num(p.updatedAt) || now; changed = true; }
      }
      if (p.panel !== undefined) s.panel = p.panel;
    } else if (type === 'stack.delete') {
      const id = idOf(op.id);
      const before = doc.stacks.length;
      doc.stacks = doc.stacks.filter((x) => !x || idOf(x.id) !== id);
      tombWrites.push([id, num(op.ts) || now]);
      Object.keys(doc.assigns).forEach((wid) => { if (idOf(doc.assigns[wid]) === id) delete doc.assigns[wid]; });
      if (doc.stacks.length !== before) changed = true;
    } else if (type === 'assign.set') {
      const wid = idOf(op.workId);
      if (!wid) continue;
      const fid = op.folderId ? idOf(op.folderId) : '';
      if (!fid) delete doc.assigns[wid];
      else doc.assigns[wid] = fid;
      changed = true;
    } else if (type === 'assign.del') {
      const wid = idOf(op.workId);
      if (!wid) continue;
      if (doc.assigns[wid] !== undefined) { delete doc.assigns[wid]; changed = true; }
      doc.tombstones['a:' + wid] = num(op.ts) || now;
    } else if (type === 'name.set') {
      const wid = idOf(op.workId);
      if (wid) { doc.names[wid] = String(op.name == null ? '' : op.name); changed = true; }
    } else if (type === 'name.del') {
      const wid = idOf(op.workId);
      if (wid && doc.names[wid] !== undefined) { delete doc.names[wid]; changed = true; }
    } else if (type === 'position.set') {
      const wid = idOf(op.workId);
      if (wid) { doc.positions[wid] = op.position || null; changed = true; }
    } else if (type === 'position.del') {
      const wid = idOf(op.workId);
      if (wid && doc.positions[wid] !== undefined) { delete doc.positions[wid]; changed = true; }
    } else if (type === 'tombstone') {
      const id = idOf(op.id);
      if (id) { doc.tombstones[id] = num(op.ts) || now; changed = true; }
    } else if (type === 'assignTombstone') {
      const wid = idOf(op.workId);
      if (wid) { doc.tombstones['a:' + wid] = num(op.ts) || now; changed = true; }
    }
  }

  /* 只有「确实已经不存在同名文件夹/叠放」的 id 才落墓碑，并取较晚的时间 */
  tombWrites.forEach((pair) => {
    const id = pair[0];
    const ts = pair[1];
    if (!id) return;
    if (doc.folders.some((x) => x && idOf(x.id) === id)) return;
    if (doc.stacks.some((x) => x && idOf(x.id) === id)) return;
    if (!(num(doc.tombstones[id]) >= ts)) { doc.tombstones[id] = ts; changed = true; }
  });

  return { doc, changed };
}


/* =============================================================
 * 合并后写入（带版本冲突重试）
 * -------------------------------------------------------------
 * 两个设备同时保存时，「读-合并-写」之间可能互相覆盖（都基于旧 rev 合并）。
 * 这里用 putDoc 的 baseRev 做乐观锁：409 就重新读取并重新合并，最多 4 次。
 * 所有 desk 写入口统一走这里，避免任何一条路径绕过合并。
 * ============================================================= */
async function mergeAndSave(userData, userId, incoming, attempts) {
  const tries = Math.max(1, Number(attempts) || 4);
  for (let i = 0; i < tries; i += 1) {
    const existing = await userData.getDoc(userId, 'desk');
    const merged = mergeDesk(existing && existing.data ? existing.data : {}, incoming || {});
    merged.updatedAt = Date.now();
    try {
      return await userData.putDoc(userId, 'desk', merged, existing && existing.rev ? existing.rev : null);
    } catch (err) {
      if (err && Number(err.status) === 409 && i < tries - 1) continue;
      throw err;
    }
  }
  return null;
}

