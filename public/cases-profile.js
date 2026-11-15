const $=s=>document.querySelector(s);
const profileConfirm=message=>new Promise(resolve=>{let root=document.querySelector('#profileConfirmBackdrop');if(!root){root=document.createElement('div');root.id='profileConfirmBackdrop';root.className='modal-backdrop';root.innerHTML='<section class="modal confirm-modal"><div class="eyebrow">ПОДТВЕРЖДЕНИЕ</div><h2>Подтвердить действие?</h2><p class="modal-sub"></p><div class="modal-actions"><button class="action-btn secondary" data-no>Отмена</button><button class="action-btn deposit-btn" data-yes>Продолжить</button></div></section>';document.body.append(root)}root.querySelector('.modal-sub').textContent=message;root.classList.add('open');const finish=v=>{root.classList.remove('open');root.querySelector('[data-no]').onclick=null;root.querySelector('[data-yes]').onclick=null;resolve(v)};root.querySelector('[data-no]').onclick=()=>finish(false);root.querySelector('[data-yes]').onclick=()=>finish(true)});

const setText=(s,v)=>{const e=$(s);if(e)e.textContent=v;};
const setHTML=(s,v)=>{const e=$(s);if(e)e.innerHTML=v;};
const setVal =(s,v)=>{const e=$(s);if(e)e.value=v;};
const on    =(s,ev,fn)=>{const e=$(s);if(e)e.addEventListener(ev,fn);};

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let displayCurrency=localStorage.getItem('blupDisplayCurrency')==='RUB'?'RUB':'USDT',rubPerUsd=82.829;
const money=n=>{const v=Number(n||0)*(displayCurrency==='RUB'?rubPerUsd:1);return displayCurrency==='RUB'?v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽':'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})};

async function api(url,opts={}){
  const r=await fetch(url,{...opts,credentials:'same-origin',headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||'Ошибка запроса');
  return d;
}

let inventory=[],user=null,skinImages={};

function toast(msg){const t=$('#toast');if(!t){alert(msg);return}t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}

function showError(msg){const e=$('#cp-error');if(e){e.textContent=msg;e.style.display=msg?'block':'none'}}

function renderInventory(){
  const grid=$('#cp-inventory');if(!grid)return;
  if(!inventory.length){
    grid.innerHTML='<div class="cases-profile-empty"><strong>Инвентарь пуст</strong>Открой кейс на странице <a href="/cases" style="color:#b8aaff">/cases</a>, чтобы получить первый скин.</div>';
    updateSellAllButton();
    return;
  }
  grid.innerHTML=inventory.map(x=>{
    const img=skinImages[x.skin_name]||'';
    return `<article class="cases-profile-skin">
      ${img?`<img loading="lazy" src="${esc(img)}" alt="${esc(x.skin_name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'skin-placeholder',textContent:'CS2',style:'height:115px;display:grid;place-items:center;color:#7783ad;font-weight:900'}))"/>`:'<div class="skin-placeholder" style="height:115px;display:grid;place-items:center;color:#7783ad;font-weight:900">CS2</div>'}
      <b>${esc(x.skin_name)}</b>
      <div class="skin-price">${money(x.price)}</div>
      <div class="skin-actions">
        <button type="button" data-sell="${esc(x.id)}">Продать · ${money(x.price)}</button>
        <button type="button" data-withdraw="${esc(x.id)}" ${x.withdrawal_pending?'disabled':''}>${x.withdrawal_pending?'Заявка отправлена':'Вывести в Steam'}</button>
      </div>
    </article>`;
  }).join('');
  grid.querySelectorAll('[data-sell]').forEach(b=>b.onclick=()=>sellOne(b.dataset.sell));
  grid.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=()=>withdrawOne(b.dataset.withdraw));
  updateSellAllButton();
}

function updateSellAllButton(){
  const btn=$('#cp-sellall-btn'),info=$('#cp-sellall-info');
  if(!btn||!info)return;
  const total=inventory.reduce((a,x)=>a+Number(x.price||0),0);
  const sellable=inventory.filter(x=>!x.withdrawal_pending);
  if(!inventory.length){btn.disabled=true;info.textContent='Нет предметов для продажи';return}
  btn.disabled=sellable.length===0;
  info.textContent=`${inventory.length} предметов на сумму ${money(total)}`;
  btn.textContent=`Продать всё · ${money(sellable.reduce((a,x)=>a+Number(x.price||0),0))}`;
}

async function sellOne(id){
  if(!await profileConfirm('Продать предмет за полную отображаемую цену?'))return;
  try{
    const d=await api(`/api/cases/inventory/${id}/sell`,{method:'POST'});
    toast(`Продано: +${money(d.credited)}`);
    await loadInventory();
  }catch(e){toast(e.message)}
}

async function sellAll(){
  const sellable=inventory.filter(x=>!x.withdrawal_pending);
  if(!sellable.length){toast('Нет предметов для продажи');return}
  if(!await profileConfirm(`Продать все ${sellable.length} предметов?`))return;
  const btn=$('#cp-sellall-btn');if(btn)btn.disabled=true;
  let sold=0,total=0,errors=0;
  for(const item of sellable){
    try{
      const d=await api(`/api/cases/inventory/${item.id}/sell`,{method:'POST'});
      sold++;total+=Number(d.credited||0);
    }catch(e){errors++;console.warn('sell error',item.id,e.message)}
  }
  toast(`Продано ${sold} предметов на ${money(total)}${errors?` (${errors} ошибок)`:''}`);
  await loadInventory();
}

async function withdrawOne(id){
  if(!await profileConfirm('Создать заявку на вывод этого скина в Steam?'))return;
  try{
    const d=await api(`/api/cases/inventory/${id}/withdraw`,{method:'POST'});
    toast(d.message||`Заявка №${d.id} создана`);
    await loadInventory();
  }catch(e){
    if(e.message.includes('Trade URL')){toast('Сначала добавь Steam Trade URL');location.href='/cases/profile'}
    else toast(e.message);
  }
}

async function loadInventory(){
  const grid=$('#cp-inventory');
  try{
    const d=await api('/api/cases/inventory');
    inventory=d.items||[];
    showError('');
    renderInventory();
  }catch(e){
    inventory=[];
    if(grid)grid.innerHTML='<div class="cases-profile-empty"><strong>Не удалось загрузить инвентарь</strong>Войди в аккаунт, чтобы увидеть скины.</div>';
    showError('Ошибка: '+e.message);
  }
}

async function loadSkinImages(){
  try{
    const d=await api('/api/cases/skin-images');
    skinImages=d.images||{};
  }catch(e){console.warn('skin images fail',e)}
}

async function loadUser(){
  try{
    const me=await api('/api/me');
    user=me;
    setText('#cp-nick',me.nickname||me.name||'Пользователь');
    const av=$('#cp-avatar');
    const fb=$('#cp-avatar-fallback');
    if(av&&me.avatar){
      av.src=me.avatar;
      av.onerror=()=>{av.style.display='none';if(fb)fb.style.display='grid'};
      if(fb)fb.style.display='none';
    }else if(av){av.style.display='none';if(fb)fb.style.display='grid'}
    if(me.tradeUrl){setVal('#cp-trade-url',me.tradeUrl)}
  }catch(e){
    setText('#cp-nick','Гость');
    const av=$('#cp-avatar'),fb=$('#cp-avatar-fallback');
    if(av)av.style.display='none';
    if(fb)fb.style.display='grid';
  }
}

async function saveTradeUrl(e){
  e.preventDefault();
  const url=$('#cp-trade-url')?.value.trim();
  const msg=$('#cp-trade-message');
  if(!url){if(msg)msg.textContent='Введи ссылку обмена Steam';return}
  if(!/^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d+&token=[A-Za-z0-9_-]+/.test(url)){
    if(msg)msg.textContent='Ссылка должна быть вида https://steamcommunity.com/tradeoffer/new/?partner=...&token=...';
    return;
  }
  try{
    await api('/api/cases/profile/trade-url',{method:'POST',body:JSON.stringify({tradeUrl:url})});
    if(msg)msg.textContent='Trade URL сохранён';
    toast('Trade URL сохранён');
  }catch(err){if(msg)msg.textContent=err.message}
}

async function logout(){
  try{await api('/api/logout',{method:'POST'})}catch{}
  location.href='/';
}

async function init(){
  const cur=$('#cp-currency');
  if(cur){cur.value=displayCurrency;cur.onchange=()=>{displayCurrency=cur.value;localStorage.setItem('blupDisplayCurrency',displayCurrency);renderInventory()}}
  on('#cp-sellall-btn','click',sellAll);
  on('#cp-trade-form','submit',saveTradeUrl);
  on('#cp-logout','click',logout);
  await loadSkinImages();
  await loadUser();
  await loadInventory();
}

init();
