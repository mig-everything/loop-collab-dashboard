/* 像素办公室 · 素材层：图集绘制、灰度素材着色（地板/墙/地毯）、角色与宠物帧、代码绘制的道具与表情图标。
 * 位图素材来源与许可见 assets/pixel/CREDITS.md；本文件里的道具（咖啡机、传送带、看板等）为本仓库原创绘制。 */
(function (global) {
  "use strict";
  var A = global.PO_ATLAS;
  var S = global.PO_SPRITES = { img: null, ready: false };
  var cache = {};

  S.load = function (src, cb) {
    var img = new Image();
    img.onload = function () { S.img = img; S.ready = true; cb(null); };
    img.onerror = function () { cb(new Error("atlas")); };
    img.src = src;
  };
  S.has = function (name) { return !!A[name]; };
  S.size = function (name) { var r = A[name]; return r ? [r[2], r[3]] : [16, 16]; };
  S.draw = function (c, name, x, y, flip) {
    var r = A[name]; if (!r || !S.img) return;
    if (flip) { c.save(); c.translate(x + r[2], y); c.scale(-1, 1); c.drawImage(S.img, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]); c.restore(); }
    else c.drawImage(S.img, r[0], r[1], r[2], r[3], x, y, r[2], r[3]);
  };
  S.sub = function (c, name, sx, sy, w, h, x, y, flip) {
    var r = A[name]; if (!r || !S.img) return;
    if (flip) { c.save(); c.translate(x + w, y); c.scale(-1, 1); c.drawImage(S.img, r[0] + sx, r[1] + sy, w, h, 0, 0, w, h); c.restore(); }
    else c.drawImage(S.img, r[0] + sx, r[1] + sy, w, h, x, y, w, h);
  };

  /* ---------- 着色（与 pixel-agents 的 Photoshop 式 Colorize 同一算法） ---------- */
  function hsl2rgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1)), r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    var m = l - c / 2;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  S.colorized = function (name, sx, sy, w, h, col) {
    var key = name + ":" + sx + "," + sy + "," + w + "," + h + ":" + col.h + "," + col.s + "," + col.b + "," + col.c;
    if (cache[key]) return cache[key];
    var r = A[name], cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var x = cv.getContext("2d"); x.drawImage(S.img, r[0] + sx, r[1] + sy, w, h, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h), p = d.data;
    for (var i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      var L = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
      if (col.c) L = 0.5 + (L - 0.5) * (100 + col.c) / 100;
      if (col.b) L += col.b / 200;
      L = Math.max(0, Math.min(1, L));
      var rgb = hsl2rgb(col.h, col.s / 100, L); p[i] = rgb[0]; p[i + 1] = rgb[1]; p[i + 2] = rgb[2];
    }
    x.putImageData(d, 0, 0);
    return (cache[key] = cv);
  };
  S.floor = function (pattern, col) { return S.colorized(pattern, 0, 0, 16, 16, col); };
  S.wall = function (mask, col) { return S.colorized("wall_0", (mask % 4) * 16, Math.floor(mask / 4) * 32, 16, 32, col); };
  S.carpet = function (v, msCase, col) { return S.colorized("carpet_" + v, (msCase % 4) * 16, Math.floor(msCase / 4) * 16, 16, 16, col); };

  /* ---------- 角色：每张 112×96，三行（下/上/右，左=右的镜像）× 7 帧（走 0-2、打字 3-4、阅读 5-6） ---------- */
  var DIR_ROW = { down: 0, up: 1, right: 2, left: 2 };
  S.CHAR_COUNT = 6;
  S.char = function (c, ci, dir, frame, fx, fy) {   // (fx,fy)=脚底中点
    S.sub(c, "char_" + (ci % 6), frame * 16, DIR_ROW[dir] * 32, 16, 32, Math.round(fx - 8), Math.round(fy - 32), dir === "left");
  };
  /* 宠物：96×96；第 0 行 走下 0-2 + 待机下 3-5（16×32），第 1 行 走上 + 待机上，第 2 行 走右 0-2（32×32） */
  S.pet = function (c, kind, dir, anim, frame, fx, fy) {
    var name = "pet_" + kind, f = frame % 3;
    if (dir === "right" || dir === "left") { S.sub(c, name, f * 32, 64, 32, 32, Math.round(fx - 16), Math.round(fy - 32), dir === "left"); return; }
    var row = dir === "up" ? 1 : 0, col = (anim === "idle" ? 3 : 0) + f;
    S.sub(c, name, col * 16, row * 32, 16, 32, Math.round(fx - 8), Math.round(fy - 32));
  };

  /* ---------- 代码绘制的道具 ---------- */
  function R(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
  function box(c, x, y, w, h, fill, line) { R(c, x, y, w, h, line); R(c, x + 1, y + 1, w - 2, h - 2, fill); }
  var P = S.paint = {};

  /* 窗：挂在墙面（2 格高区域的下 3/4），白天天空+云、傍晚橙、夜里星星 */
  P.window = function (c, it, t, env) {
    var x = it.x * 16 + 3, y = it.y * 16 + 9, w = it.w * 16 - 6, h = 19, hr = env.hour;
    var sky = hr >= 22 || hr < 6 ? ["#0b1633", "#16244a"] : hr < 8 ? ["#f6b98a", "#9fc2e8"] : hr >= 18 ? ["#f4a261", "#6c8fc7"] : ["#8fd0ff", "#cfeeff"];
    box(c, x - 2, y - 2, w + 4, h + 4, "#6b4f35", "#3b2a1c");
    R(c, x, y, w, h, sky[0]); R(c, x, y + Math.floor(h / 2), w, Math.ceil(h / 2), sky[1]);
    if (hr >= 22 || hr < 6) { for (var i = 0; i < w; i += 7) R(c, x + (i * 5 + it.x * 3) % w, y + 2 + (i * 3) % (h - 4), 1, 1, (Math.floor(t / 900) + i) % 3 ? "#e8eeff" : "#8ea3d6"); }
    else { var cx = x + ((t / 400 + it.x * 13) % (w + 12)) - 10; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); R(c, cx, y + 4, 9, 3, "#ffffff"); R(c, cx + 2, y + 2, 5, 2, "#ffffff"); c.restore(); }
    R(c, x + Math.floor(w / 2), y, 1, h, "#3b2a1c"); R(c, x, y + Math.floor(h / 2), w, 1, "#3b2a1c");
    R(c, x - 3, y + h + 2, w + 6, 2, "#8a6a4a");
  };
  /* 看板：四列（待办/进行/评审/完成），每张便签就是一条真实 issue（每列最多画 8 张，数字另由 DOM 标出） */
  P.kanban = function (c, it, t, env) {
    var x = it.x * 16 + 2, y = it.y * 16 + 8, w = it.w * 16 - 4, h = 22, cnt = (env.kanban && env.kanban[it.room]) || [0, 0, 0, 0];
    box(c, x, y, w, h, "#f4f1e8", "#5b4636");
    var cw = Math.floor((w - 2) / 4), heads = ["#9aa3af", "#3b82f6", "#f59e0b", "#22c55e"], notes = ["#e5e7eb", "#bfdbfe", "#fde68a", "#bbf7d0"];
    for (var k = 0; k < 4; k++) {
      var cx = x + 1 + k * cw;
      R(c, cx + 1, y + 2, cw - 2, 2, heads[k]);
      if (k) R(c, cx, y + 2, 1, h - 4, "#d6d0c2");
      var n = Math.min(8, cnt[k] || 0);
      for (var j = 0; j < n; j++) R(c, cx + 1 + (j % 2) * Math.floor(cw / 2), y + 6 + Math.floor(j / 2) * 4, Math.max(2, Math.floor(cw / 2) - 1), 3, notes[k]);
    }
  };
  /* 门牌/标题板：深色底板（文字由 DOM 叠加） */
  P.plate = function (c, it) { var x = it.x * 16 + 2, y = it.y * 16 + 8, w = it.w * 16 - 4; box(c, x, y, w, 21, "#1d2740", "#0d1322"); R(c, x + 2, y + 2, w - 4, 1, "#33416a"); };
  P.sign = function (c, it) { var x = it.x * 16 + 2, y = it.y * 16 + 6, w = it.w * 16 - 4; box(c, x, y, w, 24, "#15213d", "#0a1020"); R(c, x + 2, y + 2, w - 4, 2, "#f59e0b"); R(c, x + 2, y + 20, w - 4, 1, "#2c3d66"); };
  P.notice = function (c, it, t, env) {
    var x = it.x * 16 + 2, y = it.y * 16 + 7, w = it.w * 16 - 4; box(c, x, y, w, 23, "#b98954", "#6d4a26");
    for (var i = 0; i < 4; i++) { var px = x + 3 + i * Math.floor((w - 6) / 4); R(c, px, y + 4 + (i % 2) * 2, 12, 13, "#fbfaf5"); R(c, px + 5, y + 3 + (i % 2) * 2, 2, 2, ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b"][i]); for (var l = 0; l < 3; l++) R(c, px + 2, y + 9 + (i % 2) * 2 + l * 3, 8, 1, "#c8c2b4"); }
  };
  /* 真机墙：两层架子上的手机，屏幕在跑用例 */
  P.devicewall = function (c, it, t) {
    var x = it.x * 16 + 2, y = it.y * 16 + 6, w = it.w * 16 - 4;
    for (var s = 0; s < 2; s++) {
      var sy = y + s * 12; R(c, x, sy + 10, w, 2, "#6b4f35");
      for (var i = 0; i < Math.floor(w / 9); i++) {
        var px = x + 2 + i * 9, on = (Math.floor(t / 700) + i * 3 + s) % 5;
        R(c, px, sy, 6, 10, i % 2 ? "#1f2937" : "#334155");
        R(c, px + 1, sy + 1, 4, 7, on === 0 ? "#22d3ee" : on === 1 ? "#86efac" : on === 2 ? "#e0f2fe" : on === 3 ? "#a5b4fc" : "#f8fafc");
        R(c, px + 1, sy + 2 + (Math.floor(t / 250) + i) % 5, 4, 1, "#0f172a");
      }
    }
  };
  P.testbench = function (c, it, t) {
    var x = it.x * 16, y = it.y * 16;
    R(c, x + 1, y + 8, it.w * 16 - 2, 14, "#9b7250"); R(c, x + 1, y + 8, it.w * 16 - 2, 3, "#c49a6c"); R(c, x + 3, y + 22, 3, 8, "#5b4636"); R(c, x + it.w * 16 - 6, y + 22, 3, 8, "#5b4636");
    for (var i = 0; i < 4; i++) { var px = x + 5 + i * 10, on = (Math.floor(t / 600) + i) % 4; R(c, px, y + 1, 7, 11, "#111827"); R(c, px + 1, y + 2, 5, 8, on ? "#bae6fd" : "#4ade80"); R(c, px + 3, y + 12, 1, 3, "#374151"); }
  };
  /* 传送带（任务3）：两行高；带面条纹随执行单推进而移动 */
  P.conveyor = function (c, it, t, env) {
    var x = it.x * 16, y = it.y * 16 + 16, w = it.w * 16, mv = env.lineMoving ? Math.floor(t / 90) % 6 : 0;
    R(c, x, y + 2, w, 12, "#374151"); R(c, x, y + 3, w, 8, "#4b5563");
    for (var i = -6; i < w; i += 6) R(c, x + i + mv, y + 4, 3, 6, "#6b7280");
    R(c, x, y + 11, w, 2, "#1f2937"); for (var k = 0; k < w; k += 16) R(c, x + k + 3, y + 13, 3, 3, "#111827");
    // 左端安卓来料筐、右端鸿蒙成品架
    box(c, x + 1, y - 6, 14, 14, "#3ddc84", "#15803d"); R(c, x + 4, y - 3, 8, 1, "#e7fbe9"); R(c, x + 4, y, 8, 1, "#e7fbe9");
    var ox = (env.line.out) * 16; box(c, ox, y - 12, 30, 22, "#e5e7eb", "#6b7280"); R(c, ox + 2, y - 2, 26, 1, "#9ca3af");
  };
  /* 工序机：跨在带子上；当前工序亮灯闪烁，已过工序常亮绿，未到灰 */
  P.machine = function (c, mx, y, t, st, k) {
    var x = mx * 16, top = y * 16 - 2, body = ["#64748b", "#2563eb", "#7c3aed", "#d97706", "#0d9488", "#16a34a"][k];
    var act = st === "cur" || st === "hold" || st === "nh";   // hold = 暂停、nh = 待人工：停在这道工序
    box(c, x + 1, top, 14, 22, act ? body : st === "done" ? "#94a3b8" : "#9ca3af", "#1f2937");
    R(c, x + 3, top + 3, 10, 6, "#0f172a");
    if (st === "cur") { for (var i = 0; i < 3; i++) R(c, x + 4, top + 4 + i * 2, ((Math.floor(t / 120) + i * 3) % 8) + 1, 1, "#a7f3d0"); }
    else if (act) { var pc = st === "nh" ? "#fca5a5" : "#fde68a"; R(c, x + 6, top + 4, 1, 4, pc); R(c, x + 9, top + 4, 1, 4, pc); }
    var lamp = st === "cur" ? ((Math.floor(t / 400) % 2) ? "#fde047" : "#f59e0b") : st === "nh" ? ((Math.floor(t / 500) % 2) ? "#ef4444" : "#7f1d1d") : st === "hold" ? "#f59e0b" : st === "done" ? "#22c55e" : "#4b5563";
    R(c, x + 6, top - 3, 4, 3, lamp); R(c, x + 4, top + 11, 8, 6, "#111827"); R(c, x + 5, top + 12, 6, 4, act ? "#1e293b" : "#374151");
  };
  P.crate = function (c, x, y, bob) { box(c, x, y - bob, 12, 10, "#d9a066", "#8a5a2b"); R(c, x + 5, y - bob, 2, 10, "#b7793f"); R(c, x + 1, y + 4 - bob, 10, 1, "#b7793f"); };
  P.crates = function (c, it) { var x = it.x * 16, y = it.y * 16; P.crate(c, x + 2, y + 18, 0); P.crate(c, x + 16, y + 20, 0); P.crate(c, x + 9, y + 9, 0); R(c, x + 2, y + 29, 26, 2, "rgba(0,0,0,.18)"); };
  P.easel = function (c, it) {
    var x = it.x * 16, y = it.y * 16; R(c, x + 3, y + 10, 2, 22, "#5b4636"); R(c, x + 11, y + 10, 2, 22, "#5b4636"); R(c, x + 7, y + 14, 2, 18, "#4a3a2c");
    box(c, x + 1, y + 2, 14, 16, "#fbfaf5", "#6b7280"); R(c, x + 3, y + 5, 9, 1, "#3b82f6"); R(c, x + 3, y + 8, 7, 1, "#9ca3af"); R(c, x + 3, y + 11, 8, 1, "#ef4444"); R(c, x + 3, y + 14, 5, 1, "#9ca3af");
  };
  P.reception = function (c, it) {
    var x = it.x * 16, y = it.y * 16, w = it.w * 16;
    R(c, x, y + 10, w, 20, "#7c5a3a"); R(c, x, y + 6, w, 6, "#c9a27a"); R(c, x, y + 6, w, 1, "#e8c9a3"); R(c, x + 4, y + 16, w - 8, 10, "#6b4a2e");
    R(c, x + Math.floor(w / 2) - 12, y + 18, 24, 5, "#f59e0b"); R(c, x, y + 30, w, 2, "rgba(0,0,0,.2)");
  };
  P.mat = function (c, it) { var x = it.x * 16, y = it.y * 16; box(c, x + 2, y + 3, it.w * 16 - 4, 11, "#7f1d1d", "#450a0a"); R(c, x + 5, y + 6, it.w * 16 - 10, 1, "#b45309"); R(c, x + 5, y + 10, it.w * 16 - 10, 1, "#b45309"); };
  P.counter = function (c, it) {
    var x = it.x * 16, y = it.y * 16, w = it.w * 16;
    R(c, x, y - 6, w, 6, "#cbd5e1"); R(c, x, y, w, 16, "#e2e8f0"); R(c, x, y, w, 3, "#f8fafc");
    for (var i = 0; i < it.w; i++) { R(c, x + i * 16 + 1, y + 4, 14, 11, "#cbd5e1"); R(c, x + i * 16 + 7, y + 8, 2, 3, "#64748b"); }
  };
  P.coffee = function (c, it, t, env) {
    var x = it.x * 16 + 2, y = it.y * 16 - 12;
    box(c, x, y, 12, 15, "#1f2937", "#030712"); R(c, x + 2, y + 2, 8, 4, "#374151"); R(c, x + 3, y + 3, 2, 2, (Math.floor(t / 500) % 2) ? "#22c55e" : "#16a34a");
    R(c, x + 4, y + 9, 4, 1, "#9ca3af"); R(c, x + 4, y + 11, 4, 3, "#f5f5f4");
    if (env.coffeeBusy) for (var i = 0; i < 3; i++) { var ph = (t / 900 + i / 3) % 1; c.globalAlpha = 1 - ph; R(c, x + 5 + Math.round(Math.sin(ph * 6 + i) * 1.5), y + 8 - Math.round(ph * 12), 2, 2, "#e5e7eb"); c.globalAlpha = 1; }
  };
  P.vending = function (c, it, t) {
    var x = it.x * 16, y = it.y * 16 - 16;
    box(c, x, y, 16, 32, "#b91c1c", "#450a0a"); R(c, x + 2, y + 3, 9, 20, (Math.floor(t / 1700) % 7) ? "#e0f2fe" : "#bae6fd");
    for (var r = 0; r < 4; r++) for (var k = 0; k < 3; k++) R(c, x + 3 + k * 3, y + 5 + r * 5, 2, 3, ["#f59e0b", "#22c55e", "#3b82f6", "#f43f5e"][(r + k) % 4]);
    R(c, x + 12, y + 6, 2, 6, "#1f2937"); R(c, x + 3, y + 26, 9, 3, "#1f2937");
  };
  P.fridge = function (c, it) {
    var x = it.x * 16, y = it.y * 16 - 16;
    box(c, x, y, 16, 32, "#f1f5f9", "#64748b"); R(c, x + 1, y + 11, 14, 1, "#94a3b8"); R(c, x + 12, y + 4, 2, 5, "#64748b"); R(c, x + 12, y + 14, 2, 8, "#64748b");
    R(c, x + 3, y + 4, 3, 3, "#f59e0b"); R(c, x + 6, y + 15, 3, 3, "#3b82f6");
  };
  /* 电视：屏幕文字由 DOM 轮播真实数据 */
  P.tv = function (c, it, t) {
    var x = it.x * 16, y = it.y * 16;
    R(c, x + 2, y + 8, it.w * 16 - 4, 8, "#5b4636"); R(c, x + 2, y + 8, it.w * 16 - 4, 2, "#7c5a3a");
    box(c, x + 4, y - 20, it.w * 16 - 8, 27, "#0b1224", "#030712"); R(c, x + 6, y - 18, it.w * 16 - 12, 23, (Math.floor(t / 2500) % 2) ? "#10244a" : "#0f2a52");
    R(c, x + Math.floor(it.w * 8) - 3, y + 7, 6, 2, "#111827");
  };
  P.pingpong = function (c, it, t, env) {
    var x = it.x * 16, y = it.y * 16, w = it.w * 16;
    R(c, x + 3, y + 22, 3, 9, "#1f2937"); R(c, x + w - 6, y + 22, 3, 9, "#1f2937");
    box(c, x, y + 4, w, 20, "#15803d", "#14532d"); R(c, x + 2, y + 13, w - 4, 1, "#e5e7eb"); R(c, x + Math.floor(w / 2), y + 3, 1, 22, "#f8fafc"); R(c, x + Math.floor(w / 2) - 1, y + 2, 3, 2, "#9ca3af");
    if (env.pingpong) { var ph = (t / 700) % 2, bx = ph < 1 ? ph : 2 - ph; R(c, x + 3 + Math.round(bx * (w - 8)), y + 8 - Math.round(Math.sin(bx * Math.PI) * 9), 2, 2, "#fff7ed"); }
  };
  P.phone = function (c, it, t) { var x = it.x * 16 + 4, y = it.y * 16 + 2; R(c, x, y, 7, 11, "#111827"); R(c, x + 1, y + 1, 5, 8, (Math.floor(t / 800) % 3) ? "#bae6fd" : "#86efac"); R(c, x + 2, y + 11, 3, 2, "#374151"); };
  P.toolbox = function (c, it) { var x = it.x * 16 + 2, y = it.y * 16 + 5; box(c, x, y, 12, 8, "#dc2626", "#7f1d1d"); R(c, x + 4, y - 2, 4, 2, "#7f1d1d"); R(c, x + 1, y + 3, 10, 1, "#fca5a5"); };

  /* ---------- 表情图标（头顶小气泡，纯像素） ---------- */
  S.emote = function (c, kind, x, y, t) {
    x = Math.round(x - 6); y = Math.round(y - 12);
    R(c, x, y, 13, 11, "#1f2937"); R(c, x + 1, y + 1, 11, 9, "#ffffff"); R(c, x + 5, y + 11, 3, 1, "#1f2937"); R(c, x + 6, y + 12, 1, 1, "#1f2937");
    var ix = x + 3, iy = y + 2;
    switch (kind) {
      case "coffee": R(c, ix, iy + 2, 5, 5, "#92400e"); R(c, ix + 5, iy + 3, 2, 2, "#92400e"); R(c, ix + 1, iy, 1, 2, "#9ca3af"); R(c, ix + 3, iy - 1 + (Math.floor(t / 300) % 2), 1, 2, "#9ca3af"); break;
      case "heart": R(c, ix, iy + 1, 2, 2, "#e11d48"); R(c, ix + 4, iy + 1, 2, 2, "#e11d48"); R(c, ix, iy + 2, 6, 2, "#e11d48"); R(c, ix + 1, iy + 4, 4, 1, "#e11d48"); R(c, ix + 2, iy + 5, 2, 1, "#e11d48"); break;
      case "zzz": R(c, ix, iy, 4, 1, "#3b82f6"); R(c, ix + 2, iy + 1, 1, 1, "#3b82f6"); R(c, ix + 1, iy + 2, 1, 1, "#3b82f6"); R(c, ix, iy + 3, 4, 1, "#3b82f6"); R(c, ix + 4, iy + 4, 3, 1, "#93c5fd"); R(c, ix + 5, iy + 5, 1, 1, "#93c5fd"); R(c, ix + 4, iy + 6, 3, 1, "#93c5fd"); break;
      case "dots": for (var i = 0; i < 3; i++) R(c, ix + i * 2 + (i ? i - 1 : 0), iy + 3, 1 + ((Math.floor(t / 250) % 3) === i ? 1 : 0), 1 + ((Math.floor(t / 250) % 3) === i ? 1 : 0), "#374151"); break;
      case "note": R(c, ix + 2, iy, 1, 5, "#7c3aed"); R(c, ix + 3, iy, 3, 1, "#7c3aed"); R(c, ix + 5, iy, 1, 4, "#7c3aed"); R(c, ix + 1, iy + 4, 2, 2, "#7c3aed"); R(c, ix + 4, iy + 3, 2, 2, "#7c3aed"); break;
      case "bulb": R(c, ix + 1, iy, 4, 4, "#facc15"); R(c, ix, iy + 1, 6, 2, "#facc15"); R(c, ix + 2, iy + 4, 2, 2, "#9ca3af"); break;
      case "check": R(c, ix, iy + 3, 2, 2, "#16a34a"); R(c, ix + 2, iy + 4, 1, 2, "#16a34a"); R(c, ix + 3, iy + 2, 1, 3, "#16a34a"); R(c, ix + 4, iy + 1, 1, 2, "#16a34a"); R(c, ix + 5, iy, 1, 2, "#16a34a"); break;
      case "book": R(c, ix, iy + 1, 3, 5, "#2563eb"); R(c, ix + 3, iy + 1, 3, 5, "#1d4ed8"); R(c, ix + 1, iy + 2, 1, 3, "#dbeafe"); R(c, ix + 4, iy + 2, 1, 3, "#dbeafe"); break;
      case "water": R(c, ix + 2, iy, 2, 1, "#38bdf8"); R(c, ix + 1, iy + 1, 4, 2, "#38bdf8"); R(c, ix, iy + 3, 6, 3, "#0ea5e9"); break;
      default: R(c, ix + 2, iy, 2, 4, "#dc2626"); R(c, ix + 2, iy + 5, 2, 1, "#dc2626");
    }
  };
  /* 生成特效：上线时一圈像素闪光 */
  S.sparkle = function (c, x, y, k) {
    for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2, r = 4 + k * 14; c.globalAlpha = 1 - k; R(c, Math.round(x + Math.cos(a) * r), Math.round(y - 14 + Math.sin(a) * r * 0.7), 2, 2, i % 2 ? "#a7f3d0" : "#fde68a"); }
    c.globalAlpha = 1;
  };
})(window);
