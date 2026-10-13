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
};

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
  document.querySelectorAll(".topbar nav a").forEach(a => {
    if (a.dataset.page === active) a.classList.add("active");
  });
  const healthEl = document.getElementById("health-indicator");
  if (healthEl) {
    if (STATIC_MODE) {
      healthEl.innerHTML = `<span class="dot ok"></span>静态展示站 · 只读`;
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
