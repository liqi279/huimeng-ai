
/* ============================================================
 * 历史数据认领（方案 1）：登录拿到 user.id 之后，把本 origin 下
 * 可能属于同一个人的旧键合并进当前账号。
 *
 * 判定证据链（可靠度从高到低）：
 *   ① 键名里带 uid 且等于当前 uid            → 同一个人
 *   ② 键名里带 uid ≠ 当前 uid，但历史登录痕迹（hm.userHistory.v1 /
 *      hm.lastUser.v1）里该 uid 的用户名与当前用户名一致 → 同一个人
 *   ③ 固定键 / guest 键（不带 uid）：只有「本 origin 没有其它账号的数据」才合并
 *   ④ 以上都判不了 → 不动该键，只在控制台留一行可读日志
 *
 * 合并规则：
 *   - 作品按 work.id 去重；当前账号已有数据永远优先（旧数据只补缺，不覆盖）
 *   - 桌面 folders/positions/assigns/names 只补当前缺失项，updatedAt 取较大值
 *   - 旧键一律保留不删除（留作回退），合并结果写入当前 uid 键并标记待同步
 *   - 整个认领每个账号只跑一次（hm.claim.v1.<uid>），可手动重跑：
 *       HMClaim.run({force:true})  或  设置 → 云同步 → 「认领历史数据」
 *
 * 失败兜底：任何异常都只 console.warn，绝不影响正常登录。
 * ============================================================ */
(function () {
  'use strict';
  var FLAG_PREFIX = 'hm.claim.v1.';
  var HIST_KEY = 'hm.userHistory.v1';
  var LAST_KEY = 'hm.lastUser.v1';
  var FIXED_WORK_KEYS = ['anidream.works', 'hm.works', 'works', 'anidream.works.v1', 'anidream.works.v1.bak'];
  var GUEST_DESK_KEY = 'anidream.desk.v1';

  function curUser() { return (window.HMApp && window.HMApp.user) || null; }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function arrOf(v) { return Array.isArray(v) ? v : []; }

  function readRaw(k) {
    var raw;
    try { raw = localStorage.getItem(k); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {
      console.warn('[HMClaim] 跳过损坏的键（JSON 解析失败，保持原样）：' + k);
      return null;
    }
  }

  /* 历史登录痕迹：uid -> 用户名（含当前账号） */
  function historyMap() {
    var map = Object.create(null);
    arrOf(readRaw(HIST_KEY)).forEach(function (u) { if (u && u.id) map[String(u.id)] = norm(u.username); });
    var last = readRaw(LAST_KEY);
    if (last && last.id) map[String(last.id)] = norm(last.username);
    var me = curUser();
    if (me && me.id) map[String(me.id)] = norm(me.username);
    return map;
  }

  /* 扫描本 origin 的作品键：按 uid 分组 + 固定键/guest 键 */
  function scanWorkKeys() {
    var byUid = Object.create(null);
    var fixed = [];
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('anidream.works') !== 0) continue;
      if (FIXED_WORK_KEYS.indexOf(k) >= 0) { fixed.push(k); continue; }
      var m = /^anidream\.works\.v1\.([^.]+)(?:\..+)?$/.exec(k);
      if (!m || m[1] === 'bak') { fixed.push(k); continue; }
      (byUid[m[1]] = byUid[m[1]] || []).push(k);   /* 含 .bak / .snap.<ts> */
    }
    return { byUid: byUid, fixed: fixed };
  }

  function scanDeskKeys() {
    var byUid = Object.create(null);
    var guest = [];
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('anidream.desk') !== 0) continue;
      if (k === GUEST_DESK_KEY) { guest.push(k); continue; }
      var m = /^anidream\.desk\.v1\.([^.]+)$/.exec(k);
      if (m) (byUid[m[1]] = byUid[m[1]] || []).push(k);
    }
    return { byUid: byUid, guest: guest };
  }

  function readWorkList(keys) {
    var out = [];
    (keys || []).forEach(function (k) {
      var v = readRaw(k);
      if (Array.isArray(v)) out = out.concat(v);
      else if (v) console.warn('[HMClaim] 键内容不是作品数组，已跳过：' + k);
    });
    return out;
  }

  /* uid 归属判定：返回 {ok, why} */
  function classify(ownerUid, hist) {
    var me = curUser();
    if (!me || !me.id) return { ok: false, why: '未登录' };
    if (String(ownerUid) === String(me.id)) return { ok: true, why: 'uid 与当前账号一致' };
    var name = hist[String(ownerUid)];
    if (name && norm(me.username) && name === norm(me.username)) {
      return { ok: true, why: '历史登录痕迹显示同一用户名（' + me.username + '）' };
    }
    return { ok: false, why: 'uid 不同且无法证明是同一人' };
  }

  /* 当前账号的数据 = 内存列表 ∪ 当前 uid 键 ∪ .bak（内存优先，绝不丢磁盘已有数据） */
  function currentWorks(me) {
    var A = window.HMApp;
    var cur = (A && A.state && Array.isArray(A.state.works)) ? A.state.works.slice() : [];
    var key = 'anidream.works.v1.' + me.id;
    var stored = readRaw(key);
    var bak = readRaw(key + '.bak');
    var lists = [arrOf(stored), arrOf(bak), cur];
    var merged = (window.HMSync && window.HMSync.mergeLists)
      ? window.HMSync.mergeLists.apply(null, lists)
      : lists.reduce(function (a, b) { return a.concat(b); }, []);
    /* mergeLists 按时间取新；这里再用「内存/磁盘当前值」兜底一次，保证当前数据优先 */
    var map = Object.create(null);
    merged.forEach(function (w) { if (w && w.id) map[String(w.id)] = w; });
    cur.forEach(function (w) { if (w && w.id) map[String(w.id)] = Object.assign({}, map[String(w.id)] || {}, w); });
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function mergeWorksIntoAccount(list, me) {
    var A = window.HMApp;
    if (!A || !A.state || !list.length) return 0;
    var cur = currentWorks(me);
    var before = cur.length;
    /* mergeWorks(旧数据, 当前数据)：同 id 时第二个参数（当前）优先 → 旧数据不覆盖当前 */
    var merged = A.mergeWorks ? A.mergeWorks(list, cur) : cur.concat(list);
    if (merged.length <= before) return 0;
    var have = Object.create(null);
    cur.forEach(function (w) { if (w && w.id) have[String(w.id)] = 1; });
    merged.forEach(function (w) { if (w && w.id && !have[String(w.id)]) w._pendingUpload = true; });
    A.state.works = merged;
    if (A.saveWorks) A.saveWorks();       /* 写当前 uid 键 + 触发 HMSync 标记待同步 */
    if (A.renderWorks) A.renderWorks();
    return merged.length - before;
  }

  async function run(opts) {
    opts = opts || {};
    var summary = { ok: true, skipped: false, works: 0, desk: 0, keys: 0, reasons: [] };
    try {
      var me = curUser();
      if (!me || !me.id) { summary.ok = false; summary.error = '未登录，跳过认领'; return summary; }
      var flag = FLAG_PREFIX + me.id;
      if (!opts.force && localStorage.getItem(flag)) {
        summary.skipped = true;
        summary.reason = '本账号已认领过（重跑：HMClaim.run({force:true})）';
        return summary;
      }

      var hist = historyMap();
      var wk = scanWorkKeys();
      var dk = scanDeskKeys();

      /* 其它账号留下的数据 → 决定「固定键 / guest 键」能否判定归属 */
      var otherOwners = [];
      Object.keys(wk.byUid).forEach(function (o) {
        if (String(o) === String(me.id)) return;
        if (readWorkList(wk.byUid[o]).length) otherOwners.push('works:' + o);
      });
      Object.keys(dk.byUid).forEach(function (o) {
        if (String(o) === String(me.id)) return;
        var raw = readRaw(dk.byUid[o][0]);
        if (raw && (arrOf(raw.folders).length || Object.keys(raw.positions || {}).length)) otherOwners.push('desk:' + o);
      });
      var sharedOk = otherOwners.length === 0;

      /* ---- 作品 ---- */
      var claimLists = [];
      Object.keys(wk.byUid).forEach(function (owner) {
        if (String(owner) === String(me.id)) return;
        var verdict = classify(owner, hist);
        if (verdict.ok) {
          claimLists.push(readWorkList(wk.byUid[owner]));
          summary.reasons.push('作品 ' + owner + '：' + verdict.why + ' → 合并');
        } else {
          console.info('[HMClaim] 跳过作品键 anidream.works.v1.' + owner + '：' + verdict.why + '（保持原样）');
        }
      });
      if (wk.fixed.length) {
        if (sharedOk) {
          claimLists.push(readWorkList(wk.fixed));
          summary.reasons.push('固定键/guest 作品键：本 origin 无其它账号数据 → 合并');
        } else {
          console.info('[HMClaim] 跳过固定键/guest 作品键：本 origin 检测到其它账号数据（' + otherOwners.join(', ') + '），无法判定归属');
        }
      }
      var claimList = (window.HMSync && window.HMSync.mergeLists)
        ? window.HMSync.mergeLists.apply(null, claimLists)
        : claimLists.reduce(function (a, b) { return a.concat(b); }, []);
      if (claimList.length) summary.works = mergeWorksIntoAccount(claimList, me);

      /* ---- 桌面 / 项目文件夹 ---- */
      var deskItems = [];
      Object.keys(dk.byUid).forEach(function (owner) {
        if (String(owner) === String(me.id)) return;
        var verdict = classify(owner, hist);
        if (verdict.ok) {
          dk.byUid[owner].forEach(function (k) { var v = readRaw(k); if (v) deskItems.push(v); });
          summary.reasons.push('桌面 ' + owner + '：' + verdict.why + ' → 合并');
        } else {
          console.info('[HMClaim] 跳过桌面键 anidream.desk.v1.' + owner + '：' + verdict.why + '（保持原样）');
        }
      });
      if (sharedOk && dk.guest.length) {
        var beforeLen = deskItems.length;
        dk.guest.forEach(function (k) { var v = readRaw(k); if (v) deskItems.push(v); });
        if (deskItems.length > beforeLen) summary.reasons.push('guest 桌面键：本 origin 无其它账号数据 → 合并');
      } else if (!sharedOk && dk.guest.length) {
        console.info('[HMClaim] 跳过 guest 桌面键：本 origin 检测到其它账号数据，无法判定归属');
      }
      if (window.HMDesk && typeof window.HMDesk.claimLegacy === 'function') {
        deskItems.forEach(function (item) {
          try { summary.desk += (window.HMDesk.claimLegacy(item) || 0); }
          catch (e) { console.warn('[HMClaim] 桌面认领失败（忽略）:', e && e.message); }
        });
      }

      summary.keys = claimLists.length + deskItems.length;
      try { localStorage.setItem(flag, String(Date.now())); } catch (e) {}
      console.log('[HMClaim] 认领完成：作品 +' + summary.works + ' 条，桌面 +' + summary.desk + ' 项，来源键 ' + summary.keys + ' 个');
      return summary;
    } catch (err) {
      /* 失败兜底：认领出错绝不影响正常登录 */
      console.warn('[HMClaim] 认领过程出错（已忽略，不影响登录）:', (err && err.message) || err);
      summary.ok = false;
      summary.error = (err && err.message) || String(err);
      return summary;
    }
  }

  window.HMClaim = { run: run, reset: function (uid) { try { localStorage.removeItem(FLAG_PREFIX + uid); } catch (e) {} } };
})();

