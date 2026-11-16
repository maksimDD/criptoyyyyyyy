
(()=>{'use strict';const $=s=>document.querySelector(s);let inventory=[],selected=new Set(),busy=false;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const money=n=>'$'+Number(n||0).toFixed(2);async function api(url,opts={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Ошибка запроса');return d}const chosen=()=>inventory.filter(x=>selected.has(Number(x.id))),total=()=>Number(chosen().reduce((a,x)=>a+Number(x.price||0),0).toFixed(2));function toast(s){const t=$('#ctToast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}function item(x,removable=false){return `<div class="ct-item"><img loading="lazy" src="${esc(x.image||'')}" onerror="this.style.visibility='hidden'"><b>${esc(x.skin_name||x.name)}</b><small>${money(x.price)}</small>${removable?`<button type="button" data-remove="${Number(x.id)}" aria-label="Убрать">×</button>`:''}</div>`}function render(){const arr=chosen(),sum=total();$('#ctSelected').innerHTML=arr.length?arr.map(x=>item(x,true)).join(''):'<div class="ct-empty">Выбери минимум 3 скина в инвентаре ниже</div>';$('#ctCount').textContent=arr.length+' / 10 предметов';$('#ctTotal').textContent=money(sum);$('#ctSubmit').disabled=busy||arr.length<3||arr.length>10||sum>12||sum<=0;const q=$('#ctSearch').value.trim().toLowerCase();const filtered=inventory.filter(x=>String(x.skin_name).toLowerCase().includes(q));$('#ctGrid').innerHTML=filtered.length?filtered.map(x=>`<button class="ct-card ${selected.has(Number(x.id))?'selected':''}" data-pick="${Number(x.id)}" ${x.withdrawal_pending||busy?'disabled':''}><img loading="lazy" src="${esc(x.image||'')}" onerror="this.style.visibility='hidden'"><b>${esc(x.skin_name)}</b><small>${money(x.price)}</small>${x.withdrawal_pending?'<span class="ct-lock">Заявка на вывод</span>':''}</button>`).join(''):'<div class="ct-empty">Нет предметов в инвентаре</div>'}async function load(){try{const d=await api('/api/cases/inventory');inventory=d.items||[];$('#ctGrid').dataset.ready='1';render()}catch(e){$('#ctGrid').innerHTML=`<div class="ct-empty">${esc(e.message)} · <a href="/?login=1">Войти</a></div>`}}$('#ctGrid').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b||busy)return;const id=Number(b.dataset.pick);if(selected.has(id))selected.delete(id);else{if(selected.size>=10)return toast('Максимум 10 предметов');const next=inventory.find(x=>Number(x.id)===id);if(next&&total()+Number(next.price)>15.0001)return toast('Лимит суммы контракта достигнут');selected.add(id)}render()});$('#ctSelected').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){selected.delete(Number(b.dataset.remove));render()}});$('#ctSearch').addEventListener('input',render);$('#ctSubmit').addEventListener('click',async()=>{
 if(busy)return;
 busy=true;render();
 const machine=$('.ct-machine'),mixTitle=$('#ctMix').querySelector('b'),resultBox=$('#ctResult');
 machine.classList.add('ct-mixing');mixTitle.textContent='ПЕРЕМЕШИВАЕМ СКИНЫ';
 const pool=chosen().length?chosen():inventory;
 const shuffleTimer=setInterval(()=>{
   if(!pool.length)return;
   const picks=Array.from({length:3},()=>pool[Math.floor(Math.random()*pool.length)]);
   resultBox.innerHTML=`<div class="ct-shuffle-stage"><div class="ct-shuffle-track">${picks.map((x,i)=>`<div class="ct-shuffle-skin" style="--delay:${i*55}ms"><img src="${esc(x.image||'')}" alt=""><b>${esc(x.skin_name||x.name)}</b><small>${money(x.price)}</small></div>`).join('')}</div><span class="ct-shuffle-glow"></span></div>`;
 },115);
 try{
   const d=await api('/api/cases/contracts',{method:'POST',body:JSON.stringify({sourceIds:[...selected]})});
   await new Promise(r=>setTimeout(r,650));
   clearInterval(shuffleTimer);
   resultBox.innerHTML=item(d.result);
   resultBox.classList.add('ct-result-reveal');
   mixTitle.textContent='КОНТРАКТ УСПЕШЕН';
   $('#ctMix').querySelector('span').textContent=(d.multiplier||0).toFixed(2)+'x';
   toast('Получен '+(d.result.skin_name||d.result.name)+' · '+money(d.result.price));
   selected.clear();
   const fresh=await api('/api/cases/inventory');inventory=fresh.items||[];
 }catch(e){
   clearInterval(shuffleTimer);
   resultBox.innerHTML='<div class="ct-empty">Результат появится после успешного контракта</div>';
   toast(e.message);mixTitle.textContent='КОНТРАКТ';
 }finally{
   clearInterval(shuffleTimer);
   machine.classList.remove('ct-mixing');
   setTimeout(()=>resultBox.classList.remove('ct-result-reveal'),900);
   busy=false;render();
 }
});load()})();
