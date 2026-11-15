const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];

function cs2TransparentPng(url){
  const value=String(url||'');
  if(!value)return '';
  if(/\.png(?:\?|$)/i.test(value))return value;
  return value;
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opts={}){const r=await fetch(url,{...opts,credentials:'same-origin',headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Ошибка запроса');return d}
let inventory=[],targets=[],selected=new Set(),targetId='',images={},multiplierFilter=5,busy=false,fastUpgrade=false,inventoryError='',statusMessage='',balanceAvailable=0,balanceAmount=0,displayCurrency=localStorage.getItem('blupDisplayCurrency')==='RUB'?'RUB':'USDT',rubPerUsd=82.829;
const usd=n=>{const v=Number(n||0)*(displayCurrency==='RUB'?rubPerUsd:1);return displayCurrency==='RUB'?v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽':'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})},itemStake=()=>inventory.filter(x=>selected.has(Number(x.id))).reduce((a,x)=>a+Number(x.price||0),0),stake=()=>Number((itemStake()+balanceAmount).toFixed(2)),chosen=()=>targets.find(x=>String(x.id)===String(targetId)),chanceFor=t=>t&&stake()>0?Math.min(86,Math.max(1,stake()/Number(t.price)*100)):0;
function rarityClass(r){const s=String(r||'common').toLowerCase().replace(/[ -]/g,'_');if(s.includes('legend')||s.includes('contraband')||s==='extraordinary')return'rarity-legendary';if(s.includes('covert'))return'rarity-covert';if(s==='epic'||s==='classified'||s.includes('classified'))return'rarity-classified';if(s.includes('restricted')||s==='rare')return'rarity-rare';if(s.includes('industrial'))return'rarity-industrial';if(s.includes('consumer'))return'rarity-consumer';return'rarity-common'}
function imageTag(name){const url=images[name]||targets.find(x=>x.name===name||x.marketHashName===name)?.image||'';return url?`<img loading="lazy" src="${esc(url)}" alt="${esc(name)}" data-skin-name="${esc(name)}" onerror="window.skinImgFail(this)">`:`<div class="skin-fallback"><span>◈</span></div>`}
window.skinImgFail=function(img){if(!img.dataset.fallback&&img.src.includes('raw.githubusercontent.com')){img.dataset.fallback='1';img.src=img.src.replace('raw.githubusercontent.com/ByMykel/','cdn.jsdelivr.net/gh/ByMykel/').replace('/main/','@main/');return}const d=document.createElement('div');d.className='skin-fallback';d.innerHTML='<span>◈</span>';img.replaceWith(d)};
function skinCard(x,kind){const id=kind==='source'?Number(x.id):String(x.id),sel=kind==='source'?selected.has(id):String(targetId)===String(id),locked=kind==='source'&&!!x.withdrawal_pending;return `<button type="button" aria-label="${esc(kind==='source'?x.skin_name:x.name)}" class="up-skin ${rarityClass(x.rarity)} ${sel?'selected':''} ${locked?'disabled':''}" data-${kind}="${esc(id)}" ${locked||busy?'disabled':''}>${imageTag(kind==='source'?x.skin_name:x.name)}<b>${esc(kind==='source'?x.skin_name:x.name)}</b><small>${usd(x.price)}</small>${sel?'<i class="pick-mark">✓</i>':''}</button>`}
function previewMarkup(items,kind){if(!items.length&&kind==='source'&&balanceAmount>0)return `<div class="stage-empty"><b>₮</b><strong>БАЛАНС ${usd(balanceAmount)}</strong><small>Сумма добавлена к ставке</small></div>`;if(!items.length)return `<div class="stage-empty"><b>${kind==='source'?'⌁':'⌃'}</b><strong>${kind==='source'?'ТВОИ СКИНЫ':'ТВОЯ ЦЕЛЬ'}</strong><small>${kind==='source'?'Выбери предметы в инвентаре ниже':'Выбери желаемый предмет справа'}</small></div>`;return items.slice(0,3).map(x=>`<div class="preview-skin">${imageTag(kind==='source'?x.skin_name:x.name)}<b>${esc(kind==='source'?x.skin_name:x.name)}</b><small>${usd(x.price)}</small></div>`).join('')}
function filteredTargets(){const q=$('#targetSearch').value.trim().toLowerCase(),fromRaw=Number($('#priceFrom').value)||0,toRaw=Number($('#priceTo').value)||0,from=fromRaw?(displayCurrency==='RUB'?fromRaw/rubPerUsd:fromRaw):.05,to=toRaw?(displayCurrency==='RUB'?toRaw/rubPerUsd:toRaw):55,st=stake(),desired=st*Number(multiplierFilter||5);let a=targets.filter(x=>x.name.toLowerCase().includes(q)&&Number(x.price)>=from&&Number(x.price)<=to&&Number(x.price)>st);if(st>0){const tolerance=Math.max(.15,desired*.12);const near=a.filter(x=>Math.abs(Number(x.price)-desired)<=tolerance);if(near.length)a=near;}const sort=$('#targetSort').value;const quality={consumer:0,common:1,mil_spec:2,industrial:3,rare:4,restricted:4,epic:5,classified:5,covert:6,legendary:7,contraband:8,extraordinary:8};a.sort((x,y)=>{const tier=(quality[String(x.rarity).toLowerCase()]??1)-(quality[String(y.rarity).toLowerCase()]??1);if(tier)return tier;return sort==='price-desc'?y.price-x.price:sort==='name'?x.name.localeCompare(y.name):st?Math.abs(x.price-desired)-Math.abs(y.price-desired):x.price-y.price});return a}

function render(){
  // === FIX #1: считаем ставку ДО использования в разметке ===
  const st=stake(), t=chosen(), ch=chanceFor(t);

  const srcQ=$('#sourceSearch').value.trim().toLowerCase(),srcSort=$('#sourceSort').value;
  let src=inventory.filter(x=>String(x.skin_name).toLowerCase().includes(srcQ));
  src.sort((a,b)=>srcSort==='price-asc'?a.price-b.price:srcSort==='name'?a.skin_name.localeCompare(b.skin_name):b.price-a.price);

  $('#sourceGrid').innerHTML=inventoryError?`<div class="empty-inventory">${esc(inventoryError)}<br><a href="/?login=1">Войти в аккаунт</a></div>`:src.length?src.map(x=>skinCard(x,'source')).join(''):'<div class="empty-inventory">В инвентаре нет подходящих скинов. Открой кейс, чтобы получить предмет.</div>';

  const tg=filteredTargets();
  $('#targetGrid').innerHTML=tg.length?tg.map(x=>skinCard(x,'target')).join(''):st>55?'<div class="empty-inventory">Ставка выше максимальной цены в каталоге ($55). Убери часть предметов или уменьши сумму баланса.</div>':'<div class="empty-inventory">Подходящих скинов нет. Измени множитель или фильтр цены.</div>';

  $('#sourcePreview').innerHTML=previewMarkup(inventory.filter(x=>selected.has(Number(x.id))),'source');
  $('#targetPreview').innerHTML=previewMarkup(t?[t]:[],'target');
  $('#stakeTotal').textContent=usd(st);
  $('#stakeLabel').textContent=usd(st);
  $('#targetLabel').textContent=t?`${t.name} · ${usd(t.price)}`:'не выбрана';
  $('#targetMultiplier').textContent='x'+multiplierFilter;
  $('#chanceValue').textContent=ch.toFixed(2)+'%';
  $('#chanceValue').title='Шанс: '+ch.toFixed(2)+'%';
  $('#multiplier').textContent=t&&st?'× '+(t.price/st).toFixed(2):'× —';
  $('#wheelShell').style.setProperty('--chance',(ch*3.6)+'deg');
  $('#selectedCount').textContent=selected.size+' / 5 скинов';
  $('#selectionMeter').style.width=(selected.size/5*100)+'%';
  $('#balanceAvailable').textContent='Доступно '+usd(balanceAvailable);

  // === FIX #2: ползунок баланса может отсутствовать — не падаем ===
  const br=$('#balanceAmountRange');
  if(br){br.max=String(balanceAvailable);br.value=String(Math.min(balanceAmount,balanceAvailable));br.disabled=busy||balanceAvailable<=0;}
  const bl=$('#balanceAmountLabel');if(bl)bl.textContent=usd(balanceAmount);

  $('#inventoryCount').textContent=inventory.length;
  $('#targetCount').textContent=tg.length;

  // === КНОПКА «УЛУЧШИТЬ» ===
  const btn=$('#upgradeBtn');
  btn.disabled=busy||(!selected.size&&balanceAmount<=0)||!t||!Number.isFinite(Number(t.price))||Number(t.price)<=st;
  btn.innerHTML=busy?'<span>◌</span> ПРОВЕРЯЕМ РЕЗУЛЬТАТ':'<span>⌁</span> УЛУЧШИТЬ';

  let hint=$('#upgradeHint');
  if(!hint){hint=document.createElement('div');hint.id='upgradeHint';hint.style.cssText='margin-top:10px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#8b93a7;text-align:center;min-height:16px';btn.insertAdjacentElement('afterend',hint)}
  hint.textContent=busy?'':!selected.size&&balanceAmount<=0?'ЧТОБЫ НАЖАТЬ: выбери 1–5 скинов в инвентаре слева или добавь баланс ползунком':!t?(st>55?'Ставка выше $55 — это максимум каталога. Убери часть предметов':'ЧТОБЫ НАЖАТЬ: выбери целевой скин дороже ставки'):Number(t.price)<=st?'Целевой скин должен быть дороже ставки':'';

  $('#wheelStatus').textContent=busy?'АПГРЕЙД В ПРОЦЕССЕ…':statusMessage||(!selected.size&&balanceAmount<=0?'ДОБАВЬ ПРЕДМЕТЫ ИЛИ БАЛАНС':!t?'ВЫБЕРИ ЦЕЛЕВОЙ СКИН':'ВСЁ ГОТОВО К АПГРЕЙДУ');
}

async function loadImageMap(){try{const d=await api('/api/cases/skin-images');images=d.images||{};for(const x of targets){if(d.rarities?.[x.name])x.rarity=d.rarities[x.name];if(x.name&&x.image&&!images[x.name])images[x.name]=x.image}}catch{images={};for(const x of targets)if(x.name&&x.image)images[x.name]=x.image}}

async function load(){
  const [inv,cat,bal,cfg]=await Promise.allSettled([api('/api/cases/inventory'),api('/api/cases/upgrader/catalog'),api('/api/cases/balance'),api('/api/cases/config')]);
  if(cfg.status==='fulfilled')rubPerUsd=Number(cfg.value.rubPerUsd)||82.829;
  if(inv.status==='fulfilled'){inventory=inv.value.items||[];inventoryError=''}else{inventory=[];inventoryError=inv.reason?.message||'Войди в аккаунт, чтобы использовать свои скины'}
  if(cat.status==='fulfilled')targets=cat.value.skins||[];else targets=[];
  balanceAvailable=bal.status==='fulfilled'?Number(bal.value.balance||0):0;
  balanceAmount=Math.min(balanceAmount,balanceAvailable);
  await loadImageMap();
  render();
  if(!targets.length)$('#targetGrid').innerHTML='<div class="empty-inventory">Не удалось загрузить каталог целевых скинов.</div>';
}

// ===== Обработчики (все с null-check) =====
const srcGrid=$('#sourceGrid');
if(srcGrid)srcGrid.addEventListener('click',e=>{const b=e.target.closest('button[data-source]');if(!b||b.disabled||busy)return;const id=Number(b.dataset.source);if(!Number.isSafeInteger(id)||id<1)return;if(selected.has(id))selected.delete(id);else if(selected.size<5)selected.add(id);else return toast('Можно выбрать максимум 5 предметов');statusMessage='';render();});

const tgtGrid=$('#targetGrid');
if(tgtGrid)tgtGrid.addEventListener('click',e=>{const b=e.target.closest('button[data-target]');if(!b||b.disabled||busy)return;targetId=String(b.dataset.target);statusMessage='';render();});

function toast(msg){const t=$('#upToast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window.__upToastTimer);window.__upToastTimer=setTimeout(()=>t.classList.remove('show'),2600)}

['sourceSearch','sourceSort','targetSearch','targetSort','priceFrom','priceTo'].forEach(id=>{const el=$('#'+id);if(el)el.addEventListener(id.includes('Search')||id.startsWith('price')?'input':'change',render)});

$$('[data-mult]').forEach(b=>b.onclick=()=>{multiplierFilter=Number(b.dataset.mult);$$('[data-mult]').forEach(x=>x.classList.toggle('active',x===b));statusMessage='';render()});

const upCur=$('#upCurrency');
if(upCur){upCur.value=displayCurrency;upCur.onchange=()=>{displayCurrency=upCur.value;localStorage.setItem('blupDisplayCurrency',displayCurrency);$('#priceFrom').value='';$('#priceTo').value='';render()}}

const brEl=$('#balanceAmountRange');
if(brEl)brEl.oninput=e=>{balanceAmount=Math.min(balanceAvailable,Math.max(0,Number(e.target.value)||0));statusMessage='';render()};

const ufEl=$('#upgradeFast');
if(ufEl)ufEl.onclick=()=>{fastUpgrade=!fastUpgrade;ufEl.classList.toggle('active',fastUpgrade);ufEl.setAttribute('aria-pressed',String(fastUpgrade))};

// ===== ГЛАВНАЯ КНОПКА «УЛУЧШИТЬ» =====
const upBtn=$('#upgradeBtn');
if(upBtn)upBtn.addEventListener('click',async()=>{
  if(busy)return;
  const target=chosen(),total=stake();
  if((!selected.size&&balanceAmount<=0)||!target){statusMessage='СНАЧАЛА ВЫБЕРИ СТАВКУ И ЦЕЛЬ';toast(statusMessage);render();return;}
  if(Number(target.price)<=total){statusMessage='ЦЕЛЕВОЙ СКИН ДОЛЖЕН БЫТЬ ДОРОЖЕ СТАВКИ';toast(statusMessage);render();return;}
  statusMessage='';busy=true;render();

  const shell=$('#wheelShell'),needle=$('#wheelNeedle');
  if(shell)shell.classList.remove('win','lose','spinning');
  if(needle){needle.style.transition='none';needle.style.transform='rotate(0deg)';void needle.offsetWidth;}
  try{
    const d=await api('/api/cases/upgrader',{method:'POST',body:JSON.stringify({sourceIds:[...selected],targetSkinId:String(target.id),balanceAmount:Number(balanceAmount.toFixed(2))})});
    if(typeof d.roll!=='number'||typeof d.won!=='boolean')throw Error('Сервер вернул некорректный результат. Обнови страницу.');
    if(shell)shell.classList.add('spinning');
    const finalAngle=1800+Number(d.roll)*3.6;
    if(needle)requestAnimationFrame(()=>{needle.style.transition=`transform ${fastUpgrade?850:4200}ms cubic-bezier(.08,.78,.09,1)`;needle.style.transform=`rotate(${finalAngle}deg)`});
    await new Promise(r=>setTimeout(r,fastUpgrade?950:4350));
    if(shell){shell.classList.remove('spinning');shell.classList.add(d.won?'win':'lose');}
    statusMessage=d.won?'ПОБЕДА! ПРЕДМЕТ ДОБАВЛЕН В ИНВЕНТАРЬ':'НЕ ПОВЕЗЛО — ПОПРОБУЙ ЕЩЁ';
    const ws=$('#wheelStatus');if(ws)ws.textContent=statusMessage;
    const cv=$('#chanceValue');if(cv)cv.textContent=Number(d.chance).toFixed(2)+'%';
    toast(d.won?`Выпал ${d.target?.name||'целевой скин'}!`:'Апгрейд не прошёл');
    selected.clear();targetId='';balanceAmount=0;
    await new Promise(r=>setTimeout(r,700));
    const [inv,bal]=await Promise.all([api('/api/cases/inventory'),api('/api/cases/balance')]);
    inventory=inv.items||[];balanceAvailable=Number(bal.balance||0);inventoryError='';
  }catch(e){
    statusMessage='ОШИБКА: '+(e.message||'Не удалось выполнить апгрейд');
    toast(statusMessage);
    if(shell)shell.classList.remove('spinning');
    const ws=$('#wheelStatus');if(ws)ws.textContent=statusMessage;
  }finally{
    busy=false;
    render();
  }
});

load();
