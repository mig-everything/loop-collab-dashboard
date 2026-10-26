"use strict";
(() => {
  const base=(window.EAZO_CONFIG?.apiBase||"").replace(/\/$/,"");
  const key="eazo_admin_session_v1";
  let session=null,afterLogin=null;
  try{session=JSON.parse(sessionStorage.getItem(key)||"null");}catch{}
  if(session?.expires_at<Date.now())session=null;
  const liveReqs=new Set(),liveRuns=new Set(),downloads=new Map(),assets=new Map();
  function setSession(value){session=value;try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}renderAuth();window.dispatchEvent(new Event("eazo:authchange"));}
  async function request(path,opts={}) {
    if(!base)throw new Error("管理服务尚未连接");
    const headers={...(opts.headers||{})};if(session?.token)headers.Authorization="Bearer "+session.token;
    let response;
    try{response=await fetch(base+path,{...opts,headers,cache:"no-store",signal:AbortSignal.timeout(20000)});}catch{throw new Error("暂时无法连接管理服务，请稍后重试");}
    const data=await response.json();
    if(!response.ok){if(response.status===401&&session)setSession(null);const e=new Error(data.error?.message||"请求失败");e.code=data.error?.code;e.status=response.status;throw e;}
    return data;
  }
  const post=(path,data)=>request(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  async function blob(key){if(!assets.has(key)){const r=await fetch(base+"/api/assets/"+encodeURIComponent(key),{headers:{Authorization:"Bearer "+session?.token}});if(!r.ok)throw new Error("文件加载失败");assets.set(key,URL.createObjectURL(await r.blob()));}return assets.get(key);}
  function remember(data){for(const r of data.runs||[])liveRuns.add(r.id);for(const [run,asset]of Object.entries(data.downloads||{}))downloads.set(run,asset);return data;}
  function loginDialog() {
    let dialog=document.getElementById("login-dialog");if(dialog)return dialog;
    dialog=document.createElement("dialog");dialog.id="login-dialog";dialog.className="login-dialog";
    dialog.innerHTML=`<button class="dialog-close" type="button" aria-label="关闭登录">${icon("close")}</button><div class="login-mark">e</div><p class="eyebrow">WELCOME TO YOUR WORKSPACE</p><h2>创意，准备就绪。</h2><p class="login-description">登录管理员账户，开启新建生成、增量开发与访问统计。</p><form id="login-form"><label class="field">用户名<input name="username" autocomplete="username" required placeholder="请输入用户名"></label><label class="field">密码<input name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"></label><div class="msg" id="login-error" role="alert"></div><button class="btn login-submit" type="submit">登录工作空间 ${icon("arrow")}</button></form><p class="login-footnote">管理员专属 · 安全连接</p>`;
    document.body.append(dialog);dialog.querySelector(".dialog-close").onclick=()=>dialog.close();
    dialog.addEventListener("click",e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    dialog.querySelector("form").onsubmit=async e=>{e.preventDefault();const form=e.target,btn=form.querySelector("button"),error=document.getElementById("login-error");clearMsg(error);btn.disabled=true;btn.textContent="正在验证…";try{const data=await post("/api/auth/login",{username:form.username.value,password:form.password.value});form.password.value="";setSession(data);dialog.close();if(afterLogin){const callback=afterLogin;afterLogin=null;callback();}}catch(e){msg(error,e.message);}finally{btn.disabled=false;btn.innerHTML="登录工作空间 "+icon("arrow");}};
    return dialog;
  }
  function openLogin(callback){if(session){callback?.();return;}afterLogin=callback||null;loginDialog().showModal();}
  async function logout(){try{await post("/api/auth/logout",{});}catch{}finally{for(const value of assets.values())URL.revokeObjectURL(value);assets.clear();downloads.clear();liveReqs.clear();liveRuns.clear();setSession(null);location.reload();}}
  function renderAuth() {
    const actions=document.querySelector(".workspace-actions");
    if(actions){let account=actions.querySelector(".account-controls");if(!account){actions.querySelector(".avatar")?.remove();account=document.createElement("div");account.className="account-controls";actions.append(account);}account.innerHTML=session?'<span class="account-name">admin</span><button class="account-button" id="logout-button">退出</button>':'<button class="account-button" id="login-button">'+icon("lock")+'管理员登录</button>';account.querySelector("#login-button")?.addEventListener("click",()=>openLogin());account.querySelector("#logout-button")?.addEventListener("click",logout);}
    const footer=document.querySelector(".footer-links");if(footer&&!footer.querySelector(".analytics-link")){const link=document.createElement("a");link.className="analytics-link";link.href="analytics.html";link.textContent="访问统计";link.onclick=e=>{if(!session){e.preventDefault();openLogin(()=>location.assign("analytics.html"));}};footer.prepend(link);}
    document.querySelectorAll("[data-login]").forEach(b=>b.onclick=()=>openLogin());
  }
  const originalJson=API.json.bind(API),originalIndex=API.zipsIndex.bind(API),originalDownload=API.downloadUrl;
  API.json=async(url,opts)=>{
    const method=(opts?.method||"GET").toUpperCase(),path=String(url).split("?")[0];
    if(method!=="GET") {if(!session){openLogin();throw new Error("请先登录管理员账户");}const data=await request(url,opts);const rid=data.id||data.requirement_id;if(rid)liveReqs.add(rid);return data;}
    if(session&&path==="/api/health")return request(url);
    if(session&&path==="/api/history") {
      const [staticData,liveData]=await Promise.all([originalJson("/api/history"),request("/api/history")]);
      const ids=new Set(liveData.runs.map(r=>r.requirement_id));ids.forEach(r=>liveReqs.add(r));liveData.runs.forEach(r=>liveRuns.add(r.id));
      return {...staticData,runs:[...liveData.runs,...staticData.runs.filter(r=>!ids.has(r.requirement_id))],reports:[...staticData.reports.filter(r=>!ids.has(r.requirement_id)),...liveData.reports],thumbs:staticData.thumbs};
    }
    const match=path.match(/^\/api\/requirements\/([^/]+)(?:\/(.*))?$/);
    if(session&&match) {
      const rid=match[1];
      if(liveReqs.has(rid)||rid.startsWith("req_web_"))return remember(await request(url));
      if(!match[2]) {try{const data=remember(await request(url));liveReqs.add(rid);return data;}catch(e){if(e.status!==404)throw e;}}
    }
    const runMatch=path.match(/^\/api\/(screenshots|logs)\/([^/]+)$/);
    if(session&&runMatch&&liveRuns.has(runMatch[2])){const data=await request(url);if(runMatch[1]==="screenshots")for(const shot of data)if(shot.asset_key)shot.image_url=await blob(shot.asset_key);return data;}
    return originalJson(url,opts);
  };
  API.downloadUrl=runId=>downloads.has(runId)?"#download="+encodeURIComponent(downloads.get(runId)):originalDownload(runId);
  API.zipsIndex=async()=>{const old=await originalIndex();return {runs:[...(old?.runs||[]),...downloads.keys()]};};
  document.addEventListener("click",async e=>{const a=e.target.closest('a[href^="#download="]');if(!a)return;e.preventDefault();try{const key=decodeURIComponent(a.getAttribute("href").slice(10)),url=await blob(key),link=document.createElement("a");link.href=url;link.download=key.replace(/^asset_/,"");link.click();}catch(error){a.textContent=error.message;}});
  window.EazoAuth={request,post,openLogin,isLoggedIn:()=>!!session,render:renderAuth,ready:null};
  EazoAuth.ready=(async()=>{if(session)try{await request("/api/auth/session");}catch(e){if(e.status===401)setSession(null);}renderAuth();})();
  window.addEventListener("DOMContentLoaded",()=>{renderAuth();if(base){const path=location.pathname;const page=/\/(index|history|detail|analytics)\.html$/.test(path)?path:path.replace(/\/$/,"/index.html");const event={id:"view_"+crypto.randomUUID(),page};fetch(base+"/api/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(event),keepalive:true}).catch(()=>{});}});
})();
