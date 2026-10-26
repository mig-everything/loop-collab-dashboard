/* Eazo 平台网页 UI 共享脚本（IPD-217；原生 JS，无框架） */
"use strict";

/* IPD-525 静态模式：导出脚本在 HTML 里注入 window.EAZO_STATIC_MODE=true，
   页面改由 data/*.json + shots/* + zips/* 驱动（GitHub Pages 只读展示站） */
const STATIC_MODE = (typeof window !== "undefined" && window.EAZO_STATIC_MODE === true);

/* 静态模式 GET 映射表（与 scripts/export_static_site.py 的导出清单两边对齐） */
const STATIC_MAP = [
  [/^\/api\/health$/, () => "data/health.json"],
  [/^\/api\/history/, () => "data/history.json"],
  [/^\/api\/requirements\/([^/]+)\/runs$/, m => `data/runs/${m[1]}.json`],
  [/^\/api\/requirements\/([^/]+)\/report$/, m => `data/report/${m[1]}.json`],
  [/^\/api\/requirements\/([^/]+)\/features$/, m => `data/features/${m[1]}.json`],
  [/^\/api\/requirements\/([^/]+)\/skills$/, m => `data/skills/${m[1]}.json`],
  [/^\/api\/requirements\/([^/]+)\/incrementals$/, m => `data/incrementals/${m[1]}.json`],
  [/^\/api\/requirements\/([^/]+)$/, m => `data/requirements/${m[1]}.json`],
  [/^\/api\/screenshots\/([^/]+)$/, m => `data/shots/${m[1]}.json`],
  [/^\/api\/logs\/([^/]+)$/, m => `data/logs/${m[1]}.json`],
];

const API = {
  async json(url, opts) {
    if (STATIC_MODE) {
      const method = ((opts && opts.method) || "GET").toUpperCase();
      if (method !== "GET") {
        const e = new Error("公开静态展示站为只读");
        e.code = "EZO-STATIC";
        throw e;
      }
      const path = String(url).split("?")[0];
      const hit = STATIC_MAP.find(([re]) => re.test(path));
      if (!hit) {
        const e = new Error("静态展示站未导出该资源");
        e.code = "EZO-STATIC";
        throw e;
      }
      const resp = await fetch(hit[1](path.match(hit[0])));
      if (!resp.ok) {
        const e = new Error("静态资源缺失（HTTP " + resp.status + "）");
        e.code = "EZO-STATIC";
        throw e;
      }
      const body = await resp.json();
      // 静态 fetch 恒 200：错误体按 live 语义抛出（detail 依赖 EZO-CMP-001 分支）
      if (body && body.error) {
        const e = new Error(body.error.message || "请求失败");
        e.code = body.error.code; e.detail = body.error.detail;
        throw e;
      }
      return body;
    }
    const resp = await fetch(url, opts);
    let body = null;
    try { body = await resp.json(); } catch (_) { /* 非 JSON（如 zip） */ }
    if (!resp.ok) {
      const err = (body && body.error) ? body.error : { code: "HTTP-" + resp.status, message: "请求失败" };
      const e = new Error(err.message || "请求失败");
      e.code = err.code; e.detail = err.detail; e.status = resp.status;
      throw e;
    }
    return body;
  },
  downloadUrl: (runId) => STATIC_MODE
    ? `zips/${runId}.zip` : `/api/artifacts/${runId}/download`,
  _zipsIndex: null,
  zipsIndex() {
    // 静态模式下载清单（导出脚本写 data/zips_index.json；live 模式不需要）
    if (!STATIC_MODE) return Promise.resolve(null);
    if (!API._zipsIndex) {
      API._zipsIndex = fetch("data/zips_index.json")
        .then(r => (r.ok ? r.json() : { runs: [] }))
        .catch(() => ({ runs: [] }));
    }
    return API._zipsIndex;
  },
  health: () => API.json("/api/health"),
  createRequirement: (nl_text, category) => API.json("/api/requirements", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nl_text, category: category || null, origin: "manual" }),
  }),
  generate: (reqId) => API.json(`/api/requirements/${reqId}/generate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }),
  requirement: (reqId) => API.json(`/api/requirements/${reqId}`),
  runs: (reqId) => API.json(`/api/requirements/${reqId}/runs`),
  run: (runId) => API.json(`/api/runs/${runId}`),
  history: (params) => {
    const q = new URLSearchParams(params || {}).toString();
    return API.json("/api/history" + (q ? "?" + q : ""));
  },
  report: (reqId) => API.json(`/api/requirements/${reqId}/report`),
  skills: (reqId) => API.json(`/api/requirements/${reqId}/skills`),
  screenshots: (runId) => API.json(`/api/screenshots/${runId}`),
  incremental: (reqId, nl_text) => API.json(`/api/requirements/${reqId}/incremental`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nl_text }),
  }),
  incrementals: (reqId) => API.json(`/api/requirements/${reqId}/incrementals`),
  logs: (runId) => API.json(`/api/logs/${runId}`),
};

const CATEGORIES = [
  ["", "自动归类"], ["tool", "工具"], ["note", "笔记"], ["game", "游戏"],
  ["life", "生活"], ["efficiency", "效率"], ["entertainment", "娱乐"],
  ["study", "学习"], ["health", "健康"], ["photo", "图像"], ["audio", "音频"],
  ["finance", "金融"],
];

const SIDE_LABEL = { harmony: "鸿蒙", android_baseline: "安卓基线" };
const STATUS_LABEL = {
  created: "已创建", generating: "生成中", succeeded: "已成功", failed: "失败",
  iterating: "增量迭代中", queued: "排队中", running: "运行中", success: "成功",
  timeout: "超时", pass: "通过", fail: "未过", degraded_pass: "降级通过",
  degraded_fail: "降级未过",
  partial: "部分完成",
};

const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  arrowUp: '<path d="M6 18 18 6M6 6h12v12"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  close: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 3v17h17M8 15V9m5 6V5m5 10v-4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
  chevronLeft: '<path d="m14 6-6 6 6 6"/>',
  chevronRight: '<path d="m10 6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.grid}</svg>`; }
function projectName(text) {
  const s = String(text || "未命名应用");
  const quoted = s.match(/[「“《]([^」”》]{1,32})[」”》]/);
  if (quoted) return quoted[1];
  return s.replace(/^(请|帮我|做|制作|开发|生成|创建|设计|一个|一款|实现|需要|我要|帮忙|\s)+/, "").split(/App|APP|应用|[：:，,。;；\n]/)[0].trim().slice(0, 24) || "应用实验";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function badge(status) {
  const cls = String(status || "").toLowerCase();
  return `<span class="badge ${esc(cls)}">${esc(STATUS_LABEL[cls] || status || "—")}</span>`;
}
function sideChip(side) {
  return `<span class="side-chip ${esc(side)}">${esc(SIDE_LABEL[side] || side)}</span>`;
}
function fmtDur(ms) {
  if (ms == null || ms === 0) return "—";
  if (ms < 1000) return ms + " ms";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + " s";
  return Math.floor(s / 60) + " 分 " + Math.round(s % 60) + " 秒";
}
function fmtTokens(n) {
  if (n == null || n === 0) return "—";
  return Number(n).toLocaleString("zh-CN");
}
function fmtTime(iso) {
  if (!iso) return "—";
  return String(iso).replace("T", " ").slice(0, 19);
}
function shortSha(sha) {
  if (!sha) return "—";
  return `<code class="sha" title="${esc(sha)}">${esc(String(sha).slice(0, 10))}</code>`;
}
function msg(el, text, kind) {
  el.className = "msg " + (kind || "error");
  el.textContent = text;
}
function clearMsg(el) { el.className = "msg"; el.textContent = ""; }

async function initTopbar(active) {
  document.body.classList.add(active + "-page");
  const names = { home: "平台概览", history: "生成历史", detail: "实验详情", analytics: "访问统计" };
  const header = document.querySelector(".topbar");
  if (header) header.innerHTML = `
    <a class="brand-link" href="history.html" aria-label="Eazo Studio 首页"><span class="brand-mark">e</span><span class="brand-name">eazo<span>CREATION STUDIO</span></span></a>
    <div class="nav-label">WORKSPACE</div>
    <nav aria-label="主导航">
      <a href="index.html" data-page="home">${icon("grid")}<span>平台概览</span></a>
      <a href="history.html" data-page="history">${icon("layers")}<span>生成历史</span></a>
      <a href="history.html#evaluation-notes" class="nav-evaluation">${icon("shield")}<span>评估标准</span></a>
    </nav>
    <div class="nav-note"><strong>一个创意，两种可能。</strong>从自然语言到原生应用，<br>探索鸿蒙与安卓的创作边界。</div>
    <div class="sidebar-bottom"><div class="engine-panel"><div><span class="dot ok"></span>双端生成工作空间</div><p>HarmonyOS &nbsp; / &nbsp; Android</p></div><div class="sidebar-copyright">EAZO PLATFORM · 2026</div></div>`;
  if (!document.querySelector(".workspace-bar")) header.insertAdjacentHTML("afterend", `<div class="workspace-bar"><div class="breadcrumb">工作空间<span class="sep">/</span><strong>${esc(names[active] || "Eazo Studio")}</strong></div><div class="workspace-actions"><div class="health" id="health-indicator"><span class="dot ok"></span>公开展示</div><span class="workspace-tag">${icon("code")} NATIVE APP GENERATION</span><span class="avatar" aria-label="访客">E</span></div></div>`);
  const footer = document.querySelector(".footer");
  if (footer) footer.innerHTML = `<div><span class="footer-brand">eazo.</span> 从创意到原生应用</div><div class="footer-links"><span>HarmonyOS × Android</span><a href="history.html#evaluation-notes">评估说明</a><span>© 2026 Eazo Studio</span></div>`;
  document.querySelectorAll(".topbar nav a").forEach(a => {
    if (a.dataset.page === active || (active === "detail" && a.dataset.page === "history")) { a.classList.add("active"); a.setAttribute("aria-current", "page"); }
  });
  const healthEl = document.getElementById("health-indicator");
  if (healthEl) {
    if (STATIC_MODE) {
      healthEl.innerHTML = `<span class="dot ok"></span>公开展示空间`;
    } else {
      try {
        const h = await API.health();
        healthEl.innerHTML = `<span class="dot ok"></span>引擎在线 · ${esc(h.engine_version || "")}`;
      } catch (_) {
        healthEl.innerHTML = `<span class="dot"></span>引擎离线`;
      }
    }
  }
}
