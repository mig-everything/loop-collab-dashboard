/* 像素办公室 · 平面图：墙、地面分区、家具摆放、工位/会议座位/休闲落脚点。
 * 坐标单位是格（16px）。家具的 (x,y) 是占地左上角，贴图底边对齐占地底边；墙挂件放在墙面行（墙格的上一行起画）。
 * 四个房间按任务 id 固定：任务1 研究室（左上）、任务2 评测实验室（右上）、任务3 迁移工坊（左下）、任务4 产品工作室（右下）。 */
(function (global) {
  "use strict";
  var COLS = 60, ROWS = 36;
  var VOID = 0, FLOOR = 1, WALL = 2;
  var tiles = new Uint8Array(COLS * ROWS), zone = new Array(COLS * ROWS);
  function inb(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
  function set(x, y, v) { if (inb(x, y)) tiles[y * COLS + x] = v; }
  function tile(x, y) { return inb(x, y) ? tiles[y * COLS + x] : VOID; }
  function fill(x0, y0, x1, y1, v, z) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { set(x, y, v); if (z) zone[y * COLS + x] = z; } }

  /* 地面分区：图案（floor_N）+ 着色（与 pixel-agents 同一套 HSL Colorize 参数） */
  var ZONES = {
    lib:  { floor: "floor_6", col: { h: 28, s: 46, b: -38, c: -84 } },   // 研究室：木地板
    lab:  { floor: "floor_3", col: { h: 204, s: 18, b: 6, c: -62 } },    // 实验室：浅灰蓝方砖
    fac:  { floor: "floor_4", col: { h: 210, s: 7, b: -14, c: -52 } },   // 工坊：水泥方格
    stu:  { floor: "floor_5", col: { h: 16, s: 38, b: -26, c: -78 } },   // 工作室：暖色拼木
    hall: { floor: "floor_3", col: { h: 38, s: 14, b: 4, c: -64 } },     // 走廊、大厅：米色石砖
    kit:  { floor: "floor_8", col: { h: 209, s: 0, b: -16, c: -8 } },    // 茶水间：黑白格
    lng:  { floor: "floor_0", col: { h: 209, s: 39, b: -25, c: -80 } }   // 休息区：蓝地面
  };
  var WALL_COL = { h: 214, s: 30, b: -100, c: -55 };

  /* ---------------- 墙与地面 ---------------- */
  fill(0, 1, COLS - 1, 1, WALL);                       // 顶墙
  fill(0, 1, 0, ROWS - 1, WALL); fill(COLS - 1, 1, COLS - 1, ROWS - 1, WALL);
  fill(1, 2, 18, 12, FLOOR, "lib");
  fill(20, 2, 33, 13, FLOOR, "hall");                  // 大厅（下沿敞开接走廊）
  fill(35, 2, 58, 12, FLOOR, "lab");
  fill(1, 14, 58, 16, FLOOR, "hall");                  // 走廊
  fill(1, 18, 24, ROWS - 1, FLOOR, "fac");
  fill(26, 18, 38, 22, FLOOR, "kit");
  fill(26, 23, 38, ROWS - 1, FLOOR, "lng");
  fill(40, 18, 58, ROWS - 1, FLOOR, "stu");
  fill(19, 1, 19, 13, WALL); fill(34, 1, 34, 13, WALL);                 // 上排隔墙
  fill(0, 13, 19, 13, WALL); fill(34, 13, COLS - 1, 13, WALL);          // 研究室、实验室下墙
  fill(0, 17, COLS - 1, 17, WALL);                                      // 下排上墙
  fill(25, 17, 25, ROWS - 1, WALL); fill(39, 17, 39, ROWS - 1, WALL);   // 下排隔墙
  var DOORS = [[15, 13], [16, 13], [37, 13], [38, 13], [20, 17], [21, 17], [44, 17], [45, 17], [30, 17], [31, 17], [32, 17], [33, 17], [34, 17]];
  DOORS.forEach(function (d) { set(d[0], d[1], FLOOR); zone[d[1] * COLS + d[0]] = "hall"; });

  /* ---------------- 家具 ---------------- */
  // t: 图集名；p: 代码绘制的道具；flip: 水平镜像；wall: 墙挂件（不占地）；surf: 放在桌面上（画在桌子之后）
  // fp: 占地 [w,h]（默认按贴图尺寸），bg: 顶部几行不挡路（贴图的「背景」部分）
  var FP = {
    DESK_FRONT: [3, 2, 0], TABLE_FRONT: [3, 4, 0], SMALL_TABLE_FRONT: [2, 2, 0], COFFEE_TABLE: [2, 2, 0],
    SOFA_FRONT: [2, 1, 0], SOFA_BACK: [2, 1, 0], SOFA_SIDE: [1, 2, 0], DOUBLE_BOOKSHELF: [2, 2, 1],
    LARGE_PLANT: [2, 3, 2], PLANT: [1, 2, 1], PLANT_2: [1, 2, 1], CACTUS: [1, 2, 1], BIN: [1, 1, 0], POT: [1, 1, 0],
    WOODEN_CHAIR_SIDE: [1, 2, 1], WOODEN_CHAIR_FRONT: [1, 2, 1], WOODEN_CHAIR_BACK: [1, 2, 1], WOODEN_BENCH: [1, 1, 0],
    CUSHIONED_BENCH: [1, 1, 0], CUSHIONED_CHAIR_SIDE: [1, 1, 0], CUSHIONED_CHAIR_FRONT: [1, 1, 0], CUSHIONED_CHAIR_BACK: [1, 1, 0],
    OC_SERVER_RACK: [2, 2, 1], OC_COOLER: [1, 1, 0]
  };
  var items = [];
  function put(t, x, y, o) { var it = { t: t, x: x, y: y }; if (o) for (var k in o) it[k] = o[k]; items.push(it); return it; }
  function prop(p, x, y, w, h, o) { var it = { p: p, x: x, y: y, w: w, h: h }; if (o) for (var k in o) it[k] = o[k]; items.push(it); return it; }
  function wallItem(t, x, y, o) { var it = put(t, x, y, o); it.wall = true; return it; }
  function wallProp(p, x, y, w, o) { var it = prop(p, x, y, w, 2, o); it.wall = true; return it; }

  /* 工位：朝上的桌（桌+显示器+凳），或桌岛的侧座（椅+侧面显示器） */
  function deskUp(room, x, y, o) {
    put("DESK_FRONT", x, y);
    var pc = put("PC_FRONT_OFF", x + 1, y, { surf: true, pc: true });
    put("CUSHIONED_BENCH", x + 1, y + 2, { seat: true });
    var d = { seat: { x: x + 1, y: y + 2 }, face: "up", pc: pc, desk: { x: x, y: y, w: 3 } };
    if (o && o.deco) { var dx = x + (o.decoAt != null ? o.decoAt : 2); if (global.PO_ATLAS[o.deco]) put(o.deco, dx, y, { surf: true }); else prop(o.deco, dx, y, 1, 1, { surf: true }); }
    room.desks.push(d); return d;
  }
  function island(room, x, y) {   // TABLE_FRONT 3×4，左右各两座
    put("TABLE_FRONT", x, y);
    [0, 2].forEach(function (dy) {
      var pl = put("PC_SIDE", x, y + dy, { surf: true, pc: true, side: true });
      var pr = put("PC_SIDE", x + 2, y + dy, { surf: true, pc: true, side: true, flip: true });
      put("WOODEN_CHAIR_SIDE", x - 1, y + dy, { seat: true });
      put("WOODEN_CHAIR_SIDE", x + 3, y + dy, { seat: true, flip: true });
      room.desks.push({ seat: { x: x - 1, y: y + dy + 1 }, face: "right", pc: pl });
      room.desks.push({ seat: { x: x + 3, y: y + dy + 1 }, face: "left", pc: pr });
    });
  }
  function meetTable(room, x, y, host) {   // TABLE_FRONT 3×4 + 左右四座 + 上下各一座
    put("TABLE_FRONT", x, y);
    [0, 2].forEach(function (dy) {
      put("WOODEN_CHAIR_SIDE", x - 1, y + dy, { seat: true });
      put("WOODEN_CHAIR_SIDE", x + 3, y + dy, { seat: true, flip: true });
      room.meet.seats.push({ x: x - 1, y: y + dy + 1, face: "right" }, { x: x + 3, y: y + dy + 1, face: "left" });
    });
    put("WOODEN_CHAIR_FRONT", x + 1, y - 2, { seat: true }); room.meet.seats.push({ x: x + 1, y: y - 1, face: "down" });
    put("WOODEN_CHAIR_BACK", x + 1, y + 4, { seat: true }); room.meet.seats.push({ x: x + 1, y: y + 5, face: "up" });
    put("COFFEE", x + 1, y + 1, { surf: true });
    room.meet.host = host; room.meet.table = { x: x, y: y, w: 3, h: 4 };
  }
  function mkRoom(key, task, x0, y0, x1, y1, o) {
    var r = { key: key, task: task, x0: x0, y0: y0, x1: x1, y1: y1, desks: [], meet: { seats: [], host: null }, idle: [] };
    for (var k in o) r[k] = o[k];
    return r;
  }

  var ROOMS = [];
  /* 任务1 · 研究室（文献、核验、撰写）：书架阵列 + 阅读长桌 */
  var R1 = mkRoom("lib", "task1-survey", 1, 2, 18, 12, { theme: "lib", door: { x: 15, y: 13 }, plate: { x: 2, y: 0, w: 7 }, kanban: { x: 12, y: 0, w: 3 }, rack: { x: 1, y: 10 }, label: "研究室" });
  wallItem("HANGING_PLANT", 1, 0); wallProp("window", 9, 0, 3); wallProp("kanban", 12, 0, 3, { room: 0 }); wallItem("WHITEBOARD", 15, 0); wallItem("CLOCK", 17, 0); wallItem("HANGING_PLANT", 18, 0);
  wallProp("plate", 2, 0, 7);
  deskUp(R1, 2, 3, { deco: "OC_LAMP", decoAt: 0 }); deskUp(R1, 6, 3, { deco: "COFFEE" }); deskUp(R1, 10, 3, { deco: "COFFEE", decoAt: 0 });
  meetTable(R1, 13, 6, { x: 16, y: 3, face: "down" });
  put("DOUBLE_BOOKSHELF", 3, 8); put("DOUBLE_BOOKSHELF", 5, 8); put("DOUBLE_BOOKSHELF", 8, 8); put("DOUBLE_BOOKSHELF", 10, 8);
  put("OC_SERVER_RACK", 1, 10); put("LARGE_PLANT", 17, 9); put("PLANT", 1, 3); put("BIN", 5, 5); put("CACTUS", 12, 10);
  R1.carpet = { v: 1, x0: 12, y0: 4, x1: 17, y1: 12, col: { h: 4, s: 42, b: -22, c: -30 } };
  R1.idle = [{ x: 4, y: 10, face: "up", act: "browse" }, { x: 9, y: 10, face: "up", act: "browse" }, { x: 10, y: 2, face: "up", act: "window" }];
  ROOMS.push(R1);

  /* 任务2 · 评测实验室（双端用例、真机回归）：桌岛 + 真机墙 + 测试台 */
  var R2 = mkRoom("lab", "task2-benchmark", 35, 2, 58, 12, { theme: "lab", door: { x: 37, y: 13 }, plate: { x: 36, y: 0, w: 7 }, kanban: { x: 51, y: 0, w: 3 }, rack: { x: 57, y: 3 }, label: "评测实验室" });
  wallItem("HANGING_PLANT", 35, 0); wallProp("plate", 36, 0, 7); wallProp("window", 43, 0, 3); wallProp("devicewall", 46, 0, 5); wallProp("kanban", 51, 0, 3, { room: 1 });
  wallItem("WHITEBOARD", 54, 0); wallItem("CLOCK", 56, 0); wallItem("SMALL_PAINTING", 57, 0); wallItem("HANGING_PLANT", 58, 0);
  island(R2, 40, 4);
  deskUp(R2, 46, 4, { deco: "COFFEE" }); deskUp(R2, 50, 4, { deco: "OC_LAMP", decoAt: 0 });
  prop("testbench", 45, 8, 3, 2); // 真机测试台（桌上几台手机）
  put("COFFEE_TABLE", 53, 8); put("CUSHIONED_CHAIR_SIDE", 52, 8, { seat: true }); put("CUSHIONED_CHAIR_SIDE", 52, 9, { seat: true }); put("CUSHIONED_CHAIR_SIDE", 55, 8, { seat: true, flip: true }); put("CUSHIONED_CHAIR_SIDE", 55, 9, { seat: true, flip: true });
  put("CUSHIONED_CHAIR_BACK", 53, 10, { seat: true }); put("CUSHIONED_CHAIR_BACK", 54, 10, { seat: true });
  R2.meet.seats = [{ x: 52, y: 8, face: "right" }, { x: 55, y: 8, face: "left" }, { x: 52, y: 9, face: "right" }, { x: 55, y: 9, face: "left" }, { x: 53, y: 10, face: "up" }, { x: 54, y: 10, face: "up" }];
  R2.meet.host = { x: 54, y: 6, face: "down" }; R2.meet.table = { x: 53, y: 8, w: 2, h: 2 };
  put("OC_SERVER_RACK", 57, 3); put("LARGE_PLANT", 35, 9); put("PLANT", 58, 9); put("CACTUS", 44, 2); put("BIN", 44, 9);
  R2.carpet = { v: 2, x0: 51, y0: 7, x1: 56, y1: 11, col: { h: 176, s: 30, b: -10, c: -30 } };
  R2.idle = [{ x: 46, y: 10, face: "up", act: "device" }, { x: 45, y: 2, face: "up", act: "window" }, { x: 48, y: 2, face: "up", act: "device" }];
  ROOMS.push(R2);

  /* 任务3 · 迁移工坊（DW 执行单）：传送带六道工序 + 工位 + 会议桌 */
  var R3 = mkRoom("fac", "task3-dw-migration", 1, 18, 24, ROWS - 1, { theme: "fac", door: { x: 20, y: 17 }, plate: { x: 2, y: 16, w: 7 }, kanban: { x: 12, y: 16, w: 3 }, rack: { x: 22, y: 23 }, label: "迁移工坊" });
  wallItem("HANGING_PLANT", 1, 16); wallProp("plate", 2, 16, 7); wallProp("window", 9, 16, 3); wallProp("kanban", 12, 16, 3, { room: 2 }); wallItem("WHITEBOARD", 15, 16);
  wallItem("CLOCK", 17, 16); wallItem("SMALL_PAINTING_2", 18, 16); wallProp("window", 22, 16, 3);
  // 传送带：第 20 行，x 1..16；六台工序机在 3,5,7,9,11,13；左端安卓来料，右端鸿蒙成品架
  var LINE = { y: 20, x0: 1, x1: 16, machines: [3, 5, 7, 9, 11, 13], intake: 1, out: 15, stages: ["清单", "迁移", "审计", "修复", "终验", "收口"] };
  prop("conveyor", 1, 19, 16, 2);
  deskUp(R3, 2, 23, { deco: "COFFEE" }); deskUp(R3, 6, 23, { deco: "phone" }); deskUp(R3, 10, 23, { deco: "toolbox" }); deskUp(R3, 14, 23, { deco: "COFFEE", decoAt: 0 });
  deskUp(R3, 2, 28, { deco: "OC_LAMP", decoAt: 0 }); deskUp(R3, 6, 28, { deco: "COFFEE" });
  meetTable(R3, 13, 29, { x: 18, y: 30, face: "left" });
  prop("easel", 19, 29, 1, 2);
  put("OC_SERVER_RACK", 22, 23); prop("crates", 18, 21, 2, 2); put("LARGE_PLANT", 22, 32); put("PLANT", 1, 33); put("BIN", 5, 25); put("PLANT_2", 24, 19);
  R3.idle = [{ x: 17, y: 19, face: "left", act: "line" }, { x: 10, y: 21, face: "up", act: "line" }, { x: 23, y: 25, face: "up", act: "rack" }];
  R3.line = LINE;
  ROOMS.push(R3);

  /* 任务4 · 产品工作室（IPD 角色接力）：两张桌岛 + 大会议桌 */
  var R4 = mkRoom("stu", "task4-ipd-eazo", 40, 18, 58, ROWS - 1, { theme: "stu", door: { x: 44, y: 17 }, plate: { x: 46, y: 16, w: 7 }, kanban: { x: 55, y: 16, w: 3 }, rack: { x: 56, y: 20 }, label: "产品工作室" });
  wallItem("HANGING_PLANT", 40, 16); wallProp("window", 41, 16, 3); wallProp("plate", 46, 16, 7); wallItem("WHITEBOARD", 53, 16); wallProp("kanban", 55, 16, 3, { room: 3 }); wallItem("HANGING_PLANT", 58, 16);
  island(R4, 43, 20); island(R4, 50, 20);
  meetTable(R4, 47, 29, { x: 52, y: 30, face: "left" });
  prop("easel", 53, 29, 1, 2);
  put("OC_SERVER_RACK", 56, 20); put("LARGE_PLANT", 40, 32); put("LARGE_PLANT", 57, 32); put("PLANT", 58, 25); put("CACTUS", 40, 19); put("BIN", 47, 24); put("PLANT_2", 55, 25);
  R4.carpet = { v: 0, x0: 45, y0: 27, x1: 51, y1: 34, col: { h: 272, s: 36, b: -18, c: -30 } };
  R4.idle = [{ x: 55, y: 27, face: "up", act: "think" }, { x: 42, y: 18, face: "up", act: "window" }, { x: 48, y: 25, face: "up", act: "think" }];
  ROOMS.push(R4);

  /* ---------------- 公共区：大厅（前台、钟、公告栏）、茶水间、休息区 ---------------- */
  wallItem("HANGING_PLANT", 20, 0); wallProp("sign", 21, 0, 7); wallItem("CLOCK", 28, 0); wallProp("notice", 29, 0, 5);
  prop("reception", 24, 5, 6, 2);
  put("PC_BACK", 25, 5, { surf: true }); put("PC_BACK", 28, 5, { surf: true }); put("COFFEE", 27, 5, { surf: true });
  put("SOFA_FRONT", 21, 9, { seat: true }); put("SOFA_FRONT", 31, 9, { seat: true }); put("POT", 23, 9); put("POT", 30, 9);
  put("LARGE_PLANT", 20, 10); put("LARGE_PLANT", 32, 10); put("PLANT", 20, 3); put("PLANT_2", 33, 3);
  var LOBBY_CARPET = { v: 0, x0: 22, y0: 3, x1: 31, y1: 8, col: { h: 350, s: 34, b: -26, c: -28 } };
  prop("mat", 25, 12, 4, 1);
  // 茶水间
  prop("counter", 26, 18, 4, 1); prop("coffee", 27, 18, 1, 1); put("COFFEE", 29, 18, { surf: true });
  put("OC_COOLER", 35, 18); prop("vending", 36, 18, 1, 1); prop("fridge", 38, 18, 1, 1);
  put("SMALL_TABLE_FRONT", 31, 20); put("WOODEN_BENCH", 30, 21, { seat: true }); put("WOODEN_BENCH", 33, 21, { seat: true });
  // 休息区：电视、沙发、茶几、乒乓球台、书架
  prop("tv", 30, 24, 4, 1);
  put("COFFEE_TABLE", 31, 27); put("SOFA_BACK", 31, 29, { seat: true }); put("SOFA_SIDE", 30, 27, { seat: true }); put("SOFA_SIDE", 33, 27, { seat: true, flip: true });
  put("COFFEE", 31, 27, { surf: true });
  prop("pingpong", 27, 32, 3, 2);
  put("DOUBLE_BOOKSHELF", 36, 31); put("LARGE_PLANT", 26, 23); put("LARGE_PLANT", 37, 23); put("PLANT", 38, 34); put("POT", 35, 34);
  var LOUNGE_CARPET = { v: 0, x0: 30, y0: 26, x1: 34, y1: 30, col: { h: 36, s: 30, b: 10, c: -40 } };
  // 走廊一侧（研究室/实验室下墙外侧）挂画
  wallItem("SMALL_PAINTING", 5, 12); wallItem("SMALL_PAINTING_2", 9, 12); wallItem("SMALL_PAINTING", 42, 12); wallItem("LARGE_PAINTING", 48, 12); wallItem("SMALL_PAINTING_2", 54, 12);

  var PUBLIC = [
    { x: 27, y: 19, face: "up", act: "coffee" }, { x: 35, y: 19, face: "up", act: "water" }, { x: 36, y: 19, face: "up", act: "vending" }, { x: 38, y: 19, face: "up", act: "fridge" },
    { x: 30, y: 21, face: "right", act: "sitchat", sit: true }, { x: 33, y: 21, face: "left", act: "sitchat", sit: true },
    { x: 31, y: 29, face: "up", act: "sofa", sit: true }, { x: 32, y: 29, face: "up", act: "sofa", sit: true },
    { x: 30, y: 27, face: "right", act: "sofa", sit: true }, { x: 30, y: 28, face: "right", act: "sofa", sit: true },
    { x: 33, y: 27, face: "left", act: "sofa", sit: true }, { x: 33, y: 28, face: "left", act: "sofa", sit: true },
    { x: 26, y: 32, face: "right", act: "pingpong", pair: 1 }, { x: 30, y: 33, face: "left", act: "pingpong", pair: 2 },
    { x: 37, y: 33, face: "up", act: "browse" }, { x: 23, y: 10, face: "down", act: "lobby" }, { x: 30, y: 11, face: "down", act: "lobby" },
    { x: 30, y: 2, face: "up", act: "notice" }, { x: 32, y: 2, face: "up", act: "notice" },
    { x: 21, y: 9, face: "down", act: "lobby", sit: true }, { x: 32, y: 9, face: "down", act: "lobby", sit: true }
  ];
  var SPAWN = { x: 27, y: 11 };
  var PET_SPOTS = [{ x: 29, y: 25 }, { x: 34, y: 31 }, { x: 28, y: 29 }, { x: 36, y: 26 }, { x: 24, y: 12 }, { x: 31, y: 15 }, { x: 12, y: 15 }, { x: 47, y: 15 }, { x: 34, y: 34 }];

  /* ---------------- 挡路格 ---------------- */
  var blocked = new Uint8Array(COLS * ROWS), seatTile = new Uint8Array(COLS * ROWS);
  function spriteWH(it) { var r = global.PO_ATLAS[it.t]; return r ? [r[2], r[3]] : [16, 16]; }
  items.forEach(function (it) {
    if (it.wall || it.surf) return;
    var fw, fh, bg;
    if (it.p) { fw = it.w; fh = it.h; bg = it.p === "conveyor" ? 0 : it.p === "easel" ? 1 : (it.p === "mat" ? fh : 0); }
    else if (FP[it.t]) { fw = FP[it.t][0]; fh = FP[it.t][1]; bg = FP[it.t][2]; }
    else { var wh = spriteWH(it); fw = wh[0] / 16; fh = wh[1] / 16; bg = 0; }
    it.fw = fw; it.fh = fh;
    for (var y = it.y + bg; y < it.y + fh; y++) for (var x = it.x; x < it.x + fw; x++) {
      if (!inb(x, y)) continue;
      if (it.seat) seatTile[y * COLS + x] = 1; else blocked[y * COLS + x] = 1;
    }
  });
  function walkable(x, y) { return tile(x, y) === FLOOR && !blocked[y * COLS + x] && !seatTile[y * COLS + x]; }
  function standable(x, y) { return tile(x, y) === FLOOR && !blocked[y * COLS + x]; }   // 座位格可以作为终点

  /* 房间归属：用于点击、离线遮罩 */
  function roomAt(x, y) {
    for (var i = 0; i < ROOMS.length; i++) { var r = ROOMS[i]; if (x >= r.x0 && x <= r.x1 && y >= r.y0 - 2 && y <= r.y1) return i; }
    return -1;
  }
  var PUBLIC_RECTS = [{ key: "lobby", label: "前台大厅", x0: 20, y0: 0, x1: 33, y1: 13 }, { key: "hall", label: "走廊", x0: 1, y0: 14, x1: 58, y1: 16 },
    { key: "kit", label: "茶水间", x0: 26, y0: 16, x1: 38, y1: 22 }, { key: "lng", label: "休息区", x0: 26, y0: 23, x1: 38, y1: ROWS - 1 }];

  global.PO_MAP = {
    COLS: COLS, ROWS: ROWS, VOID: VOID, FLOOR: FLOOR, WALL: WALL, tiles: tiles, zone: zone, ZONES: ZONES, WALL_COL: WALL_COL,
    tile: tile, items: items, rooms: ROOMS, publicSpots: PUBLIC, publicRects: PUBLIC_RECTS, spawn: SPAWN, petSpots: PET_SPOTS,
    carpets: [R1.carpet, R2.carpet, R4.carpet, LOBBY_CARPET, LOUNGE_CARPET], walkable: walkable, standable: standable, roomAt: roomAt,
    line: LINE
  };
})(window);
