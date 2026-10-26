"use strict";
(() => {
  initTopbar("analytics");
  const $=id=>document.getElementById(id);
  $("gate-icon").innerHTML=icon("lock");
  const kinds={page_view:"页面访问",generate:"新建生成",incremental:"增量开发",login:"登录成功",login_failed:"登录失败"};
  const outcomes={recorded:"已记录",queued:"排队中",running:"运行中",success:"成功",failed:"失败",rejected:"已拒绝",interrupted:"已中断"};
  let page=1,sequence=0;
  const stamp=n=>new Date(n).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  async function load(){
    const seq=++sequence;
    await EazoAuth.ready;
    const open=EazoAuth.isLoggedIn();$("analytics-gate").hidden=open;$("analytics-content").hidden=!open;$("analytics-refresh").disabled=!open;
    if(!open){$("visitor-rows").innerHTML="";$("event-rows").innerHTML="";$("analytics-summary").innerHTML="";return;}
    $("analytics-refresh").disabled=true;clearMsg($("analytics-error"));
    try{
      const params=new URLSearchParams({days:$("days").value,page,ip:$("ip-search").value.trim(),kind:$("event-kind").value});
      const data=await EazoAuth.request("/api/analytics?"+params);
      if(seq!==sequence||!EazoAuth.isLoggedIn())return;
      const s=data.summary;
      $("analytics-summary").innerHTML=[["页面访问次数",s.page_views,"次","history"],["独立访问 IP",s.unique_ips,"个","grid"],["新建生成",s.generations,"次","plus"],["增量开发",s.incrementals,"次","code"]].map(([label,n,unit,glyph],i)=>`<article class="summary-card${i===1?" featured":""}"><div class="summary-label">${label}${icon(glyph)}</div><div class="summary-value">${Number(n)||0}<small>${unit}</small></div><div class="summary-note">最近 ${data.days} 天 · 服务端记录</div></article>`).join("");
      const max=Math.max(1,...data.daily.map(d=>d.visits));
      const today=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Shanghai"}));
      const lookup=new Map(data.daily.map(d=>[d.day,d.visits]));const bars=[];
      for(let i=data.days-1;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);const day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");const n=lookup.get(day)||0;bars.push({day,n});}
      $("visit-chart").innerHTML=bars.map(d=>`<span class="bar" style="height:${d.n?Math.max(6,Math.round(d.n/max*100)):2}%" title="${d.day} · ${d.n} 次访问"></span>`).join("");
      $("chart-dates").innerHTML=`<span>${bars[0].day}</span><span>${bars.at(-1).day}</span>`;
      $("engine-info").innerHTML=`<p><span class="dot${data.engine.online?" ok":""}"></span>${data.engine.online?"执行器在线 · 可接收生成任务":"执行器离线 · 任务将保存在队列中"}</p><p>${esc(data.engine.message)}</p>${data.engine.last_seen?'<p>最近连接：'+stamp(data.engine.last_seen)+'</p>':""}`;
      $("visitor-rows").innerHTML=data.visitors.length?data.visitors.map(v=>`<tr><td><button class="ip-filter" data-ip="${esc(v.ip)}">${esc(v.ip)}</button></td><td>${v.visits}</td><td>${v.generations}</td><td>${v.incrementals}</td><td>${stamp(v.first_seen)}</td><td>${stamp(v.last_seen)}</td></tr>`).join(""):'<tr><td colspan="6" class="empty">尚无访问记录。网站接入后会自动记录。</td></tr>';
      $("visitor-rows").querySelectorAll("[data-ip]").forEach(b=>b.onclick=()=>{$("ip-search").value=b.dataset.ip;page=1;load();});
      $("event-count").textContent=data.total+" 条记录";
      $("event-rows").innerHTML=data.events.length?data.events.map(e=>`<tr><td>${stamp(e.ts)}</td><td><code>${esc(e.ip)}</code></td><td>${esc(kinds[e.kind]||e.kind)}</td><td><span class="badge ${["success","failed","queued","running"].includes(e.outcome)?e.outcome:"neutral"}">${esc(outcomes[e.outcome]||e.outcome)}</span></td><td>${e.prompt?`<details class="prompt-details"><summary>${esc(e.prompt)}</summary><p>${esc(e.prompt)}</p><span class="project-id">${esc(e.requirement_id)}</span></details>`:esc(e.page||e.username||"—")}</td></tr>`).join(""):'<tr><td colspan="5" class="empty">当前条件下暂无记录。</td></tr>';
      const pages=Math.max(1,Math.ceil(data.total/30));
      $("event-pager").innerHTML=`<span class="pager-info">共 ${data.total} 条 · 第 ${page} / ${pages} 页</span><div class="page-controls"><button id="event-prev" ${page===1?"disabled":""} aria-label="上一页">${icon("chevronLeft")}</button><button id="event-next" ${page>=pages?"disabled":""} aria-label="下一页">${icon("chevronRight")}</button></div>`;
      $("event-prev").onclick=()=>{page--;load();};$("event-next").onclick=()=>{page++;load();};
    }catch(e){if(seq===sequence)msg($("analytics-error"),e.message);}
    finally{if(seq===sequence)$("analytics-refresh").disabled=!EazoAuth.isLoggedIn();}
  }
  $("days").onchange=()=>{page=1;load();};$("analytics-refresh").onclick=load;
  $("analytics-filter").onsubmit=e=>{e.preventDefault();page=1;load();};
  $("analytics-filter").onreset=()=>setTimeout(()=>{page=1;load();},0);
  window.addEventListener("eazo:authchange",load);load();
})();
