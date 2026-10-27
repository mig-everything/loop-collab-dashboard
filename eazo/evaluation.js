"use strict";
(() => {
  initTopbar("evaluation");
  const fields=[{key:"func",label:"功能覆盖（%）",max:100,values:[100,100]},{key:"page",label:"页面数量",step:1,values:[1,1]},{key:"ui",label:"UI 百分制得分",max:100,values:[83.75,76]},{key:"duration",label:"生成耗时（秒）",values:[445.118,338.993]},{key:"token",label:"Token 数量",step:1,values:[89925,75557]}];
  const inputs=document.getElementById("calculator-inputs"),exclude=document.getElementById("exclude-ui");
  inputs.innerHTML=fields.map(f=>`<tr><th scope="row">${f.label}</th>${["harmony","android"].map((side,i)=>`<td><label class="sr-only" for="${side}-${f.key}">${i?"安卓":"鸿蒙"}${f.label}</label><input type="number" min="0" ${f.max?`max="${f.max}"`:""} step="${f.step||"any"}" id="${side}-${f.key}" data-metric="${f.key}" value="${f.values[i]}" inputmode="decimal" placeholder="未采集"></td>`).join("")}</tr>`).join("");
  const read=(side,key)=>{const el=document.getElementById(side+"-"+key);return el.value.trim()!==""&&el.validity.valid?Number(el.value):null;};
  const weights={func:.4,page:.2,ui:.2,efficiency:.2},labels={func:"功能",page:"页面",ui:"UI",efficiency:"效率"};
  function render(){
    const data=Object.fromEntries(["harmony","android"].map(side=>[side,Object.fromEntries(fields.map(f=>[f.key,read(side,f.key)]))]));
    const maxPage=Math.max(data.harmony.page||0,data.android.page||0);
    document.getElementById("calculator-results").innerHTML=["harmony","android"].map((side,i)=>{
      const mine=data[side],other=data[i?"harmony":"android"];
      const efficiency=["duration","token"].filter(k=>mine[k]>0&&other[k]>0).map(k=>100*Math.min(mine[k],other[k])/mine[k]);
      const values={func:mine.func,page:mine.page!==null&&maxPage>0?Math.round(10000*mine.page/maxPage)/100:null,ui:!exclude.checked&&mine.ui>0?mine.ui:null,efficiency:efficiency.length?Math.round(efficiency.reduce((a,b)=>a+b,0)/efficiency.length*100)/100:null};
      const available=Object.keys(weights).filter(k=>values[k]!==null),sum=available.reduce((n,k)=>n+weights[k],0);
      const score=sum?available.reduce((n,k)=>n+values[k]*weights[k]/sum,0):null;
      return `<article class="calculator-result ${side}"><p>${i?"安卓 Android":"鸿蒙 HarmonyOS"}</p><output id="result-${side}">${score===null?"—":score.toFixed(1)}</output><span>演算综合分 / 100</span><ul>${Object.keys(weights).map(k=>values[k]===null?`<li class="excluded"><b>${labels[k]}</b><span>未计入</span></li>`:`<li><b>${labels[k]}</b><span>${values[k].toFixed(2)} × ${(weights[k]/sum*100).toFixed(0)}%</span></li>`).join("")}</ul></article>`;
    }).join("");
  }
  inputs.addEventListener("input",render);exclude.onchange=render;
  document.getElementById("reset-calculator").onclick=()=>{fields.forEach(f=>["harmony","android"].forEach((s,i)=>document.getElementById(s+"-"+f.key).value=f.values[i]));exclude.checked=false;render();};
  render();
})();
