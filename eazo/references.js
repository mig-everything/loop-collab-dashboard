"use strict";
function openReferenceDialog(kind, sides, selectedSide = "harmony", skillIndex = 0) {
  const titles={skill:"编码 Skill",prompt:"Prompt 版本",template:"模板版本",model:"生成模型"};
  const dialog=showDialog({title:titles[kind],eyebrow:"GENERATION REFERENCES",description:"查看双端生成记录中的版本信息与内容来源。",content:'<div class="reference-tabs" role="group" aria-label="选择生成平台"></div><div class="reference-body"></div>'});
  const tabs=dialog.querySelector(".reference-tabs"),body=dialog.querySelector(".reference-body");
  let sequence=0;
  async function render(sideName) {
    const seq=++sequence;
    const side=sides.find(s=>s.side===sideName)||{},engine=side.engine||{},skill=(side.skills||[])[skillIndex]||(side.skills||[])[0]||{};
    tabs.innerHTML=sides.map(s=>`<button class="reference-tab${s.side===sideName?" active":""}" aria-pressed="${s.side===sideName}" data-ref-tab="${esc(s.side)}">${esc(s.side_label||SIDE_LABEL[s.side]||s.side)}</button>`).join("");
    tabs.querySelectorAll("button").forEach(b=>b.onclick=()=>render(b.dataset.refTab));
    const value=kind==="skill"?skill.name:engine[{prompt:"prompt_version",template:"template_version",model:"model_id"}[kind]];
    const facts=[["当前记录",value],...(kind==="model"?[["Prompt 版本",engine.prompt_version],["模板版本",engine.template_version],["Skill 包版本",engine.skill_pack_version]]:[["版本",kind==="skill"?skill.version:value]]),["生成任务",side.run_id],["执行方式",engine.provider],["工具链",side.toolchain_version]];
    body.innerHTML=`<dl class="reference-facts">${facts.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v||"未采集")}</dd></div>`).join("")}</dl><div class="reference-source"></div>`;
    const source=body.querySelector(".reference-source");
    if(kind==="model") {
      source.innerHTML='<h3>这项信息代表什么</h3><p>模型标识来自当次生成任务保存的 engine_version。它用于追溯生成配置；界面视觉评审使用的模型与它分开记录，可在四维对比报告中查看。</p><p>本记录没有保存模型权重、训练数据或供应商内部参数，界面保留原始标识，不将名称推断为额外性能指标。</p>';
      return;
    }
    if(!value){source.textContent="该任务没有采集这一项内容。";return;}
    if(!EazoAuth.isLoggedIn()) {
      source.innerHTML=`<p>${esc(kind==="skill"?skill.description:"版本内容来自生成引擎的源码快照。")}</p><div class="reference-login"><p>登录管理员账户后，可查看完整内容快照与来源。</p><button class="btn ghost" data-reference-login>登录查看内容</button></div>`;
      source.querySelector("button").onclick=()=>EazoAuth.openLogin(()=>{dialog.close();openReferenceDialog(kind,sides,sideName,skillIndex);});
      return;
    }
    source.innerHTML='<p class="reference-loading"><span class="spin"></span>正在读取版本内容…</p>';
    try {
      const data=await EazoAuth.request("/api/references?"+new URLSearchParams({kind,key:value}));
      if(seq!==sequence||!dialog.isConnected)return;
      source.innerHTML=`<p class="reference-note">${esc(data.note)}</p>${data.revision?`<p class="reference-revision">来源快照 <code>${esc(data.revision)}</code></p>`:""}${(data.blocks||[]).map((b,i)=>`<details class="source-block" ${i===0?"open":""}><summary>${esc(b.title)}</summary><pre>${esc(b.body)}</pre></details>`).join("")}`;
    } catch(e) {if(seq===sequence&&dialog.isConnected)source.innerHTML=`<p class="reference-note">${esc(e.message)}。历史版本不会用新版正文替代，可从应用源码包继续核对当次产物。</p>`;}
  }
  render(selectedSide);
}
