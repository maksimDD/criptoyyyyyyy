const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let displayCurrency=localStorage.getItem('blupDisplayCurrency')==='RUB'?'RUB':'USDT',rubPerUsd=82.829;
const money=n=>{const v=Number(n||0)*(displayCurrency==='RUB'?rubPerUsd:1);return displayCurrency==='RUB'?v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽':'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})};
async function api(url,opts={}){const r=await fetch(url,{...opts,credentials:'same-origin',headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Ошибка запроса');return d}

let data={cases:[],skins:{}},skinImages={},selectedCase=null,balance=0,loggedIn=false,promoPercent=0,depositRates={USDT:1,TON:0},depositWallets={USDT:{TRC20:'TCphExgGrK3TBWtfeubGQ7QXDCKTuMoTZA',BEP20:'0x88EdAc4B11E87EB124A5270CfD4Dc04dEB843184',ERC20:'0xa6511569eF753c10E4e145E447D619a3186d0509',TON:'UQCgljUWsZtjfBcGLZj72Yqq5pir-auWZtD5soVvWZnEVS7H',SPL:'8ztJwQUPr4iHyRrdaUT77KqDmKxzu6qJi2Emy14bsb5f'},TON:{TON:'UQCgljUWsZtjfBcGLZj72Yqq5pir-auWZtD5soVvWZnEVS7H'}};

const toast=m=>{const t=$('#toast');if(!t)return;t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)};
function openModal(id){const m=$('#'+id);if(m)m.classList.add('open');document.body.style.overflow='hidden'}
function closeModal(id){const m=$('#'+id);if(m)m.classList.remove('open');if(!$('.modal-backdrop.open'))document.body.style.overflow=''}

$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-backdrop.open').forEach(m=>closeModal(m.id))});

function skin(id){return data.skins[id]||{name:id,price:0,rarity:'common'}}
function rarityMeta(r){return ({common:['Армейское','rarity-common'],mil_spec:['Армейское','rarity-common'],industrial:['Промышленное','rarity-industrial'],consumer:['Потребительское','rarity-consumer'],rare:['Запрещённое','rarity-rare'],restricted:['Запрещённое','rarity-rare'],classified:['Засекреченное','rarity-classified'],epic:['Засекреченное','rarity-classified'],covert:['Тайное','rarity-covert'],legendary:['Тайное','rarity-covert'],contraband:['Контрабандное','rarity-legendary'],extraordinary:['Экстраординарное','rarity-legendary']})[String(r||'common').toLowerCase().replace(/[ -]/g,'_')]||['Армейское','rarity-common']}

function caseCover(c){
  const n=String(c.id||'').match(/(\d+)$/);
  if(n)return `/assets/cases/case-${n[1].padStart(2,'0')}.png`;
  return String(c.image||'/assets/cases/placeholder.png');
}

window.blupSkinImageFail=function(img){
  if(!img.dataset.retry&&img.src.includes('raw.githubusercontent.com')){
    img.dataset.retry='1';
    img.src=img.src.replace('raw.githubusercontent.com/ByMykel/','cdn.jsdelivr.net/gh/ByMykel/').replace('/main/','@main/');
    return;
  }
  const el=document.createElement('div');el.className='skin-placeholder';el.textContent='CS2';img.replaceWith(el);
};

function skinCard(id,showChance=false){
  const item=skin(id),img=skinImages[item.name]||item.image,[tier,tierClass]=rarityMeta(item.rarity);
  let chance=0;
  if(showChance&&selectedCase){
    const explicit=selectedCase.chances&&Object.keys(selectedCase.chances).length>0;
    const weights=selectedCase.items.map(k=>{const q=skin(k);return explicit?Math.max(0,Number(selectedCase.chances[k]||0)):Math.max(1,Math.floor(1000000000000/Math.pow(Math.max(.2,Number(q.price)||.2),2.5)))});
    const total=weights.reduce((a,b)=>a+b,0);
    const idx=selectedCase.items.indexOf(id);
    chance=idx>=0?weights[idx]/total*100:0;
  }
  return `<article class="skin-card ${tierClass}">${img?`<img loading="lazy" src="${esc(img)}" alt="${esc(item.name)}" onerror="window.blupSkinImageFail(this)"/>`:'<div class="skin-placeholder">CS2</div>'}<b>${esc(item.name)}</b><span>${money(item.price)}</span>${showChance?`<button class="chance-info" type="button" aria-label="Шанс">i<span class="chance-tooltip">Шанс: <strong>${chance.toFixed(4)}%</strong></span></button>`:''}</article>`;
}

function renderCases(filter='all'){
  try{
    const grid=$('#caseGrid');if(!grid)return;
    const list=data.cases.filter(c=>filter==='all'||c.tier===filter);
    if(!list.length){
      grid.innerHTML='<div class="loading-state">Кейсы не найдены. Попробуй другой фильтр.</div>';
      return;
    }
    grid.innerHTML=list.map((c,i)=>`<article class="case-card" data-case="${esc(c.id)}" style="--case-color:${['#4754aa','#257a93','#7648a8','#985a54','#3d8c78'][i%5]};--case-glow:${['#665cff','#38cce0','#a66cff','#ff9e66'][i%4]}"><div class="case-art"><img src="${esc(caseCover(c))}" alt="${esc(c.name)}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('cover-fallback')"></div><h3>${esc(c.name)}</h3><div class="case-card-price">${money(c.price)}</div></article>`).join('');
    $$('.case-card').forEach(el=>el.onclick=()=>location.href='/cases/'+encodeURIComponent(el.dataset.case));
  }catch(e){console.error('renderCases error:',e);const g=$('#caseGrid');if(g)g.innerHTML='<div class="loading-state">Ошибка отрисовки кейсов. Обнови страницу.</div>'}
}

function showCase(id){
  selectedCase=data.cases.find(c=>c.id===id);if(!selectedCase)return;
  const t=$('#caseTitle'),s=$('#caseSubtitle'),p=$('#possibleSkins'),r=$('#reel'),pr=$('#casePrize'),msg=$('#caseMessage'),btn=$('#openCaseConfirm');
  if(t)t.textContent=selectedCase.name;
  if(s)s.textContent=money(selectedCase.price);
  if(p)p.innerHTML=selectedCase.items.map(id=>skinCard(id,true)).join('');
  if(r)r.innerHTML=selectedCase.items.concat(selectedCase.items).slice(0,20).map(id=>{const sk=skin(id),img=skinImages[sk.name]||sk.image;return `<div class="reel-item">${img?`<img loading="lazy" src="${esc(img)}" alt=""/>`:'<div class="skin-placeholder">CS2</div>'}</div>`}).join('');
  if(pr)pr.classList.add('hidden');
  if(msg)msg.textContent='';
  if(btn){btn.disabled=false;btn.textContent=`Открыть за ${money(selectedCase.price)}`}
  openModal('caseModal');
}

async function refreshBalance(){
  try{const d=await api('/api/cases/balance');loggedIn=true;balance=Number(d.balance||0);
    const bv=$('#balanceValue');if(bv)bv.textContent=money(balance);
    const wb=$('#withdrawBalance');if(wb)wb.textContent=money(balance);
  }catch(e){loggedIn=false;balance=0;const bv=$('#balanceValue');if(bv)bv.textContent='Войти';const wb=$('#withdrawBalance');if(wb)wb.textContent='—'}
}

async function loadInventory(){
  try{
    const d=await api('/api/cases/inventory');
    const g=$('#inventoryGrid');if(!g)return;
    g.innerHTML=d.items.length?d.items.slice(0,30).map(x=>`<article class="skin-card inventory-card"><img loading="lazy" src="${esc(skinImages[x.skin_name]||'')}" alt="${esc(x.skin_name)}"><b>${esc(x.skin_name)}</b><span>${money(x.price)}</span><div class="inventory-actions"><button data-sell="${x.id}">Продать · ${money(x.price)}</button><button data-withdraw="${x.id}" ${x.withdrawal_pending?'disabled':''}>${x.withdrawal_pending?'Заявка отправлена':'Вывести в Steam'}</button></div></article>`).join(''):'<div class="empty-inventory">Пока нет выпавших предметов. Открой свой первый кейс!</div>';
    $$('[data-sell]').forEach(b=>b.onclick=()=>sellInventory(b.dataset.sell));
    $$('[data-withdraw]').forEach(b=>b.onclick=()=>withdrawInventory(b.dataset.withdraw));
  }catch(e){const g=$('#inventoryGrid');if(g)g.innerHTML='<div class="empty-inventory">Войди в аккаунт, чтобы увидеть инвентарь.</div>'}
}

async function sellInventory(id){if(!confirm('Продать предмет за полную отображаемую цену?'))return;try{const d=await api(`/api/cases/inventory/${id}/sell`,{method:'POST'});balance=Number(d.balance||0);const bv=$('#balanceValue');if(bv)bv.textContent=money(balance);toast(`Продано: +${money(d.credited)}`);await loadInventory()}catch(e){toast(e.message)}}
async function withdrawInventory(id){if(!confirm('Создать заявку на вывод этого скина в Steam?'))return;try{const d=await api(`/api/cases/inventory/${id}/withdraw`,{method:'POST'});toast(d.message||`Заявка №${d.id} создана`);await loadInventory()}catch(e){if(e.message.includes('Trade URL')){toast('Сначала добавь Steam Trade URL в профиле');location.href='/cases/profile'}else toast(e.message)}}

async function loadImages(){
  try{const payload=await api('/api/cases/skin-images');Object.assign(skinImages,payload.images||{});for(const item of Object.values(data.skins||{}))if(payload.rarities?.[item.name])item.rarity=payload.rarities[item.name]}catch(e){console.warn('Skin image cache unavailable',e)}
  renderCases();
  if(selectedCase){const p=$('#possibleSkins');if(p)p.innerHTML=selectedCase.items.map(id=>skinCard(id,true)).join('')}
  loadInventory();
}

function refreshCurrency(){
  localStorage.setItem('blupDisplayCurrency',displayCurrency);
  if(displayCurrency==='RUB'&&!rubPerUsd){displayCurrency='USDT';localStorage.setItem('blupDisplayCurrency','USDT');const dc=$('#displayCurrency');if(dc)dc.value='USDT';toast('Курс RUB не задан администратором')}
  renderCases();
  if(selectedCase){
    const s=$('#caseSubtitle');if(s)s.textContent=`${selectedCase.items.length} возможных предметов · ${money(selectedCase.price)}`;
    const p=$('#possibleSkins');if(p)p.innerHTML=selectedCase.items.map(id=>skinCard(id,true)).join('');
    const b=$('#openCaseConfirm');if(b)b.textContent=`Открыть за ${money(selectedCase.price)}`;
  }
  const bv=$('#balanceValue');if(bv)bv.textContent=loggedIn?money(balance):'Войти';
  const wb=$('#withdrawBalance');if(wb)wb.textContent=money(balance);
  const wu=$('#withdrawUnitLabel');if(wu)wu.textContent=displayCurrency;
  if($('#baseTotal'))updateDepositTotals();
  loadInventory();
}

async function init(){
  // ФИКС: каталог с API (админка пишет туда же), fallback на JSON
  try{
    try{
      data=await api('/api/cases/catalog');
    }catch(e){
      console.warn('API /api/cases/catalog недоступен, fallback на cases-data.json:',e.message);
      const res=await fetch('/cases-data.json');
      if(!res.ok)throw Error('cases-data.json: '+res.status);
      data=await res.json();
    }
    if(!data.cases||!data.cases.length)throw Error('Каталог пуст');
    renderCases();
  }catch(e){
    console.error('load cases error:',e);
    const g=$('#caseGrid');if(g)g.innerHTML='<div class="loading-state">Не удалось загрузить каталог кейсов.<br><small style="color:#8993b2">Проверь /cases-data.json или /api/cases/catalog.</small></div>';
  }
  loadImages();
  try{
    const caseCfg=await api('/api/cases/config');
    rubPerUsd=Number(caseCfg.rubPerUsd)||82.829;
    if(rubPerUsd<10)rubPerUsd=82.829;
  }catch{}
  try{const cfg=await api('/api/config');const u=Number(cfg.usdtRate)||0,g=Number(cfg.gramRate)||0;depositRates.TON=u>0&&g>0?g/u:0;if(!depositRates.TON){const dm=$('#depositMessage');if(dm)dm.textContent='Курс TON не задан администратором.'}}catch{}
  try{const me=await api('/api/me');if(me.nickname){const lb=$('#loginBtn');if(lb){lb.textContent=me.nickname;lb.onclick=()=>location.href='/cases/profile'}}}catch{}
  await refreshBalance();
  await loadInventory();
}

// ===== Обработчики =====
const dc=$('#displayCurrency');if(dc){dc.value=displayCurrency;dc.onchange=()=>{displayCurrency=dc.value;refreshCurrency()}}
$$('.filter').forEach(b=>b.onclick=()=>{$$('.filter').forEach(x=>x.classList.toggle('active',x===b));renderCases(b.dataset.filter)});
const mm=$('#mobileMenu');if(mm)mm.onclick=()=>{const n=document.querySelector('.topbar nav');if(n)n.classList.toggle('open')};
const lb=$('#loginBtn');if(lb)lb.onclick=()=>location.href='/?login=1';

const dOpen=$('#depositOpen');if(dOpen)dOpen.onclick=()=>{if(!loggedIn)return location.href='/?login=1';updateDepositWallet();updateDepositTotals();const dm=$('#depositMessage');if(dm)dm.textContent='';openModal('depositModal')};
const wOpen=$('#withdrawOpen');if(wOpen)wOpen.onclick=()=>{if(!loggedIn)return location.href='/?login=1';refreshBalance();const wm=$('#withdrawMessage');if(wm)wm.textContent='';openModal('withdrawModal')};

function updateDepositWallet(){
  const coin=$('#depositCoin'),net=$('#depositNetwork');if(!coin||!net)return;
  const address=depositWallets[coin.value]?.[net.value]||'Сеть недоступна';
  const dw=$('#depositWallet');if(dw)dw.textContent=address;
  const wn=$('#walletNetwork');if(wn)wn.textContent=net.value;
  net.disabled=coin.value==='TON';
  const du=$('#depositUnitLabel');if(du)du.textContent=coin.value;
  const da=$('#depositAmount');if(da){da.placeholder=coin.value==='TON'?'Например, 2.5 TON':'Например, 25 USDT';da.step=coin.value==='TON'?'0.00000001':'0.01'}
  updateDepositTotals();
}

const dcCoin=$('#depositCoin');if(dcCoin)dcCoin.onchange=()=>{const net=$('#depositNetwork');if(net)net.innerHTML=(dcCoin.value==='TON'?['TON']:['TRC20','BEP20','ERC20','TON','SPL']).map(n=>`<option>${n}</option>`).join('');updateDepositWallet()};
const dNet=$('#depositNetwork');if(dNet)dNet.onchange=updateDepositWallet;
const dAmt=$('#depositAmount');if(dAmt)dAmt.oninput=updateDepositTotals;
const dPromo=$('#depositPromo');if(dPromo)dPromo.oninput=()=>{promoPercent=0;updateDepositTotals()};

function updateDepositTotals(){
  const coin=$('#depositCoin'),amt=$('#depositAmount');if(!coin||!amt)return;
  const tokenAmount=Math.max(0,Number(amt.value)||0),rate=coin.value==='TON'?depositRates.TON:1,amount=tokenAmount*rate,bonus=amount*promoPercent/100;
  const bt=$('#baseTotal');if(bt)bt.textContent=money(amount);
  const pt=$('#promoTotal');if(pt)pt.textContent=money(bonus);
  const ft=$('#finalTotal');if(ft)ft.textContent=money(amount+bonus);
}

const adp=$('#applyDepositPromo');if(adp)adp.onclick=async()=>{const code=$('#depositPromo')?.value.trim()||'';if(!code){promoPercent=0;updateDepositTotals();return}try{const d=await api('/api/cases/promo-preview',{method:'POST',body:JSON.stringify({code
