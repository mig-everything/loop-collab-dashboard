/* 像素办公室 · 场景引擎：镜头（缩放/拖拽）、人物与宠物行为、深度排序绘制、DOM 叠加层（名牌、气泡、门牌、看板数字、工序、公告、电视）。
 * 数据只来自 data/status.json：谁在工作、在做哪个 issue、会议、机器在线、进度、issue 计数、最新动态。
 * 人物走动、喝咖啡、坐沙发、宠物等是氛围动画；气泡里的文字全部取自上述真实数据。 */
(function (global) {
  "use strict";
  var M = global.PO_MAP, S = global.PO_SPRITES, T = 16, COLS = M.COLS, ROWS = M.ROWS, PW = COLS * T, PH = ROWS * T;
  var MEET_RE = /早会|午会|晚会|会议|纪要/, PATROL_RE = /巡检/;
  var reduce = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var QS = new URLSearchParams(global.location.search), SIM = Math.min(600, +QS.get("sim") || 0);
  var WALK = 52, PET_WALK = 34, SIT_DY = 6, FOOT = 8;   // 人物以格子中心为落脚点（与 pixel-agents 一致），坐下再下沉 6px
  /* 工位分配：按团队真实分工排座（没列到的人按顺序补空位） */
  var ROLE_DESK = {
    "task1-survey": ["gpt-writer", "kimi-adversary", "deepseek-planner"],
    "task2-benchmark": ["glm-scenarist", "glm-runner", "minimax-visual-diff", "deepseek-planner"],
    "task3-dw-migration": ["exec-runner", "exec-verifier", "exec-fixer", "dw-lead", "deepseek-planner", "opus-analyzer"],
    "task4-ipd-eazo": ["hermes-pm", "hermes-sa", "hermes-se", "hermes-dev", "hermes-tester", "hermes-rm", "deepseek-planner", "minimax-uijudge"]
  };
  /* 任务4 的 IPD 角色接力：哪个角色 agent 正在跑 run，哪一站就亮 */
  var RELAY = [["需求", "hermes-pm"], ["架构", "hermes-sa"], ["设计", "hermes-se"], ["开发", "hermes-dev"], ["测试", "hermes-tester"], ["发布", "hermes-rm"]];
  var RITUALS = [[0, "巡检"], [4, "早会"], [8, "巡检"], [12, "午会"], [16, "巡检"], [20, "晚会"]];
  var BACKS = { SOFA_BACK: 1, CUSHIONED_CHAIR_BACK: 1 };

  function hash(s) { var h = 2166136261; s = String(s || "?"); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function bj() { return new Date(Date.now() + 8 * 3600e3); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nextRitual() {
    var b = bj(), mins = b.getUTCHours() * 60 + b.getUTCMinutes();
    for (var i = 0; i < RITUALS.length; i++) if (RITUALS[i][0] * 60 > mins) return pad(RITUALS[i][0]) + ":00 " + RITUALS[i][1];
    return "00:00 " + RITUALS[0][1];
  }
  /* 场景里默认显示短名（去掉模型/分组前缀），放大或悬停显示全名；侧栏始终是全名 */
  function shortName(n) { var m = /^(?:gpt|kimi|deepseek|glm|minimax|opus|hermes|exec|claude|sonnet|qwen|gemini)-(.+)$/.exec(n || ""); return m ? m[1] : n; }
  function short(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function minsSince(iso) { var t = Date.parse(iso || ""); return isNaN(t) ? -1 : Math.max(0, Math.round((Date.now() - t) / 60000)); }

  /* 执行单标题「[DW迁移任务单] <App> 迁移 · <阶段> · <实时进度…>」 */
  function parseOrder(title) {
    var m = /\[DW迁移任务单\]\s*(.+?)\s*迁移\s*(?:·\s*(.*))?$/.exec(title || "");
    if (!m) return null;
    var rest = m[2] || "", parts = rest.split("·").map(function (x) { return x.trim(); }).filter(Boolean), st = parts[0] || "";
    var k = /收口|已完成/.test(st) ? 5 : /终验/.test(st) ? 4 : /修复|wave|波/i.test(st) ? 3 : /审计/.test(st) ? 2 : /迁移|清单/.test(st) ? 1 : 0;
    return { app: m[1], stage: st, k: k, both: /清单\s*\+\s*迁移/.test(st) && !/清单✓/.test(rest), info: parts.slice(1), title: title };
  }

  /* ---------------- 寻路（4 邻接 BFS；终点允许是座位格） ---------------- */
  function bfs(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    var N = COLS * ROWS, prev = new Int32Array(N).fill(-1), seen = new Uint8Array(N), q = [sy * COLS + sx], h = 0;
    seen[sy * COLS + sx] = 1;
    while (h < q.length) {
      var c = q[h++], cx = c % COLS, cy = (c / COLS) | 0;
      if (cx === tx && cy === ty) { var path = [], k = c; while (k !== sy * COLS + sx) { path.unshift({ x: k % COLS, y: (k / COLS) | 0 }); k = prev[k]; } return path; }
      for (var d = 0; d < 4; d++) {
        var nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0), n = ny * COLS + nx;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen[n]) continue;
        if (!((nx === tx && ny === ty) ? M.standable(nx, ny) : M.walkable(nx, ny))) continue;
        seen[n] = 1; prev[n] = c; q.push(n);
      }
    }
    return null;
  }

  /* ---------------- 场景对象 ---------------- */
  function Office(canvas, ov, handlers) {
    this.canvas = canvas; this.ov = ov; this.h = handlers || {};
    this.stage = canvas.parentNode;
    this.c = canvas.getContext("2d");
    this.cam = { s: 1, ox: 0, oy: 0, fit: true };
    this.agents = {}; this.tasks = []; this.roomTask = []; this.res = {}; this.effects = []; this.pets = [];
    this.env = { hour: bj().getUTCHours(), kanban: [], line: M.line, lineMoving: false, coffeeBusy: false, pingpong: false };
    this.hover = null; this.t = 0; this.running = false; this.dirtyCam = true; this.talkT = 1.5;
    this.buildOverlays(); this.bindInput();
    var self = this;
    S.load("assets/pixel/atlas.png", function (err) {
      self.failed = !!err;
      self.buildStatic();
      self.addPets();
      if (self.pendingData) { var d = self.pendingData; self.pendingData = null; self.setData(d); }
      if (SIM && !reduce) self.simulate(SIM);
      var qc = (QS.get("cam") || "").split(",").map(Number);   // 调试截图用：?cam=中心x格,中心y格,缩放
      if (qc.length === 3 && qc.every(isFinite)) { self.cam.s = qc[2]; self.cam.ox = self.W / 2 - qc[0] * T * qc[2]; self.cam.oy = self.H / 2 - qc[1] * T * qc[2]; self.cam.fit = false; self.dirtyCam = true; }
      self.draw();
      self.start();
    });
    if (global.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(this.stage);
    else global.addEventListener("resize", function () { self.resize(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) self.start(); });
    if (reduce) setInterval(function () { if (self.bg) { self.talkT = 0; self.talk(0); self.draw(); } }, 5000);
    this.resize();
  }
  var O = Office.prototype;

  /* ---------------- 静态层：地面、地毯、地面贴花；墙块与家具深度 ---------------- */
  O.buildStatic = function () {
    var cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
    var c = cv.getContext("2d"), x, y, self = this;
    c.fillStyle = "#0e1424"; c.fillRect(0, 0, PW, PH);
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (M.tile(x, y) !== M.FLOOR) continue;
      var z = M.ZONES[M.zone[y * COLS + x] || "hall"];
      if (this.failed) { c.fillStyle = "#c9c2b0"; c.fillRect(x * T, y * T, T, T); continue; }
      c.drawImage(S.floor(z.floor, z.col), x * T, y * T);
    }
    if (!this.failed) M.carpets.forEach(function (cp) {
      function has(tx, ty) { return tx >= cp.x0 && tx <= cp.x1 && ty >= cp.y0 && ty <= cp.y1; }
      for (var jy = cp.y0; jy <= cp.y1 + 1; jy++) for (var jx = cp.x0; jx <= cp.x1 + 1; jx++) {
        var ms = 0;
        if (has(jx - 1, jy - 1)) ms |= 1; if (has(jx, jy - 1)) ms |= 2; if (has(jx, jy)) ms |= 4; if (has(jx - 1, jy)) ms |= 8;
        if (ms) c.drawImage(S.carpet(cp.v, ms, cp.col), jx * T - 8, jy * T - 8);
      }
    });
    var L = M.line;   // 传送带下方的安全警示线
    for (x = L.x0 * T; x < (L.x1 + 1) * T; x += 8) { c.fillStyle = (x / 8) % 2 ? "#facc15" : "#1f2937"; c.fillRect(x, (L.y + 1) * T + 1, 8, 3); }
    this.walls = [];
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (M.tile(x, y) !== M.WALL) continue;
      var m = 0;
      if (M.tile(x, y - 1) === M.WALL) m |= 1; if (M.tile(x + 1, y) === M.WALL) m |= 2; if (M.tile(x, y + 1) === M.WALL) m |= 4; if (M.tile(x - 1, y) === M.WALL) m |= 8;
      this.walls.push({ x: x * T, y: y * T - T, z: (y + 1) * T, img: this.failed ? null : S.wall(m, M.WALL_COL) });
    }
    M.items.forEach(function (it) {
      var h = it.p ? it.h * T : S.size(it.t)[1], fh = it.fh || (it.p ? it.h : Math.ceil(h / T));
      it.px = it.x * T; it.py = (it.y + fh) * T - h;
      it.z = it.wall ? (it.y + 2) * T + 0.2 : (it.y + fh) * T + (BACKS[it.t] ? 1 : 0);
    });
    M.items.forEach(function (it) {   // 桌面物件画在其下家具之后
      if (!it.surf) return;
      var under = 0;
      M.items.forEach(function (o) { if (o === it || o.surf || o.wall || !o.fw) return; if (it.x >= o.x && it.x < o.x + o.fw && it.y >= o.y && it.y < o.y + o.fh) under = Math.max(under, o.z); });
      it.z = Math.max(it.z, under) + 0.1;
    });
    this.seatZ = {};   // 坐下的人要画在椅子/沙发之上（椅背朝外的除外）
    M.items.forEach(function (it) { if (!it.seat || BACKS[it.t]) return; for (var yy = it.y; yy < it.y + (it.fh || 1); yy++) for (var xx = it.x; xx < it.x + (it.fw || 1); xx++) self.seatZ[xx + "," + yy] = it.z; });
    this.bg = cv;
  };

  /* ---------------- 镜头 ---------------- */
  O.resize = function () {
    var w = this.stage.clientWidth, h = this.stage.clientHeight, dpr = global.devicePixelRatio || 1;
    if (!w || !h) return;
    this.W = w; this.H = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    if (this.cam.fit || !this.cam.inited) this.fit(); else this.clampCam();
    this.cam.inited = true; this.dirtyCam = true; this.draw();
  };
  O.fitScale = function () { return Math.min(this.W / PW, this.H / PH); };
  O.fit = function () { var s = this.fitScale(); this.cam.s = s; this.cam.ox = (this.W - PW * s) / 2; this.cam.oy = (this.H - PH * s) / 2; this.cam.fit = true; this.dirtyCam = true; };
  O.clampCam = function () {
    var c = this.cam, mw = PW * c.s, mh = PH * c.s, m = 60;
    c.ox = mw <= this.W ? (this.W - mw) / 2 : Math.min(m, Math.max(this.W - mw - m, c.ox));
    c.oy = mh <= this.H ? (this.H - mh) / 2 : Math.min(m, Math.max(this.H - mh - m, c.oy));
  };
  O.zoomAt = function (sx, sy, f) {
    var c = this.cam, ns = Math.max(this.fitScale() * 0.92, Math.min(7, c.s * f)), wx = (sx - c.ox) / c.s, wy = (sy - c.oy) / c.s;
    c.s = ns; c.ox = sx - wx * ns; c.oy = sy - wy * ns; c.fit = false; this.clampCam(); this.dirtyCam = true; this.kick();
  };
  O.focusRect = function (x0, y0, x1, y1) {
    var w = (x1 - x0 + 1) * T + 24, h = (y1 - y0 + 1) * T + 24, s = Math.min(7, Math.min(this.W / w, this.H / h));
    this.cam.s = s; this.cam.ox = this.W / 2 - ((x0 + x1 + 1) / 2) * T * s; this.cam.oy = this.H / 2 - ((y0 + y1 + 1) / 2) * T * s;
    this.cam.fit = false; this.clampCam(); this.dirtyCam = true; this.kick();
  };
  O.toWorld = function (sx, sy) { return { x: (sx - this.cam.ox) / this.cam.s, y: (sy - this.cam.oy) / this.cam.s }; };

  O.bindInput = function () {
    var self = this, cv = this.canvas, ptrs = {}, drag = null, pinch = null;
    cv.addEventListener("wheel", function (e) {
      var r = cv.getBoundingClientRect(), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      var pageScrolls = document.documentElement.scrollHeight > global.innerHeight + 4;
      var mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaY % 1) < 1e-6);
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); self.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-d * (e.ctrlKey && !mouseWheel ? 0.012 : 0.0016))); return; }
      if (pageScrolls) { self.flashHint("按住 Ctrl（Mac 为 ⌘）再滚动可缩放场景"); return; }   // 让页面正常滚动
      e.preventDefault();
      if (mouseWheel) self.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-d * 0.0016));
      else { self.cam.ox -= e.deltaX; self.cam.oy -= e.deltaY; self.cam.fit = false; self.clampCam(); self.dirtyCam = true; self.kick(); }
    }, { passive: false });
    cv.addEventListener("pointerdown", function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* 某些浏览器不支持时忽略 */ }
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; }
      else drag = { x: e.clientX, y: e.clientY, ox: self.cam.ox, oy: self.cam.oy, moved: false };
    });
    cv.addEventListener("pointermove", function (e) {
      var r = cv.getBoundingClientRect();
      if (ptrs[e.pointerId]) ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (pinch && ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0) self.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch.d);
        pinch.d = d; return;
      }
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; cv.classList.add("grabbing"); }
        if (drag.moved) { self.cam.ox = drag.ox + dx; self.cam.oy = drag.oy + dy; self.cam.fit = false; self.clampCam(); self.dirtyCam = true; self.kick(); }
        return;
      }
      var w = self.toWorld(e.clientX - r.left, e.clientY - r.top), hit = self.hitAgent(w.x, w.y);
      if (hit !== self.hover) { self.hover = hit; cv.style.cursor = hit ? "pointer" : ""; self.kick(); }
    });
    function end(e) {
      var wasDrag = drag && drag.moved;
      delete ptrs[e.pointerId]; if (Object.keys(ptrs).length < 2) pinch = null;
      cv.classList.remove("grabbing");
      if (drag && !wasDrag && e.type === "pointerup") { var r = cv.getBoundingClientRect(); self.click(e.clientX - r.left, e.clientY - r.top); }
      drag = null;
    }
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", function () { if (self.hover) { self.hover = null; cv.style.cursor = ""; self.kick(); } });
    cv.addEventListener("dblclick", function (e) {
      var r = cv.getBoundingClientRect(), w = self.toWorld(e.clientX - r.left, e.clientY - r.top), ri = M.roomAt(Math.floor(w.x / T), Math.floor(w.y / T));
      if (ri >= 0 && self.focused === ri) { self.fit(); self.focused = null; self.kick(); return; }
      if (ri >= 0) { var R = M.rooms[ri]; self.focusRect(R.x0, R.y0 - 2, R.x1, R.y1); self.focused = ri; }
      else self.zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8);
    });
    this.stage.addEventListener("keydown", function (e) {
      if (e.key === "+" || e.key === "=") { self.zoomAt(self.W / 2, self.H / 2, 1.25); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { self.zoomAt(self.W / 2, self.H / 2, 0.8); e.preventDefault(); }
      else if (e.key === "0") { self.fit(); self.focused = null; self.kick(); e.preventDefault(); }
    });
  };
  O.zoomButtons = function (bar) {
    var self = this;
    function btn(label, title, fn, cls) { var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; if (cls) b.className = cls; b.onclick = fn; bar.appendChild(b); return b; }
    btn("+", "放大（也可以用滚轮、双指）", function () { self.zoomAt(self.W / 2, self.H / 2, 1.3); });
    btn("−", "缩小", function () { self.zoomAt(self.W / 2, self.H / 2, 1 / 1.3); });
    btn("全景", "适应窗口（快捷键 0）", function () { self.fit(); self.focused = null; self.kick(); }, "wide");
    btn("公共区", "聚焦前台大厅、茶水间与休息区", function () { self.focusRect(20, 0, 38, ROWS - 1); self.focused = null; }, "wide");
  };

  /* ---------------- DOM 叠加层 ---------------- */
  O.el = function (cls, tag, parent) { var e = document.createElement(tag || "div"); e.className = cls; (parent || this.ov).appendChild(e); return e; };
  /* 叠加层分两类：人物名牌/气泡按屏幕字号显示并互相避让；墙上的门牌、看板、工序、公告等按世界尺寸随镜头缩放，
   * 始终贴在各自的板子上，不会盖住场景；缩得太小看不清时隐藏（ess=必留的除外），同样信息在右侧团队栏里都有。 */
  O.buildOverlays = function () {
    var self = this;
    this.anchors = [];
    function anchor(el, wx, wy, ax, ay, ws, ess) { self.anchors.push({ el: el, wx: wx, wy: wy, ax: ax || 0, ay: ay || 0, ws: ws || 0, ess: !!ess }); return el; }
    function find(fn) { return M.items.filter(fn)[0]; }
    this.rooms = M.rooms.map(function (R, i) {
      var o = { R: R }, pl = find(function (it) { return it.p === "plate" && it.x === R.plate.x && it.y === R.plate.y; });
      o.plate = anchor(self.el("rplate"), pl.x * T + 3, pl.y * T + 9, 0, 0, 7.2, true);
      o.plate.style.width = ((pl.w * T - 6) / 7.2).toFixed(2) + "em";
      o.plate.innerHTML = '<div class="t"><i class="lamp"></i><span class="nm"></span><span class="mt">会议中</span></div><div class="m"><span class="pbar"><i style="width:0"></i></span><b class="pv"></b><span class="mc"></span></div>';
      o.plate.style.display = "none";   // 拿到数据再显示
      o.plate.addEventListener("click", function () { var t = self.roomTask[i]; if (t && self.h.onRoom) self.h.onRoom(t); });
      o.kb = anchor(self.el("kbcap"), R.kanban.x * T + 2, R.kanban.y * T + 30, 0, 0, 4.6);
      o.kb.style.width = ((R.kanban.w * T - 4) / 4.6).toFixed(2) + "em";
      o.rack = anchor(self.el("rackp"), (R.rack.x + 1) * T, R.rack.y * T - 3, 0.5, 1, 5.4); o.rack.style.display = "none";
      var tb = R.meet.table;   // 会议标语贴在会议桌面上（像桌上的议程纸），不压工位
      o.meet = anchor(self.el("meetsign"), (tb.x + tb.w / 2) * T, (tb.y + tb.h / 2) * T - 2, 0.5, 0.5, 4.6); o.meet.style.display = "none";
      o.meet.style.maxWidth = ((tb.w * T + 10) / 4.6).toFixed(2) + "em";
      o.off = anchor(self.el("offplq"), ((R.x0 + R.x1 + 1) / 2) * T, ((R.y0 + R.y1 + 1) / 2) * T, 0.5, 0.5, 8, true); o.off.style.display = "none";
      if (R.line) {
        var L = R.line;
        o.st = L.machines.map(function (mx, k) { var e = anchor(self.el("stchip"), mx * T + 8, L.y * T - 8, 0.5, 1, 6.4, true); e.textContent = L.stages[k]; return e; });
        o.crate = anchor(self.el("cratelbl"), 0, 0, 0.5, 1, 6.4, true); o.crate.style.display = "none";
        o.linecap = anchor(self.el("linecap"), (L.x0 + L.x1 + 1) / 2 * T, (L.y + 1) * T + 5, 0.5, 0, 6.2, true);
        anchor(self.el("zonelbl dim"), L.intake * T + 8, L.y * T - 8, 0.5, 1, 5.4).textContent = "安卓工程";
        anchor(self.el("zonelbl dim"), (L.out + 1) * T, L.y * T - 8, 0.5, 1, 5.4).textContent = "鸿蒙工程";
      }
      if (R.task === "task4-ipd-eazo") {
        o.relay = anchor(self.el("relay"), R.plate.x * T + 3, R.plate.y * T + 33, 0, 0, 5.6, true);
        o.relay.innerHTML = RELAY.map(function (r) { return '<span data-n="' + r[1] + '">' + r[0] + "</span>"; }).join("<i>›</i>");
      }
      return o;
    });
    var sign = find(function (it) { return it.p === "sign"; });
    this.signEl = anchor(this.el("lobbysign"), (sign.x + sign.w / 2) * T, sign.y * T + 18, 0.5, 0.5, 8, true);
    this.signEl.innerHTML = "<b>WS 协作中心</b><span>四个任务 · 实时看板</span>";
    var nb = find(function (it) { return it.p === "notice"; });
    this.noticeEl = anchor(this.el("notice"), nb.x * T + 3, nb.y * T + 8, 0, 0, 4.6);
    this.noticeEl.style.width = ((nb.w * T - 6) / 4.6).toFixed(2) + "em";
    var ck = find(function (it) { return it.t === "CLOCK" && it.x === 28; });
    this.clockEl = anchor(this.el("clock"), (ck.x + 0.5) * T, ck.y * T + 33, 0.5, 0, 6.4, true);
    this.clockEl.innerHTML = '<b class="ct">--:--</b><span class="cn"></span>';
    var tv = find(function (it) { return it.p === "tv"; });
    this.tvEl = anchor(this.el("tvtext"), (tv.x + tv.w / 2) * T, tv.y * T - 7, 0.5, 0.5, 3.7);
    this.tvEl.style.width = ((tv.w * T - 14) / 3.7).toFixed(2) + "em";
    [["前台大厅", 26.5, 12.55], ["茶水间", 28, 22.55], ["休息区", 35.5, 34.55]].forEach(function (z) { anchor(self.el("zonelbl"), z[1] * T, z[2] * T, 0.5, 0.5, 6.6, true).textContent = z[0]; });
    var bar = this.el("zoombar", "div", this.stage); this.zoomButtons(bar);
    this.hintEl = this.el("hint", "div", this.stage); this.hintEl.textContent = this.hintText = "滚轮缩放 · 拖动平移 · 双击房间聚焦 · 点人物看详情";
  };
  O.placeAnchors = function () {
    var c = this.cam, ui = Math.max(1, Math.min(1.4, c.s / 1.3)), self = this, MINPX = 8.2;
    this.ov.style.fontSize = (13 * ui).toFixed(2) + "px";
    if (this.lastUi !== ui) { this.lastUi = ui; Object.keys(this.agents).forEach(function (k) { self.agents[k].sizeDirty = true; }); }
    this.anchors.forEach(function (a) {
      if (a.el.style.display === "none") return;
      if (a.ws) {
        var px = a.ws * c.s;
        var keep = a.ess && c.s >= 0.8;
        a.el.style.fontSize = Math.max(px, keep ? MINPX : 0).toFixed(2) + "px";
        a.el.style.visibility = px < MINPX && !keep ? "hidden" : "";
      }
      a.el.style.transform = "translate(" + Math.round(c.ox + a.wx * c.s) + "px," + Math.round(c.oy + a.wy * c.s) + "px) translate(" + (-a.ax * 100) + "%," + (-a.ay * 100) + "%)";
    });
    this.ov.classList.toggle("far", c.s < 1.05);
    var base = this.ov.getBoundingClientRect(), rects = [];
    this.anchors.forEach(function (a) {
      if (a.el.style.display === "none" || a.el.style.visibility === "hidden") return;
      var b = a.el.getBoundingClientRect(); if (b.width) rects.push({ l: b.left - base.left, r: b.right - base.left, t: b.top - base.top, b: b.bottom - base.top });
    });
    this.staticRects = rects;
  };
  O.moveAnchor = function (el, wx, wy) {
    for (var i = 0; i < this.anchors.length; i++) if (this.anchors[i].el === el) { var a = this.anchors[i]; if (a.wx !== wx || a.wy !== wy) { a.wx = wx; a.wy = wy; this.dirtyCam = true; } return; }
  };

  /* ---------------- 数据 ---------------- */
  O.setData = function (tasks) {
    if (!this.bg) { this.pendingData = tasks; return; }
    var self = this, used = {}, rt = [];
    this.tasks = tasks;
    tasks.forEach(function (t, i) { var ri = -1; M.rooms.forEach(function (R, k) { if (R.task === t.id && !used[k]) ri = k; }); rt[i] = ri; if (ri >= 0) used[ri] = 1; });
    tasks.forEach(function (t, i) { if (rt[i] < 0) for (var k = 0; k < M.rooms.length; k++) if (!used[k]) { rt[i] = k; used[k] = 1; break; } });
    this.roomTask = [];
    tasks.forEach(function (t, i) { if (rt[i] >= 0) self.roomTask[rt[i]] = t; });
    var seen = {}, env = this.env;
    env.kanban = [];
    M.rooms.forEach(function (R, ri) {
      var task = self.roomTask[ri], o = self.rooms[ri];
      if (!task) { o.plate.style.display = "none"; o.rack.style.display = "none"; return; }
      o.plate.style.display = ""; o.rack.style.display = "";
      var c = task.issue_counts || {}, online = !!task.machine_online, agents = task.agents || [];
      env.kanban[ri] = [c.todo || 0, c.in_progress || 0, c.in_review || 0, c.done || 0];
      o.plate.querySelector(".nm").textContent = task.title || task.id;
      o.plate.querySelector(".lamp").className = "lamp" + (online ? "" : " off");
      o.plate.classList.toggle("meeting", !!task.meeting_active);
      var p = Math.max(0, Math.min(100, task.progress || 0));
      o.plate.querySelector(".pbar i").style.width = p + "%"; o.plate.querySelector(".pv").textContent = p + "%";
      o.plate.querySelector(".mc").textContent = "在岗 " + agents.filter(function (a) { return online && a.state === "working"; }).length + "/" + agents.length;
      o.plate.title = "进度取自 loop-collab 日报「总进度」；点击查看团队详情";
      o.kb.innerHTML = "<b>" + (c.todo || 0) + "</b><b>" + (c.in_progress || 0) + "</b><b>" + (c.in_review || 0) + "</b><b>" + (c.done || 0) + "</b>";
      o.kb.title = "看板四列：待办 " + (c.todo || 0) + " · 进行 " + (c.in_progress || 0) + " · 评审 " + (c.in_review || 0) + " · 完成 " + (c.done || 0) + "（便签数 = 真实 issue 数，每列最多画 8 张）";
      o.rack.innerHTML = '<i class="led' + (online ? "" : " off") + '"></i>' + esc(task.machine || "");
      o.rack.title = "运行机器（MultiCA runtime）" + (online ? "在线" : "离线");
      if (task.meeting_active) { o.meet.style.display = ""; o.meet.textContent = task.meeting_title || "会议中"; o.meet.title = "会议中：" + (task.meeting_title || ""); } else o.meet.style.display = "none";
      if (!online) { o.off.style.display = ""; o.off.innerHTML = "<b>机器离线</b><span>" + esc(task.machine || "") + " 未连上 MultiCA，本队成员暂不在场</span>"; } else o.off.style.display = "none";
      self.updateStages(ri, task);
      var pref = ROLE_DESK[task.id] || [], taken = {}, deskOf = {}, ciTaken = {};
      agents.forEach(function (a) { var k = pref.indexOf(a.name); if (k >= 0 && k < R.desks.length && !taken[k]) { deskOf[a.name] = k; taken[k] = 1; } });
      agents.forEach(function (a) { if (deskOf[a.name] == null) { deskOf[a.name] = -1; for (var k = 0; k < R.desks.length; k++) if (!taken[k]) { deskOf[a.name] = k; taken[k] = 1; break; } } });
      Object.keys(self.agents).forEach(function (k) { var A = self.agents[k]; if (A.ri === ri) ciTaken[A.ci] = 1; });
      var meetSeat = 0;
      agents.forEach(function (a) {
        var key = task.id + ":" + a.name; seen[key] = 1;
        var A = self.agents[key];
        if (!A) {
          var ci = hash(a.name) % S.CHAR_COUNT, n = 0;
          while (ciTaken[ci] && n++ < S.CHAR_COUNT) ci = (ci + 1) % S.CHAR_COUNT;
          ciTaken[ci] = 1;
          A = self.agents[key] = self.newAgent(key, a, ri, ci);
        }
        A.data = a; A.task = task; A.ri = ri; A.desk = deskOf[a.name];
        var mode = !online || a.state === "offline" ? "off" : a.state === "working" ? (MEET_RE.test(a.issue_title || "") ? "host" : PATROL_RE.test(a.issue_title || "") ? "patrol" : "work") : a.state === "meeting" ? "meet" : "idle";
        if (mode === "meet") A.meetSeat = meetSeat++ % Math.max(1, R.meet.seats.length);
        self.setMode(A, mode);
      });
    });
    Object.keys(this.agents).forEach(function (k) { if (!seen[k]) self.removeAgent(self.agents[k]); });
    this.updateNotice(); this.updateTV(true);
    this.dirtyCam = true; this.kick();
  };

  O.updateStages = function (ri, task) {
    var o = this.rooms[ri], R = o.R, env = this.env;
    if (R.line) {
      var ord = null, fin = null;
      (task.agents || []).forEach(function (a) { if (!ord && a.state === "working") ord = parseOrder(a.issue_title); });
      (task.latest_issues || []).forEach(function (it) { if (!ord && it.status !== "cancelled" && it.status !== "done") ord = parseOrder(it.title); });
      if (!ord) (task.latest_issues || []).forEach(function (it) { if (!fin && it.status === "done") fin = parseOrder(it.title); });
      env.lineMoving = !!(ord && task.machine_online);
      o.stState = R.line.stages.map(function (_, k) { return !ord ? (fin ? "done" : "") : (k === ord.k || (k === 0 && ord.both)) ? "cur" : k < ord.k ? "done" : ""; });
      o.st.forEach(function (e, k) { e.className = "stchip " + o.stState[k]; });
      if (ord) { o.crate.textContent = ord.app; o.linecap.innerHTML = "执行单 <b>" + esc(ord.app) + "</b> · " + esc(ord.stage) + (ord.info.length ? " · " + esc(ord.info.join(" · ")) : ""); o.linecap.title = ord.title; }
      else if (fin) { o.crate.textContent = fin.app + " ✓"; o.linecap.innerHTML = "最近完成：<b>" + esc(fin.app) + "</b>"; o.linecap.title = fin.title; }
      else { o.linecap.textContent = "暂无进行中的执行单"; o.linecap.title = ""; }
      o.crate.style.display = ord || fin ? "" : "none";
      this.lineApp = ord ? ord.app : fin ? fin.app : ""; this.lineK = ord ? ord.k : fin ? 6 : -1;
    }
    if (o.relay) {
      var work = {}; (task.agents || []).forEach(function (a) { if (a.state === "working" && task.machine_online) work[a.name] = a; });
      Array.prototype.forEach.call(o.relay.querySelectorAll("span"), function (e) {
        var n = e.getAttribute("data-n"), a = work[n]; e.className = a ? "on" : "";
        e.title = n + (a ? " 正在处理 " + (a.issue || "") + " " + (a.issue_title || "") : " 当前没有 run");
      });
    }
  };
  O.updateNotice = function () {
    var self = this, html = "<h5>公告栏 · 各队最新动态</h5>";
    this.tasks.forEach(function (task) {
      var it = (task.latest_issues || [])[0]; if (!it) return;
      var url = self.h.issueUrl ? self.h.issueUrl(task, it.key) : "#";
      html += '<a target="_blank" rel="noopener" href="' + url + '" title="' + esc(it.title) + '"><b>' + esc(it.key) + "</b>" + esc(it.title) + "</a>";
    });
    this.noticeEl.innerHTML = html;
  };
  O.updateTV = function (keep) {
    var list = this.tasks; if (!list.length) return;
    this.tvIdx = keep && this.tvIdx != null ? this.tvIdx % list.length : ((this.tvIdx == null ? -1 : this.tvIdx) + 1) % list.length;
    var t = list[this.tvIdx], c = t.issue_counts || {}, ag = t.agents || [];
    var on = ag.filter(function (a) { return t.machine_online && a.state === "working"; }).length;
    this.tvEl.innerHTML = "<b>" + esc(t.title || t.id) + "</b><span>进度 " + (t.progress || 0) + "% · 在岗 " + on + "/" + ag.length + "</span><span>进行 " + (c.in_progress || 0) + " · 评审 " + (c.in_review || 0) + " · 完成 " + (c.done || 0) + "</span>";
    this.tvEl.title = "休息区电视轮播四个团队的实时数据";
  };
  O.tickClock = function (text, next) { this.clockEl.querySelector(".ct").textContent = text; this.clockEl.querySelector(".cn").textContent = next; };

  /* ---------------- 人物 ---------------- */
  O.newAgent = function (key, a, ri, ci) {
    var self = this, sp = M.spawn;
    var A = { key: key, name: a.name, ri: ri, ci: ci, x: sp.x, y: sp.y, px: sp.x * T + 8, py: sp.y * T + 16, dir: "down", path: [], goal: null,
      mode: "", act: null, actT: 0, frameT: Math.random() * 3, sit: false, anim: "idle", emote: null, sayT: 0, hidden: true, born: true };
    A.box = this.el("aov");                 // 头顶气泡
    A.bubEl = this.el("abub", "div", A.box); A.bubEl.style.display = "none";
    A.lineEl = this.el("aline");            // 名牌 + 执行中的 issue 编号
    A.nameEl = this.el("aname", "div", A.lineEl);
    A.tagEl = this.el("atag", "a", A.lineEl); A.tagEl.target = "_blank"; A.tagEl.rel = "noopener"; A.tagEl.style.display = "none";
    A.sizeDirty = true;
    A.nameEl.addEventListener("click", function () { self.h.onAgent && self.h.onAgent(A.task, A.data); });
    return A;
  };
  O.removeAgent = function (A) { A.box.remove(); A.lineEl.remove(); this.release(A); delete this.agents[A.key]; };
  O.release = function (A) { if (A.resKey && this.res[A.resKey] === A.key) delete this.res[A.resKey]; A.resKey = null; };
  O.reserve = function (A, x, y) { var k = x + "," + y; if (this.res[k] && this.res[k] !== A.key) return false; this.release(A); this.res[k] = A.key; A.resKey = k; return true; };

  O.setMode = function (A, mode) {
    var a = A.data, task = A.task;
    A.full = a.name; A.short = shortName(a.name); A.nameEl.textContent = this.cam.s >= 2.2 ? A.full : A.short; A.sizeDirty = true;
    A.nameEl.className = "aname " + (mode === "idle" ? "idle" : mode === "meet" || mode === "host" ? "meeting" : mode === "off" ? "" : "working");
    A.nameEl.title = a.name + (a.role ? " · " + a.role : "") + (a.model ? " · " + a.model : "");
    if ((mode === "work" || mode === "host" || mode === "patrol") && a.issue) {
      A.tagEl.style.display = ""; A.tagEl.textContent = a.issue; A.tagEl.href = this.h.issueUrl ? this.h.issueUrl(task, a.issue) : "#"; A.tagEl.title = a.issue_title || "";
    } else A.tagEl.style.display = "none";
    if (mode === A.mode && mode !== "idle") { this.plan(A); return; }
    var was = A.mode; A.mode = mode;
    if (mode === "off") { A.hidden = true; A.box.style.display = "none"; A.lineEl.style.display = "none"; this.release(A); A.path = []; return; }
    A.box.style.display = ""; A.lineEl.style.display = "";
    if (A.hidden) {   // 上线：从大厅入口出现
      A.hidden = false; A.x = M.spawn.x; A.y = M.spawn.y; A.px = A.x * T + 8; A.py = A.y * T + 16; A.sit = false;
      if (!A.born) this.effects.push({ x: A.px, y: A.py, t: 0 });
      var first = A.born; A.born = false;
      if (reduce || first) { A.act = null; A.actT = 0; this.plan(A); this.snap(A); return; }
    }
    if (mode === "idle" && was !== "idle") { A.actT = 0; A.act = null; }
    this.plan(A);
    if (reduce) this.snap(A);
  };

  /* 根据模式定目标：工作→自己工位；会议→会议座/主持位；巡检→在队友身后转；休息→活动调度 */
  O.plan = function (A) {
    var R = M.rooms[A.ri], g = null;
    if (A.mode !== "idle") { this.release(A); if (A.chatWith) { A.chatWith.chatWith = null; A.chatWith = null; } A.act = null; }
    if (A.mode === "work") {
      var d = R.desks[A.desk];
      g = d ? { x: d.seat.x, y: d.seat.y, face: d.face, sit: true, anim: /审计|核验|评审|验收|终验|复核|review/i.test(A.data.issue_title || "") ? "read" : "type", pc: d.pc }
            : { x: R.rack.x, y: R.rack.y + 2, face: "up", anim: "idle" };
    } else if (A.mode === "host") { var h = R.meet.host; g = { x: h.x, y: h.y, face: h.face, anim: "idle", talk: true }; }
    else if (A.mode === "meet") { var s = R.meet.seats[A.meetSeat || 0]; g = { x: s.x, y: s.y, face: s.face, sit: true, anim: "idle" }; }
    else if (A.mode === "patrol") g = this.patrolGoal(A);
    else if (A.mode === "idle") { if (!A.act || A.actT <= 0) this.pickIdle(A); return; }
    if (g) this.goTo(A, g);
  };
  O.patrolGoal = function (A) {
    var R = M.rooms[A.ri], d = R.desks[(A.patrolI = ((A.patrolI || 0) + 1) % R.desks.length)];
    var off = d.face === "up" ? [0, 1] : d.face === "right" ? [-1, 0] : [1, 0], x = d.seat.x + off[0], y = d.seat.y + off[1];
    if (!M.walkable(x, y)) { x = d.seat.x; y = d.seat.y + 1; }
    A.actT = rnd(5, 9);
    return { x: x, y: y, face: d.face, anim: "idle" };
  };
  O.goTo = function (A, g) {
    A.goal = g;
    if (A.x === g.x && A.y === g.y) { A.path = []; this.arrive(A); return; }
    var p = bfs(A.x, A.y, g.x, g.y);
    if (!p) { A.path = []; A.goal = null; A.actT = 1; return; }
    A.path = p; A.sit = false; A.emote = null;
  };
  O.snap = function (A) {
    var g = A.goal; if (!g) return;
    A.x = g.x; A.y = g.y; A.px = g.x * T + 8; A.py = g.y * T + 16; A.path = []; this.arrive(A);
  };
  O.arrive = function (A) {
    var g = A.goal; if (!g) return;
    A.dir = g.face || A.dir; A.sit = !!g.sit; A.anim = g.anim || "idle";
    if (g.emote) A.emote = { k: g.emote, t: rnd(5, 10) };
  };

  /* 休息时的活动：回座位看资料、喝咖啡、接水、坐沙发、打乒乓、看公告、在本房间转转、找同事聊两句；夜里多在座位上打盹 */
  O.pickIdle = function (A) {
    var R = M.rooms[A.ri], h = this.env.hour, night = h >= 22 || h < 8, self = this, r = Math.random(), g = null, d = R.desks[A.desk];
    this.release(A); A.act = null; A.emote = null;
    if (A.chatWith) { A.chatWith.chatWith = null; A.chatWith = null; }
    if (night && d && r < 0.7) { g = { x: d.seat.x, y: d.seat.y, face: d.face, sit: true, anim: "idle", emote: "zzz" }; A.act = "sleep"; A.actT = rnd(60, 160); }
    else if (d && r < 0.28) { g = { x: d.seat.x, y: d.seat.y, face: d.face, sit: true, anim: "read" }; A.act = "desk"; A.actT = rnd(15, 40); }
    else if (r < 0.44 && R.idle.length) {
      var s = pick(R.idle);
      if (this.reserve(A, s.x, s.y)) { g = { x: s.x, y: s.y, face: s.face, anim: "idle", emote: s.act === "browse" ? "book" : s.act === "device" || s.act === "think" ? "bulb" : null }; A.act = s.act; A.actT = rnd(8, 20); }
    }
    else if (r < 0.56) { g = this.chatGoal(A); if (g) { A.act = "chat"; A.actT = rnd(8, 14); } }
    if (!g) {
      var spots = M.publicSpots.filter(function (s) { return !self.res[s.x + "," + s.y] && !(s.act === "pingpong" && s.pair === 2); });
      var s2 = spots.length ? pick(spots) : null;
      if (s2 && s2.act === "pingpong") {   // 找个也在休息的人一起打
        var mate = this.freeIdle(A), other = M.publicSpots.filter(function (x) { return x.act === "pingpong" && x.pair === 2; })[0];
        if (mate && other && !this.res[other.x + "," + other.y] && this.reserve(mate, other.x, other.y)) {
          if (mate.chatWith) { mate.chatWith.chatWith = null; mate.chatWith = null; }
          mate.act = "pingpong"; mate.actT = 30; mate.emote = null; this.goTo(mate, { x: other.x, y: other.y, face: other.face, anim: "idle" });
        } else s2 = spots.filter(function (x) { return x.act !== "pingpong"; })[0] || null;
      }
      if (s2 && this.reserve(A, s2.x, s2.y)) {
        var em = { coffee: "coffee", water: "water", vending: "coffee", sofa: night ? "zzz" : (Math.random() < 0.4 ? "note" : null), sitchat: "coffee", browse: "book", notice: "dots" }[s2.act] || null;
        g = { x: s2.x, y: s2.y, face: s2.face, sit: !!s2.sit, anim: s2.sit && Math.random() < 0.5 ? "read" : "idle", emote: em };
        A.act = s2.act; A.actT = s2.act === "sofa" ? rnd(20, 50) : s2.act === "pingpong" ? 30 : rnd(10, 25);
      }
    }
    if (!g && d) { g = { x: d.seat.x, y: d.seat.y, face: d.face, sit: true, anim: "read" }; A.act = "desk"; A.actT = rnd(10, 30); }
    if (g) this.goTo(A, g); else A.actT = 5;
  };
  O.freeIdle = function (A) {
    var self = this, c = Object.keys(this.agents).map(function (k) { return self.agents[k]; }).filter(function (B) { return B !== A && !B.hidden && B.mode === "idle" && B.act !== "pingpong" && B.act !== "chat" && B.act !== "sleep"; });
    return c.length ? pick(c) : null;
  };
  O.chatGoal = function (A) {
    var B = this.freeIdle(A); if (!B || B.path.length) return null;
    var opts = [[1, 0, "left"], [-1, 0, "right"], [0, 1, "up"], [0, -1, "down"]];
    for (var i = 0; i < opts.length; i++) {
      var x = B.x + opts[i][0], y = B.y + opts[i][1];
      if (M.walkable(x, y) && !this.res[x + "," + y] && this.reserve(A, x, y)) { A.chatWith = B; B.chatWith = A; return { x: x, y: y, face: opts[i][2], anim: "idle" }; }
    }
    return null;
  };

  /* 说话内容：全部来自真实数据 */
  O.lines = function (A) {
    var a = A.data, t = A.task, L = [], c = t.issue_counts || {};
    if (A.mode === "work" || A.mode === "patrol") {
      if (a.issue) L.push({ k: a.issue, s: short(a.issue_title, 34) });
      var ord = parseOrder(a.issue_title);
      if (ord) { L.push({ s: ord.app + " · " + ord.stage }); if (ord.info.length) L.push({ s: ord.info.join(" · ") }); }
      var m = minsSince(a.since); if (m >= 0) L.push({ s: "这一轮已跑 " + (m >= 60 ? (m / 60).toFixed(1) + " 小时" : m + " 分钟") });
      if (A.mode === "patrol") L.push({ s: "巡检：" + short(a.issue_title, 26) });
    } else if (A.mode === "host") L.push({ s: "主持：" + short(a.issue_title, 30) });
    else if (A.mode === "meet") L.push({ s: short(t.meeting_title || "开会中", 30) });
    else {
      L.push({ s: "待命中，手上没有 run" });
      L.push({ s: "团队进度 " + (t.progress || 0) + "%（日报）" });
      L.push({ s: "本队进行 " + (c.in_progress || 0) + " · 评审 " + (c.in_review || 0) + " · 待办 " + (c.todo || 0) });
      L.push({ s: "下一场：" + nextRitual() });
      var li = (t.latest_issues || [])[0];
      if (li) L.push({ k: li.key, s: short(li.title, 26) });
      var done = (t.latest_issues || []).filter(function (it) { var mm = minsSince(it.updated_at); return it.status === "done" && mm >= 0 && mm < 90; })[0];
      if (done) L.push({ k: done.key, s: " 刚完成", em: "check" });
      if (a.model) L.push({ s: "模型 " + a.model });
    }
    return L;
  };
  O.say = function (A, line, dur) {
    if (!line || A.hidden) return;
    var url = line.k && this.h.issueUrl ? this.h.issueUrl(A.task, line.k) : "";
    A.bubEl.innerHTML = (line.k ? (url ? '<a href="' + url + '" target="_blank" rel="noopener"><b>' + esc(line.k) + "</b></a>" : "<b>" + esc(line.k) + "</b>") : "") + esc(line.s || "");
    A.bubEl.style.display = ""; A.sayT = dur || 5; A.sizeDirty = true;
    if (line.em) A.emote = { k: line.em, t: 3 };
  };
  O.talk = function (dt) {
    var self = this;
    this.talkT -= dt; if (this.talkT > 0) return;
    this.talkT = rnd(2.2, 4.2);
    var cand = Object.keys(this.agents).map(function (k) { return self.agents[k]; }).filter(function (A) { return !A.hidden && A.sayT <= 0 && !A.path.length && A.act !== "sleep"; });
    if (!cand.length) return;
    var w = cand.map(function (A) { return A.mode === "work" ? 3 : A.mode === "host" ? 4 : A.act === "chat" ? 3 : 1; });
    var r = Math.random() * w.reduce(function (a, b) { return a + b; }, 0), A = cand[0];
    for (var i = 0; i < cand.length; i++) { r -= w[i]; if (r <= 0) { A = cand[i]; break; } }
    this.say(A, pick(this.lines(A)), A.mode === "work" ? 6 : 4.5);
    var B = A.chatWith;
    if (B && !B.hidden && A.act === "chat") setTimeout(function () { if (B.sayT <= 0 && !B.hidden) self.say(B, pick(self.lines(B)), 4); }, 1800);
  };

  /* ---------------- 宠物 ---------------- */
  O.addPets = function () {
    var self = this;
    ["claudio", "gitcat"].forEach(function (k, i) {
      var s = M.petSpots[i * 2];
      self.pets.push({ kind: k, x: s.x, y: s.y, px: s.x * T + 8, py: s.y * T + 16, dir: "down", path: [], anim: "idle", t: rnd(2, 6), f: Math.random() * 2 });
    });
  };
  O.stepPet = function (P, dt) {
    var self = this;
    if (P.path.length) { this.move(P, dt, PET_WALK); P.anim = "walk"; return; }
    P.anim = "idle"; P.t -= dt;
    if (P.t > 0) return;
    var target = null;
    if (Math.random() < 0.35) {   // 去蹭一个正在休息的人
      var idle = Object.keys(this.agents).map(function (k) { return self.agents[k]; }).filter(function (A) { return !A.hidden && A.mode === "idle" && !A.path.length; });
      if (idle.length) { var A = pick(idle), opts = [[0, 1], [1, 0], [-1, 0]]; for (var i = 0; i < 3; i++) { var x = A.x + opts[i][0], y = A.y + opts[i][1]; if (M.walkable(x, y)) { target = { x: x, y: y, visit: A }; break; } } }
    }
    if (!target) { var s = pick(M.petSpots); target = { x: s.x, y: s.y }; }
    P.path = bfs(P.x, P.y, target.x, target.y) || []; P.visit = target.visit || null; P.t = rnd(4, 12);
  };
  O.move = function (E, dt, speed) {
    var n = E.path[0], tx = n.x * T + 8, ty = n.y * T + 16, dx = tx - E.px, dy = ty - E.py, dist = Math.hypot(dx, dy), mv = speed * dt;
    E.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    if (dist <= mv) { E.px = tx; E.py = ty; E.x = n.x; E.y = n.y; E.path.shift(); return true; }
    E.px += dx / dist * mv; E.py += dy / dist * mv; return false;
  };

  /* ---------------- 每帧更新 ---------------- */
  O.step = function (dt) {
    var self = this, coffee = false, pp = 0;
    this.t += dt * 1000;
    this.env.hour = bj().getUTCHours();
    Object.keys(this.agents).forEach(function (k) {
      var A = self.agents[k];
      if (A.hidden) return;
      A.frameT += dt;
      if (A.sayT > 0) { A.sayT -= dt; if (A.sayT <= 0) { A.bubEl.style.display = "none"; A.sizeDirty = true; } }
      if (A.emote) { A.emote.t -= dt; if (A.emote.t <= 0) A.emote = null; }
      if (A.path.length) { if (self.move(A, dt, WALK) && !A.path.length) self.arrive(A); return; }
      var at = A.goal && A.x === A.goal.x && A.y === A.goal.y;
      if (at && A.act === "coffee") coffee = true;
      if (at && A.act === "pingpong") pp++;
      if (A.mode === "idle") { A.actT -= dt; if (A.actT <= 0) self.pickIdle(A); }
      else if (A.mode === "patrol") { A.actT -= dt; if (A.actT <= 0) self.goTo(A, self.patrolGoal(A)); }
      else if (A.goal && !at) self.goTo(A, A.goal);
    });
    this.env.coffeeBusy = coffee; this.env.pingpong = pp >= 2;
    this.pets.forEach(function (P) {
      self.stepPet(P, dt); P.f += dt;
      if (P.visit && !P.path.length) { if (Math.abs(P.visit.x - P.x) + Math.abs(P.visit.y - P.y) <= 1 && !P.visit.hidden) P.visit.emote = { k: "heart", t: 3 }; P.visit = null; }
    });
    this.effects = this.effects.filter(function (e) { e.t += dt; return e.t < 0.8; });
    if (this.hl && this.hlT < 1e8) { this.hlT -= dt; if (this.hlT <= 0) this.hl = null; }
    this.talk(dt);
    this.tvT = (this.tvT || 0) + dt; if (this.tvT > 6) { this.tvT = 0; this.updateTV(); }
  };
  O.simulate = function (sec) { for (var i = 0; i < sec * 20; i++) this.step(0.05); };

  /* ---------------- 绘制 ---------------- */
  O.draw = function () {
    var c = this.c, cam = this.cam, dpr = this.dpr || 1, self = this, t = this.t;
    if (!this.W) return;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#0b1020"; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.bg) return;
    c.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, Math.round(cam.ox * dpr), Math.round(cam.oy * dpr)); c.imageSmoothingEnabled = false;
    c.drawImage(this.bg, 0, 0);
    var list = [], env = this.env, busyPC = {};
    this.walls.forEach(function (w) { list.push({ z: w.z, f: function () { if (w.img) c.drawImage(w.img, w.x, w.y); else { c.fillStyle = "#1a2238"; c.fillRect(w.x, w.y + 16, 16, 16); } } }); });
    Object.keys(this.agents).forEach(function (k) { var A = self.agents[k]; if (!A.hidden && !A.path.length && A.mode === "work" && A.goal && A.goal.pc && A.x === A.goal.x && A.y === A.goal.y) busyPC[A.goal.pc.x + "," + A.goal.pc.y] = 1; });
    if (!this.failed) M.items.forEach(function (it) {
      if (it.p) { var fn = S.paint[it.p]; if (fn) list.push({ z: it.z, f: function () { fn(c, it, t, env); } }); return; }
      var on = it.pc && busyPC[it.x + "," + it.y], name = it.t === "PC_FRONT_OFF" && on ? "PC_FRONT_ON_" + (1 + (Math.floor(t / 180) % 3)) : it.t;
      list.push({ z: it.z, f: function () {
        S.draw(c, name, it.px, it.py, it.flip);
        if (on && it.t === "PC_SIDE") { c.fillStyle = (Math.floor(t / 300) % 2) ? "rgba(125,211,252,.6)" : "rgba(186,230,253,.5)"; c.fillRect(it.px + (it.flip ? 4 : 7), it.py + 10, 5, 7); }
      } });
    });
    var R3 = M.rooms.filter(function (R) { return R.line; })[0], o3 = R3 ? this.rooms[M.rooms.indexOf(R3)] : null;
    if (R3 && !this.failed) {   // 任务3：工序机与在制品箱
      var L = R3.line;
      L.machines.forEach(function (mx, k) { list.push({ z: (L.y + 1) * T + 0.3, f: function () { S.paint.machine(c, mx, L.y, t, (o3.stState || [])[k], k); } }); });
      if (this.lineApp && this.lineK >= 0) {
        var fin = this.lineK >= 6, bx = fin ? L.out * T + 10 : L.machines[this.lineK] * T + 2, by = L.y * T + (fin ? 2 : 11), bob = env.lineMoving ? (Math.floor(t / 300) % 2) : 0;
        list.push({ z: (L.y + 1) * T + 0.4, f: function () { S.paint.crate(c, bx, by, bob); } });
        this.moveAnchor(o3.crate, bx + 6, by - 3);
      }
    }
    Object.keys(this.agents).forEach(function (k) {
      var A = self.agents[k]; if (A.hidden) return;
      var moving = A.path.length > 0, fr;
      if (moving) fr = [0, 1, 2, 1][Math.floor(A.frameT / 0.14) % 4];
      else if (A.sit && A.anim === "type") fr = 3 + (Math.floor(A.frameT / 0.3) % 2);
      else if (A.sit && A.anim === "read") fr = 5 + (Math.floor(A.frameT / 1.1) % 2);
      else if (A.sit) fr = 3;
      else if (A.goal && A.goal.talk) fr = (Math.floor(A.frameT / 0.6) % 3) ? 1 : 5;
      else fr = 1;
      var dy = (A.sit && !moving ? SIT_DY : 0) - FOOT, z = A.py + 0.5;
      if (A.sit && !moving && self.seatZ[A.x + "," + A.y] != null) z = Math.max(z, self.seatZ[A.x + "," + A.y] + 0.5);
      list.push({ z: z, f: function () {
        if (self.hl === A) { var pr = 9 + (Math.floor(t / 150) % 3); c.strokeStyle = "#fbbf24"; c.lineWidth = 1; c.strokeRect(A.px - pr, A.py - 3 + dy - pr * 0.4, pr * 2, pr * 0.8 + 3); }
        if (self.hover === A) { c.fillStyle = "rgba(255,255,255,.7)"; c.fillRect(A.px - 7, A.py - 2 + dy, 14, 3); }
        else if (!A.sit || moving) { c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(A.px - 5, A.py - 2 - FOOT, 10, 2); }
        if (self.failed) { c.fillStyle = "#2f5bea"; c.fillRect(A.px - 5, A.py - 22 + dy, 10, 20); return; }
        S.char(c, A.ci, A.dir, fr, A.px, A.py + dy);
      } });
    });
    this.pets.forEach(function (P) {
      list.push({ z: P.py + 0.4, f: function () {
        var fr = P.anim === "walk" ? Math.floor(P.f / 0.16) : Math.floor(P.f / 0.55);
        c.fillStyle = "rgba(0,0,0,.16)"; c.fillRect(P.px - 5, P.py - 2 - FOOT + 2, 10, 2);
        if (!self.failed) S.pet(c, P.kind, P.dir, P.anim, fr, P.px, P.py - FOOT + 3);
      } });
    });
    list.sort(function (a, b) { return a.z - b.z; });
    for (var i = 0; i < list.length; i++) list[i].f();
    Object.keys(this.agents).forEach(function (k) { var A = self.agents[k]; if (!A.hidden && A.emote && !A.path.length) S.emote(c, A.emote.k, A.px + 11, A.py - FOOT - 22 + (A.sit ? SIT_DY : 0), t); });
    this.effects.forEach(function (e) { S.sparkle(c, e.x, e.y - FOOT, e.t / 0.8); });
    M.rooms.forEach(function (R, ri) { var task = self.roomTask[ri]; if (task && !task.machine_online) { c.fillStyle = "rgba(15,23,42,.55)"; c.fillRect(R.x0 * T, (R.y0 - 2) * T, (R.x1 - R.x0 + 1) * T, (R.y1 - R.y0 + 3) * T); } });
    var hr = env.hour;
    if (hr >= 22 || hr < 6) { c.fillStyle = "rgba(10,18,52,.28)"; c.fillRect(0, 0, PW, PH); }
    else if (hr >= 19 || hr < 7) { c.fillStyle = "rgba(40,30,80,.12)"; c.fillRect(0, 0, PW, PH); }
    this.placeAgentsOverlay();
    if (this.dirtyCam) { this.placeAnchors(); this.dirtyCam = false; }
    if (QS.get("debug")) {   // 调试：把人物状态写进页面，供无头浏览器导出检查
      var dbg = document.getElementById("po-debug") || document.body.appendChild(Object.assign(document.createElement("pre"), { id: "po-debug", hidden: true }));
      dbg.textContent = Object.keys(this.agents).map(function (k) { var A = self.agents[k]; return [k, A.mode, A.act, "sit=" + A.sit, A.anim, "at=" + A.x + "," + A.y, "goal=" + (A.goal ? A.goal.x + "," + A.goal.y + (A.goal.sit ? "s" : "") : "-"), "path=" + A.path.length, "dir=" + A.dir, "hid=" + A.hidden].join(" "); }).join("\n");
    }
  };
  /* 名牌：面朝屏幕坐着的人放在凳子下方（不挡显示器），其余在头顶；互相重叠时往上/下错开，放不下就先隐藏休息中的人。气泡总在头顶（坐着时在显示器上方）。 */
  O.placeAgentsOverlay = function () {
    var c = this.cam, self = this, far = c.s < 1.05, near = c.s >= 2.2, placed = [], list = [], W = this.W || 0, H = this.H || 0;
    function clampX(x, w) { return Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x)); }
    Object.keys(this.agents).forEach(function (k) { var A = self.agents[k]; if (!A.hidden) list.push(A); });
    var PRI = { host: 0, work: 1, patrol: 1, meet: 2, idle: 3 };
    list.sort(function (a, b) { return (PRI[a.mode] - PRI[b.mode]) || (b.py - a.py); });
    function hit(r) { for (var i = 0; i < placed.length; i++) { var q = placed[i]; if (r.l < q.r - 2 && r.r > q.l + 2 && r.t < q.b - 1 && r.b > q.t + 1) return q; } return null; }
    list.forEach(function (A) {
      var want = near || self.hover === A || self.hl === A ? A.full : A.short;
      if (A.nameEl.textContent !== want) { A.nameEl.textContent = want; A.sizeDirty = true; }
      A.nameEl.classList.toggle("hl", self.hl === A);
      var showLine = !far || A.mode !== "idle" || self.hover === A || self.hl === A;
      if (A.sizeDirty) { A.lw = A.lineEl.offsetWidth; A.lh = A.lineEl.offsetHeight; A.bw = A.box.offsetWidth; A.bh = A.box.offsetHeight; A.sizeDirty = false; }
      var still = !A.path.length, seatedUp = A.sit && still && A.dir === "up", dy = (A.sit && still ? SIT_DY : 0) - FOOT;
      var x0 = c.ox + A.px * c.s, x = clampX(x0, A.lw || 0), head = c.oy + (A.py - 27 + dy) * c.s, r;
      var off = x0 < -8 || x0 > W + 8 || head > H + 8 || c.oy + (A.py - FOOT) * c.s < -8;   // 人在画面外：名牌与气泡都不显示
      if (off) { A.lineEl.style.visibility = "hidden"; A.box.style.visibility = "hidden"; return; }
      A.box.style.visibility = "";
      if (showLine) {
        if (seatedUp) { var top = c.oy + (A.py - FOOT + SIT_DY + 2) * c.s; r = { l: x - A.lw / 2, r: x + A.lw / 2, t: top, b: top + A.lh, down: 1 }; }
        else r = { l: x - A.lw / 2, r: x + A.lw / 2, t: head - A.lh, b: head };
        var q = hit(r), tries = 0;
        while (q && tries < 3) { var sh = r.down ? q.b - r.t + 2 : r.b - q.t + 2; r.t += r.down ? sh : -sh; r.b += r.down ? sh : -sh; tries++; q = hit(r); }
        if (q && A.mode === "idle" && self.hover !== A && self.hl !== A) showLine = false;
        else { placed.push(r); A.lineEl.style.transform = "translate(" + Math.round(x) + "px," + Math.round(r.t) + "px) translate(-50%,0)"; }
      }
      A.lineEl.style.visibility = showLine ? "" : "hidden";
      if (A.bubEl.style.display !== "none") {
        var bx = clampX(x0, A.bw || 0), bb = seatedUp ? c.oy + (A.py - FOOT + dy - 40) * c.s : (showLine && r && !r.down ? r.t - 2 : head);
        var br = { l: bx - A.bw / 2, r: bx + A.bw / 2, t: bb - A.bh, b: bb }, n = 0, stat = self.staticRects || [];
        var hitAll = function () { return hit(br) || stat.filter(function (q) { return br.l < q.r && br.r > q.l && br.t < q.b && br.b > q.t; })[0] || null; };
        var qq = hitAll(), b0 = br.b;
        while (qq && n < 3) { var s2 = br.b - qq.t + 2; br.t -= s2; br.b -= s2; n++; qq = hitAll(); }
        if (b0 - br.b > A.bh * 1.6) { br.t += b0 - br.b; br.b = b0; }   // 挪太远就留在原位（宁可压住墙上标签，也不离开说话的人）
        if (br.t < 2) { var d2 = 2 - br.t; br.t += d2; br.b += d2; }
        placed.push(br);
        A.box.style.transform = "translate(" + Math.round(bx) + "px," + Math.round(br.b) + "px) translate(-50%,-100%)";
      }
    });
  };

  /* ---------------- 点击 ---------------- */
  O.hitAgent = function (wx, wy) {
    var self = this, hit = null, best = 1e9;
    Object.keys(this.agents).forEach(function (k) {
      var A = self.agents[k]; if (A.hidden) return;
      var dy = (A.sit && !A.path.length ? SIT_DY : 0) - FOOT;
      if (Math.abs(A.px - wx) <= 7 && wy >= A.py - 28 + dy && wy <= A.py + 2 + dy && Math.abs(A.py + dy - 12 - wy) < best) { best = Math.abs(A.py + dy - 12 - wy); hit = A; }
    });
    return hit;
  };
  O.click = function (sx, sy) {
    var w = this.toWorld(sx, sy), A = this.hitAgent(w.x, w.y);
    if (A) { this.h.onAgent && this.h.onAgent(A.task, A.data); return; }
    for (var i = 0; i < this.pets.length; i++) { var P = this.pets[i]; if (Math.abs(P.px - w.x) < 9 && w.y > P.py - FOOT - 20 && w.y < P.py - FOOT + 4) { P.t = 4; P.path = []; this.effects.push({ x: P.px, y: P.py + 6, t: 0.3 }); this.kick(); return; } }
    var ri = M.roomAt(Math.floor(w.x / T), Math.floor(w.y / T));
    if (ri >= 0 && this.roomTask[ri]) this.h.onRoom && this.h.onRoom(this.roomTask[ri]);
  };

  /* ---------------- 对外：定位与高亮 ---------------- */
  O.findAgent = function (taskId, name) { var A = this.agents[taskId + ":" + name]; return A && !A.hidden ? A : null; };
  O.focusTask = function (taskId) {
    var ri = -1, self = this; this.roomTask.forEach(function (t, i) { if (t && t.id === taskId) ri = i; });
    if (ri < 0) return; var R = M.rooms[ri]; this.focusRect(R.x0, R.y0 - 2, R.x1, R.y1); this.focused = ri; void self;
  };
  O.focusAgent = function (taskId, name) {
    var A = this.findAgent(taskId, name);
    if (!A) { this.focusTask(taskId); return; }
    this.focusRect(A.x - 6, A.y - 5, A.x + 6, A.y + 3); this.hl = A; this.hlT = 4; this.kick();
  };
  O.highlight = function (taskId, name) { var A = taskId ? this.findAgent(taskId, name) : null; if (A !== this.hl) { this.hl = A; this.hlT = A ? 1e9 : 0; this.kick(); } };
  O.flashHint = function (text) {
    var self = this; if (!this.hintEl) return;
    this.hintEl.textContent = text; this.hintEl.classList.add("flash");
    clearTimeout(this.hintTimer); this.hintTimer = setTimeout(function () { self.hintEl.textContent = self.hintText; self.hintEl.classList.remove("flash"); }, 1800);
  };

  /* ---------------- 循环 ---------------- */
  O.kick = function () { if (!this.running) this.draw(); };
  O.start = function () {
    if (this.running || !this.bg) return;
    if (reduce) { this.step(0.05); this.draw(); return; }
    this.running = true;
    var self = this, last = performance.now(), acc = 0;
    function loop(now) {
      if (document.hidden) { self.running = false; return; }
      var dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
      if (acc >= 1 / 30 && self.stage.clientWidth) { self.step(acc); self.draw(); acc = 0; }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  };

  global.PixelOffice = Office;
})(window);
