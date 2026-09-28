/* 像素办公室看板 · 数据与界面（顶栏、团队侧栏/列表、详情面板）。数据只读 data/status.json。 */
(function () {
  "use strict";
  var REFRESH_MS = 60000;
  var STATE_LABEL = { working: "工作中", meeting: "会议中", idle: "休息中", offline: "离线" };
  var STATE_ORDER = { working: 0, meeting: 1, idle: 2, offline: 3 };
  var STATUS_LABEL = { todo: "待办", backlog: "待规划", in_progress: "进行中", in_review: "评审中", done: "已完成", blocked: "阻塞", cancelled: "已取消" };
  var $ = function (id) { return document.getElementById(id); };
  var data = null, nextAt = Date.now() + REFRESH_MS, loading = false, office = null, sig = "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function bjTime(t, sec) {
    var d = new Date(t); if (isNaN(d.getTime())) return "--";
    var b = new Date(d.getTime() + 8 * 3600 * 1000);
    var s = b.getUTCFullYear() + "-" + pad(b.getUTCMonth() + 1) + "-" + pad(b.getUTCDate()) + " " + pad(b.getUTCHours()) + ":" + pad(b.getUTCMinutes());
    return sec ? s + ":" + pad(b.getUTCSeconds()) : s;
  }
  // 与原看板一致的 MultiCA 链接规则
  function mcUrl(ws, path) { return "https://multica.ai/" + encodeURIComponent(ws || "") + path; }
  function taskUrl(t) { return mcUrl(t.workspace, "/issues"); }
  function agentUrl(t, a) { return t.workspace && a.agent_id ? mcUrl(t.workspace, "/agents/" + encodeURIComponent(a.agent_id)) : ""; }
  function issueUrl(t, key) { return t.workspace && key ? mcUrl(t.workspace, "/issues/" + encodeURIComponent(key)) : ""; }
  function link(url, html, cls, title) {
    return url ? '<a class="' + (cls || "") + '" href="' + url + '" target="_blank" rel="noopener"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + html + "</a>"
               : '<span class="' + (cls || "") + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + html + "</span>";
  }
  function stateOf(t, a) { var s = STATE_LABEL[a.state] ? a.state : "idle"; return t.machine_online ? s : "offline"; }

  /* ---------- 团队卡：成员（谁在做哪个单）+ 进度 + issue 计数 + 最新动态，场景侧栏与列表视图共用 ---------- */
  function teamCard(t, i) {
    var p = Math.max(0, Math.min(100, t.progress || 0)), c = t.issue_counts || {}, ag = (t.agents || []).slice();
    ag.sort(function (a, b) { return STATE_ORDER[stateOf(t, a)] - STATE_ORDER[stateOf(t, b)]; });
    var on = ag.filter(function (a) { return stateOf(t, a) === "working"; }).length;
    var mem = ag.map(function (a) {
      var st = stateOf(t, a), what = a.issue ? link(issueUrl(t, a.issue), esc(a.issue), "iss", a.issue_title) + '<span class="it" title="' + esc(a.issue_title || "") + '">' + esc(a.issue_title || "") + "</span>"
        : '<span class="it muted">' + (st === "meeting" ? esc(t.meeting_title || "开会中") : STATE_LABEL[st]) + "</span>";
      return '<li class="' + st + '" data-n="' + esc(a.name) + '"><i class="dot ' + st + '" title="' + STATE_LABEL[st] + '"></i><button class="nm" type="button" title="在场景中找到 ' + esc(a.name) + (a.role ? "（" + esc(a.role) + "）" : "") + '">' + esc(a.name) + "</button>" + what + "</li>";
    }).join("");
    var iss = (t.latest_issues || []).slice(0, 3).map(function (it) {
      var st = STATUS_LABEL[it.status] ? it.status : "todo";
      return '<li><i class="sdot ' + st + '" title="' + STATUS_LABEL[st] + '"></i>' + link(issueUrl(t, it.key), esc(it.key), "k") +
        '<span class="tt" title="' + esc(it.title) + '">' + link(issueUrl(t, it.key), esc(it.title)) + '</span><span class="tm">' + bjTime(it.updated_at).slice(11) + "</span></li>";
    }).join("");
    return '<section class="team' + (t.meeting_active ? " meeting" : "") + '" data-i="' + i + '">' +
      '<header class="th"><i class="lamp' + (t.machine_online ? "" : " off") + '" title="' + esc(t.machine || "") + (t.machine_online ? " 在线" : " 离线") + '"></i>' +
      link(taskUrl(t), esc(t.title || t.id), "tt", "打开 MultiCA 工作区") + '<button class="focus" type="button" title="在场景中查看这个房间">定位</button></header>' +
      '<div class="tm"><span class="pbar" title="进度取自 loop-collab 日报「总进度」"><i style="width:' + p + '%"></i></span><b>' + p + "%</b><span>在岗 " + on + "/" + ag.length + '</span><span class="mc">' + esc(t.machine || "") + "</span></div>" +
      (t.meeting_active ? '<div class="meetline">会议中 · ' + esc(t.meeting_title || "") + "</div>" : "") +
      '<ul class="mem">' + mem + "</ul>" +
      '<div class="counts"><span>待办 <b>' + (c.todo || 0) + "</b></span><span>进行 <b>" + (c.in_progress || 0) + "</b></span><span>评审 <b>" + (c.in_review || 0) + "</b></span><span>完成 <b>" + (c.done || 0) + "</b></span></div>" +
      '<ul class="ilist">' + iss + "</ul></section>";
  }
  function renderTeams(tasks) { $("side").innerHTML = tasks.map(teamCard).join(""); }
  /* 四队最新动态：各队最新 issue 合并按更新时间倒序（真实数据，点编号/标题打开 issue） */
  function renderFeed(tasks) {
    var rows = [];
    tasks.forEach(function (t) { (t.latest_issues || []).forEach(function (it) { rows.push({ t: t, it: it, ts: Date.parse(it.updated_at || "") || 0 }); }); });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    $("feed").innerHTML = "<h5>四队最新动态<small>（按更新时间，数据每 3 分钟采集）</small></h5><ul>" + rows.map(function (r) {
      var st = STATUS_LABEL[r.it.status] ? r.it.status : "todo", tag = (r.t.title || r.t.id).split("·")[0].trim();
      return '<li><span class="tm">' + bjTime(r.it.updated_at).slice(5) + '</span><span class="tg">' + esc(tag) + '</span><i class="sdot ' + st + '" title="' + STATUS_LABEL[st] + '"></i>' +
        link(issueUrl(r.t, r.it.key), esc(r.it.key), "k") + '<span class="tt" title="' + esc(r.it.title) + '">' + link(issueUrl(r.t, r.it.key), esc(r.it.title)) + "</span></li>";
    }).join("") + "</ul>";
  }

  /* ---------- 详情面板 ---------- */
  function openPanel(html) { $("panel-body").innerHTML = html; $("panel").classList.add("open"); }
  function memberRow(t, a) {
    var st = stateOf(t, a);
    return '<div class="lrow"><span class="who">' + link(agentUrl(t, a), esc(a.name)) + '</span><span class="what">' +
      (a.issue ? link(issueUrl(t, a.issue), "<b>" + esc(a.issue) + "</b> " + esc(a.issue_title || "")) : esc(a.model || "")) + '</span><span class="st ' + st + '">' + STATE_LABEL[st] + "</span></div>";
  }
  function onRoom(t) {
    var c = t.issue_counts || {};
    openPanel("<h2>" + link(taskUrl(t), esc(t.title || t.id)) + "</h2>" +
      '<div class="kv"><span>机器</span><span>' + esc(t.machine || "") + (t.machine_online ? "（在线）" : "（离线）") + "</span><span>进度</span><span>" + (t.progress || 0) + "%（日报）</span>" +
      "<span>会议</span><span>" + (t.meeting_active ? esc(t.meeting_title || "进行中") : "无") + "</span>" +
      "<span>issue</span><span>待办 " + (c.todo || 0) + " · 进行 " + (c.in_progress || 0) + " · 评审 " + (c.in_review || 0) + " · 完成 " + (c.done || 0) + "</span></div>" +
      "<h4>成员</h4>" + (t.agents || []).map(function (a) { return memberRow(t, a); }).join("") +
      "<h4>最新动态</h4><ul class=\"ilist\">" + (t.latest_issues || []).map(function (it) {
        var st = STATUS_LABEL[it.status] ? it.status : "todo";
        return '<li><i class="sdot ' + st + '"></i>' + link(issueUrl(t, it.key), esc(it.key), "k") + '<span class="tt">' + link(issueUrl(t, it.key), esc(it.title)) + '</span><span class="tm">' + bjTime(it.updated_at).slice(11) + "</span></li>";
      }).join("") + "</ul>");
  }
  function onAgent(t, a) {
    var st = stateOf(t, a);
    openPanel("<h2>" + link(agentUrl(t, a), esc(a.name)) + "</h2>" +
      '<div class="kv"><span>团队</span><span>' + esc(t.title || t.id) + "</span><span>状态</span><span class=\"st " + st + "\">" + STATE_LABEL[st] + "</span>" +
      "<span>模型</span><span>" + esc(a.model || "") + "</span><span>角色</span><span>" + esc(a.role || "") + "</span>" +
      "<span>当前</span><span>" + (a.issue ? link(issueUrl(t, a.issue), "<b>" + esc(a.issue) + "</b> " + esc(a.issue_title || "")) : "无") + "</span>" +
      (a.since ? "<span>开始于</span><span>" + bjTime(a.since) + "</span>" : "") + "</div>");
  }

  /* ---------- 视图切换与交互 ---------- */
  function setView(v) {
    document.body.classList.toggle("view-list", v === "list");
    $("v-scene").classList.toggle("on", v !== "list"); $("v-list").classList.toggle("on", v === "list");
    try { localStorage.setItem("pixel-view", v); } catch (e) { /* 无痕模式等场景忽略 */ }
  }
  function initView() {
    var v = null;
    try { v = localStorage.getItem("pixel-view"); } catch (e) { v = null; }
    setView(v || (window.innerWidth < 900 ? "list" : "scene"));
    $("v-scene").onclick = function () { setView("scene"); };
    $("v-list").onclick = function () { setView("list"); };
    $("panel-x").onclick = function () { $("panel").classList.remove("open"); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("panel").classList.remove("open"); });
    $("side").addEventListener("click", function (e) {
      var card = e.target.closest(".team"); if (!card || !data) return;
      var t = (data.tasks || [])[+card.getAttribute("data-i")]; if (!t) return;
      if (e.target.closest(".focus")) { setView("scene"); office.focusTask(t.id); return; }
      var li = e.target.closest(".mem li");
      if (li && e.target.closest(".nm")) {
        var a = (t.agents || []).filter(function (x) { return x.name === li.getAttribute("data-n"); })[0];
        if (!document.body.classList.contains("view-list")) office.focusAgent(t.id, a && a.name);
        if (a) onAgent(t, a);
      }
    });
    $("side").addEventListener("mouseover", function (e) {
      var li = e.target.closest(".mem li"), card = e.target.closest(".team");
      if (!li || !card || !data) { office.highlight(null); return; }
      var t = (data.tasks || [])[+card.getAttribute("data-i")]; if (t) office.highlight(t.id, li.getAttribute("data-n"));
    });
    $("side").addEventListener("mouseleave", function () { office.highlight(null); });
  }

  /* ---------- 拉取、刷新与挂钟 ---------- */
  function render(d) {
    data = d; var tasks = (d.tasks || []).filter(function (t) { return t && t.id; });
    $("upd").textContent = bjTime(d.generated_at, true);
    var s = JSON.stringify(tasks);
    if (s !== sig) { renderTeams(tasks); renderFeed(tasks); office.setData(tasks); sig = s; }
  }
  function load() {
    if (loading) return; loading = true;
    var src = new URLSearchParams(location.search).get("data");   // 本地调试用：只允许同站 data/ 下的 json
    fetch((src && /^data\/[\w\/.-]+\.json$/.test(src) && src.indexOf("..") < 0 ? src : "data/status.json") + "?" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { $("errbar").style.display = "none"; render(d); })
      .catch(function () { $("errbar").style.display = "block"; })
      .then(function () { loading = false; nextAt = Date.now() + REFRESH_MS; });
  }
  function tick() {
    var left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
    $("cd").textContent = left; $("cdbar").style.width = Math.round(left / (REFRESH_MS / 1000) * 100) + "%";
    if (left <= 0) load();
    // 挂钟：北京时间 + 下一节点（会议/巡检），沿用原看板的节点表
    var b = new Date(Date.now() + 8 * 3600 * 1000), mins = b.getUTCHours() * 60 + b.getUTCMinutes();
    var evts = [[0, "巡检"], [4, "早会"], [8, "巡检"], [12, "午会"], [16, "巡检"], [20, "晚会"]], next = null;
    for (var i = 0; i < evts.length; i++) if (evts[i][0] * 60 > mins) { next = evts[i]; break; }
    if (!next) next = evts[0];
    var nl = (next[0] * 60 - mins + 1440) % 1440;
    office.tickClock("北京 " + pad(b.getUTCHours()) + ":" + pad(b.getUTCMinutes()), (nl <= 60 ? "即将" : Math.floor(nl / 60) + "h 后") + " " + next[1] + " · 04/12/20 例会 · 00/08/16 巡检");
  }

  office = new window.PixelOffice($("scene"), $("ov"), { onAgent: onAgent, onRoom: onRoom, issueUrl: issueUrl });
  initView();
  load();
  tick(); setInterval(tick, 1000);
})();
