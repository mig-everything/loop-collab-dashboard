"use strict";
(() => {
  initTopbar("history");
  const $ = id => document.getElementById(id);
  $("btn-refresh").innerHTML = icon("refresh") + "刷新数据";
  $("new-project").innerHTML = icon("plus") + "新建应用";
  $("search-icon").outerHTML = icon("search");
  $("evaluation-intro").innerHTML = icon("shield") + '<div><strong>四维综合评估，让每一次比较都有依据</strong><p>评分满分 100 · 缺失维度剔除后归一化 · <a href="evaluation.html">查看评分公式与评估标准 →</a></p></div>';
  CATEGORIES.filter(([id]) => id).forEach(([id, label]) => $("category").add(new Option(label, id)));
  const categories = Object.fromEntries(CATEGORIES);
  const PAGE_SIZES = [10, 20, 50, 100];
  let pageSize = 10, page = 1, status = "all", projects = [], reports = new Map(), thumbnails = {}, raw = null;
  let searchTimer, loadSequence = 0;
  const dateKey = run => run && (run.started_at || run.finished_at || "") || "";
  function groupRuns(runs) {
    const grouped = new Map();
    for (const run of runs) {
      if (!["harmony", "android_baseline"].includes(run.run_side)) continue;
      if (!grouped.has(run.requirement_id)) grouped.set(run.requirement_id, {id: run.requirement_id, text: run.nl_text || "", category: run.category_id, harmony: null, android: null, started: ""});
      const item = grouped.get(run.requirement_id), side = run.run_side === "harmony" ? "harmony" : "android";
      if (!item[side] || dateKey(run) > dateKey(item[side]) || (dateKey(run) === dateKey(item[side]) && (run.attempt || 0) > (item[side].attempt || 0))) item[side] = run;
      if (dateKey(run) > item.started) item.started = dateKey(run);
    }
    return [...grouped.values()].map(item => {
      const sides = [item.harmony, item.android];
      item.status = sides.some(r => r && ["running", "queued"].includes(r.status)) ? "generating" : sides.every(r => r && r.status === "success") ? "succeeded" : sides.some(r => r && r.status === "success") ? "partial" : "failed";
      return item;
    }).sort((a,b) => b.started.localeCompare(a.started));
  }
  function renderSummary() {
    const good = projects.filter(p => p.status === "succeeded").length;
    const metric = (label, value, unit, note, glyph, featured = false) => `<article class="summary-card${featured ? " featured" : ""}"><div class="summary-label">${label}${icon(glyph)}</div><div class="summary-value">${value}<small>${unit}</small></div><div class="summary-note">${note}</div>${featured ? '<span class="mini-bars" aria-hidden="true"><i style="height:10px"></i><i style="height:17px"></i><i style="height:14px"></i><i style="height:23px"></i><i style="height:21px"></i><i style="height:30px"></i><i style="height:27px"></i></span>' : ""}</article>`;
    const successRate = projects.length ? Math.round(good / projects.length * 100) : 0;
    $("summary").innerHTML = metric("累计生成应用", projects.length, "个", "每一个想法，都是新的起点", "grid") + metric("双端生成成功", good, "个", `<span class="positive">${successRate}%</span> 应用双端均成功`, "check", true) + metric("原生生成任务", (raw.runs || []).filter(r => ["harmony", "android_baseline"].includes(r.run_side)).length, "次", "鸿蒙与安卓 · 含历史重试", "layers") + metric("双端对比报告", reports.size, "份", "四维评估 · 持续沉淀质量", "chart");
    $("project-count").textContent = projects.length;
    $("count-all").textContent = projects.length;
    $("count-success").textContent = good;
    $("count-attention").textContent = projects.length - good;
  }
  function renderRun(run) {
    if (!run) return '<span class="run-result missing">— 未生成</span>';
    const ok = run.status === "success", pending = ["queued", "running"].includes(run.status);
    return `<span class="run-result ${ok ? "" : pending ? "pending" : "failed"}">${icon(ok ? "check" : pending ? "clock" : "close")}${esc(STATUS_LABEL[run.status] || run.status)}</span><span class="run-time">${esc(fmtDur(run.duration_ms))}</span>`;
  }
  function renderScore(report) {
    const comp = report && report.composite;
    if (!comp || ![comp.harmony?.score, comp.android?.score].some(n => n != null)) return '<span class="run-result missing">待评估</span>';
    return '<div class="score-compare">' + [["harmony", "H"], ["android", "A"]].map(([side, label]) => {
      const n = Number(comp[side]?.score), present = comp[side]?.score != null && Number.isFinite(n);
      return `<div class="score-row ${side}" title="${side === "harmony" ? "鸿蒙" : "安卓"}综合评分"><span class="score-label">${label}</span><b>${present ? n.toFixed(1) : "—"}</b><span class="score-line"><i style="width:${present ? Math.min(100, Math.max(0, n)) : 0}%"></i></span></div>`;
    }).join("") + '</div>';
  }
  function render() {
    const q = $("q").value.trim().toLocaleLowerCase(), cat = $("category").value, side = $("side").value;
    const filtered = projects.filter(p => (!q || (p.text + " " + p.id).toLocaleLowerCase().includes(q)) && (!cat || p.category === cat) && (!side || p[side === "harmony" ? "harmony" : "android"]) && (status === "all" || (status === "succeeded" ? p.status === "succeeded" : p.status !== "succeeded")));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(1, Math.min(page, pages));
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);
    $("reset-filters").hidden = !(q || cat || side || status !== "all");
    $("rows").innerHTML = items.length ? items.map((item, idx) => {
      const name = projectName(item.text), thumb = thumbnails[item.id];
      const fallback = `<span class="project-fallback tone-${idx % 4}" aria-hidden="true">${esc(name.slice(0, 1))}</span>`;
      const image = thumb ? `<img class="project-thumb" src="${esc(thumb.image_url)}" alt="${esc(name)}运行截图" loading="lazy">` : fallback;
      const timestamp = item.started ? new Date(item.started) : null;
      const date = timestamp && !Number.isNaN(timestamp.valueOf()) ? timestamp.toLocaleDateString("sv-SE", {timeZone:"Asia/Shanghai"}) : "—";
      const time = timestamp && !Number.isNaN(timestamp.valueOf()) ? timestamp.toLocaleTimeString("en-GB", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit"}) : "";
      return `<tr><td><div class="project-cell">${image}<div class="project-copy"><a class="project-title" href="detail.html?id=${encodeURIComponent(item.id)}">${esc(name)}${icon("arrowUp")}</a><p class="project-description" title="${esc(item.text)}">${esc(item.text)}</p><span class="project-id">${esc(item.id)}</span></div></div></td><td><span class="category-label">${esc(categories[item.category] || item.category || "其他")}</span></td><td>${badge(item.status)}</td><td>${renderRun(item.harmony)}</td><td>${renderRun(item.android)}</td><td>${renderScore(reports.get(item.id))}</td><td class="date-cell">${date}<small>${time} · CST</small>${EazoAuth.isLoggedIn()?`<button class="record-delete" data-delete="${esc(item.id)}" aria-label="删除 ${esc(name)}" title="删除生成记录">${icon("trash")}删除</button>`:""}</td></tr>`;
    }).join("") : '<tr><td colspan="7" class="empty"><strong>没有找到匹配的应用</strong>试试其他关键词，或重置筛选条件。</td></tr>';
    $("rows").querySelectorAll("img").forEach(img => img.addEventListener("error", () => { const fallback = document.createElement("span"); fallback.className = "project-fallback"; fallback.textContent = "E"; img.replaceWith(fallback); }, {once:true}));
    $("rows").querySelectorAll("[data-delete]").forEach(button => button.onclick = () => {
      const item = projects.find(p => p.id === button.dataset.delete);
      if (!item || !EazoAuth.isLoggedIn()) return;
      showDialog({title:"删除这条生成记录？",eyebrow:"MANAGE YOUR WORKSPACE",description:"删除后将从生成列表移除，已生成的源码与操作审计保留。进行中的任务完成后才能删除。",content:`<div class="delete-preview"><strong>${esc(projectName(item.text))}</strong><code>${esc(item.id)}</code></div>`,confirmLabel:"确认删除",onConfirm:async()=>{
        await EazoAuth.request("/api/requirements/"+encodeURIComponent(item.id),{method:"DELETE"});
        await load();
      }});
    });
    const start = filtered.length ? (page - 1) * pageSize + 1 : 0, end = Math.min(page * pageSize, filtered.length);
    $("pager").innerHTML = `<span class="pager-info">显示 ${start}–${end} 项，共 ${filtered.length} 个应用</span><div class="pager-toolbar"><label class="page-size" for="page-size">每页显示<select id="page-size">${PAGE_SIZES.map(size => `<option value="${size}"${size === pageSize ? " selected" : ""}>${size}</option>`).join("")}</select>条</label><div class="page-controls"><button data-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="上一页">${icon("chevronLeft")}</button>${Array.from({length: pages}, (_, i) => `<button data-page="${i+1}" class="${page === i+1 ? "current" : ""}" ${page === i+1 ? 'aria-current="page"' : ""}>${i+1}</button>`).join("")}<button data-page="${page + 1}" ${page === pages ? "disabled" : ""} aria-label="下一页">${icon("chevronRight")}</button></div></div>`;
    $("page-size").onchange = () => { const size = Number($("page-size").value); if (PAGE_SIZES.includes(size)) { pageSize = size; page = 1; render(); } };
    $("pager").querySelectorAll("button").forEach(btn => btn.onclick = () => { page = Number(btn.dataset.page); render(); });
  }
  window.addEventListener("eazo:authchange", () => {page=1;load();});
  async function load() {
    const sequence = ++loadSequence;
    clearMsg($("hist-msg"));
    $("btn-refresh").disabled = true;
    $("btn-refresh").innerHTML = '<span class="spin"></span>同步中';
    try {
      await EazoAuth.ready;
      const loaded = await API.history(STATIC_MODE ? {} : {limit:100000});
      if (sequence !== loadSequence) return;
      raw = loaded;
      projects = groupRuns(raw.runs || []);
      reports = new Map();
      for (const report of raw.reports || []) {
        const prev = reports.get(report.requirement_id);
        if (!prev || (report.created_at || "") >= (prev.created_at || "")) reports.set(report.requirement_id, report);
      }
      thumbnails = raw.thumbs || {};
      renderSummary(); render();
      try { const health = await API.health(); $("data-time").textContent = health.exported_at ? "数据更新于 " + new Date(health.exported_at).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit",hour12:false}) + " CST" : "数据已同步"; } catch (_) { $("data-time").textContent = "数据已同步"; }
      if(raw.management_warning)$("data-time").textContent="管理服务暂时不可用，删除记录可能尚未同步";
    } catch (e) { if(sequence!==loadSequence)return;msg($("hist-msg"), "暂时无法加载生成记录：" + e.message); $("rows").innerHTML = '<tr><td colspan="7" class="empty">请点击右上角刷新数据重试。</td></tr>'; }
    finally { if(sequence===loadSequence){$("btn-refresh").disabled = false; $("btn-refresh").innerHTML = icon("refresh") + "刷新数据";} }
  }
  $("filter-form").onsubmit = ev => {ev.preventDefault(); page=1; render();};
  $("q").addEventListener("input", () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {page=1; render();}, 180);});
  ["side","category"].forEach(id => $(id).onchange = () => {page=1; render();});
  document.querySelectorAll(".status-tab").forEach(btn => btn.onclick = () => {status = btn.dataset.status; page=1; document.querySelectorAll(".status-tab").forEach(b => {b.classList.toggle("active",b===btn); b.setAttribute("aria-pressed", String(b===btn));}); render();});
  $("reset-filters").onclick = () => {$("filter-form").reset(); document.querySelector('[data-status="all"]').click();};
  $("btn-refresh").onclick = load;
  load();
})();
