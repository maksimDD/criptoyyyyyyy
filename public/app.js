const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const toast = msg => { const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.classList.remove('show'),3200); };
const openModal = id => { const el=$('#'+id); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; };
const closeModal = id => { const el=$('#'+id); el.classList.remove('open'); el.setAttribute('aria-hidden','true'); if (!$('.modal-backdrop.open')) document.body.style.overflow=''; };
$('#year').textContent = new Date().getFullYear();
$('#menuToggle').addEventListener('click',()=>$('#nav').classList.toggle('open'));
$$('.nav-link').forEach(a=>a.addEventListener('click',()=>{$$('.nav-link').forEach(x=>x.classList.remove('active'));a.classList.add('active');$('#nav').classList.remove('open')}));
const userChip=$('#userChip'), loginBtn=$('#loginBtn');
let blockedNotified=false;
async function api(url, options={}) { const r=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Ошибка запроса'); return d; }
async function refreshUser(){try{const d=await api('/api/me');if(d.nickname){userChip.classList.remove('hidden');$('#userName').textContent=d.nickname;loginBtn.classList.add('hidden')}else{userChip.classList.add('hidden');loginBtn.classList.remove('hidden')}}catch(e){userChip.classList.add('hidden');loginBtn.classList.remove('hidden');if((e.message||'').includes('заблокирован')&&!blockedNotified){blockedNotified=true;toast(e.message)}}}
async function refreshConfig(){try{const c=await api('/api/config');const money=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2});$('#reserveAvailable').textContent='$'+money(c.reserveAvailable);$('#reserveTotal').textContent='$'+money(c.reserveTotal);$('#reserveMeter').style.width=(c.reserveTotal>0?Math.min(100,c.reserveAvailable/c.reserveTotal*100):0)+'%';$('#usdtRate').textContent=c.usdtRate>0?money(c.usdtRate)+' ₽':'не задан';$('#gramRate').textContent=c.gramRate>0?money(c.gramRate)+' ₽':'не задан';window.blupBanks=c.banks||[];}catch{}}
refreshUser();refreshConfig();
async function refreshMaintenance(){
 try{
  const d=await api('/api/status');
  const screen=$('#maintenanceScreen');
  if(screen) screen.classList.toggle('hidden',!d.stopped);
 }catch{}
}
refreshMaintenance();
setInterval(refreshMaintenance,10000);

// Re-check the account periodically so an administrator's ban closes an active UI session promptly.
setInterval(refreshUser,15000);

let operationType='sell';
const operationFields=$('#operationFields');
function labelInput(label,name,placeholder,type='text',full=false,required=true){return `<label class="${full?'full':''}">${label}<input name="${name}" type="${type}" placeholder="${placeholder}" ${required?'required':''} ${type==='number'?'min="0.01" step="0.01"':''}></label>`;}
function labelSelect(label,name,options,full=false){return `<label class="${full?'full':''}">${label}<select name="${name}" required>${options.map((x,i)=>`<option value="${escapeHtml(x.value)}" ${i===0?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}</select></label>`;}
function bankOptions(){const banks=window.blupBanks?.length?window.blupBanks:['Сбербанк','Т-Банк','ВТБ','Альфа-Банк','Газпромбанк'];return banks.map(b=>({value:b,label:`${bankIcon(b)}  ${b}`}));}
function bankIcon(name){const n=name.toLowerCase();if(n.includes('сбер'))return '🟢';if(n.includes('т-')||n.includes('тинь'))return '🟡';if(n.includes('втб'))return '🔵';if(n.includes('альфа'))return '🔴';if(n.includes('газпром'))return '💠';if(n.includes('озон'))return '🟣';return '🏦';}
function renderOperationFields(){
 const withdraw=operationType==='withdraw';
 if(withdraw){
  operationFields.innerHTML=`${labelInput('Сумма вывода','amount','Например, 50','number',true)}${labelSelect('Способ получения','payoutType',[{value:'phone',label:'По номеру телефона (СБП)'},{value:'card',label:'На банковскую карту'}])}${labelInput('Номер телефона или карты','payoutValue','Без CVV и срока действия','text',true)}${labelSelect('Банк получателя','bank',bankOptions(),true)}<p class="field-note full">BLUP никогда не запрашивает CVV/CVC, PIN-код или SMS-коды. Заявка уменьшает доступный резерв до решения администратора.</p>`;
 } else {
  operationFields.innerHTML=`${labelSelect('Криптовалюта','coin',[{value:'USDT',label:'USDT — Tether'},{value:'GRAM',label:'GRAM'}])}<div id="networkField">${labelSelect('Сеть USDT','network',['BEP20','TRC20','ERC20','TON','SPL'].map(x=>({value:x,label:x})))}</div>${labelInput('Адрес кошелька','wallet','Вставь адрес кошелька', 'text',true)}<div id="memoField" class="hidden">${labelInput('MEMO / комментарий (если нужен)','memo','Введи MEMO','text',true,false)}</div>${labelSelect('Способ получения','payoutType',[{value:'phone',label:'По номеру телефона (СБП)'},{value:'card',label:'На банковскую карту'}])}${labelInput('Номер телефона или карты','payoutValue','Без CVV и срока действия','text')}${labelSelect('Банк получателя','bank',bankOptions(),true)}<p class="field-note full">Не отправляй средства до подтверждения условий заявки. Для карты не указывай CVV/CVC, PIN-код или SMS-коды.</p>`;
  const coin=operationFields.querySelector('[name="coin"]');
  coin.addEventListener('change',()=>{const gram=coin.value==='GRAM';$('#networkField').innerHTML=gram?'<div class="static-field"><span>Сеть</span><b>TON</b></div>':labelSelect('Сеть USDT','network',['BEP20','TRC20','ERC20','TON','SPL'].map(x=>({value:x,label:x})));$('#memoField').classList.toggle('hidden',!gram);});
 }
}
function showOperation(type){operationType=type;$('#operationMessage').textContent='';const withdraw=type==='withdraw';$('#modalEyebrow').textContent=withdraw?'BLUP / ЗАПРОС НА ВЫВОД':'BLUP / ПРОДАЖА';$('#modalTitle').textContent=withdraw?'Запрос на вывод':'Продажа криптовалюты';$('#modalDesc').textContent=withdraw?'Укажи сумму и реквизиты для получения выплаты.':'Выбери актив, сеть и способ получения средств.';renderOperationFields();openModal('modalBackdrop');}
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>showOperation(b.dataset.open)));
$('#operationForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;if(!$('#userName').textContent){closeModal('modalBackdrop');setAuthMode('login');openModal('authBackdrop');toast('Сначала войди или зарегистрируйся');return;}const f=new FormData(form);const payload=Object.fromEntries(f.entries());payload.operationType=operationType;if(operationType==='withdraw'){payload.coin='USD';payload.network='Вывод с сайта';payload.wallet='—';}else if(payload.coin==='GRAM'){payload.network='TON';}$('#operationMessage').textContent='Отправляем заявку…';try{const d=await api('/api/sell',{method:'POST',body:JSON.stringify(payload)});$('#operationMessage').textContent='';form.reset();closeModal('modalBackdrop');toast(`Заявка №${d.id} отправлена`);refreshConfig();}catch(err){$('#operationMessage').textContent=err.message;}});

let authMode='login';
function setAuthMode(mode){authMode=mode;$$('.auth-tabs button').forEach(b=>b.classList.toggle('selected',b.dataset.auth===mode));$('#authTitle').textContent=mode==='login'?'Вход в аккаунт':'Создать аккаунт';$('#authSubmit').innerHTML=(mode==='login'?'Войти':'Зарегистрироваться')+' <span>↗</span>';$('#passwordHint').textContent=mode==='register'?'Для нового аккаунта пароль должен содержать не менее 10 символов.':'Используй пароль, указанный при регистрации.';$('#authForm [name="password"]').minLength=mode==='register'?10:4;$('#authMessage').textContent='';}
loginBtn.addEventListener('click',()=>{setAuthMode('login');openModal('authBackdrop')});$$('[data-auth]').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.auth)));
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);$('#authMessage').textContent='Проверяем данные…';try{await api(authMode==='login'?'/api/login':'/api/register',{method:'POST',body:JSON.stringify(Object.fromEntries(f.entries()))});closeModal('authBackdrop');await refreshUser();toast(authMode==='login'?'Ты вошёл в аккаунт':'Аккаунт создан');form.reset()}catch(err){$('#authMessage').textContent=err.message;}});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});await refreshUser();toast('Ты вышел из аккаунта')}catch{toast('Не удалось выйти')}});
async function showHistory(){openModal('historyBackdrop');const box=$('#historyContent');box.innerHTML='<div class="empty-state"><small>Загружаем историю…</small></div>';try{const rows=await api('/api/history');if(!rows.length){box.innerHTML='<div class="empty-state"><span>◷</span><b>Здесь пока пусто</b><small>Твои заявки появятся здесь после отправки.</small></div>';return;}box.innerHTML=rows.map(x=>`<div class="history-row"><div><b>${escapeHtml(x.coin||'Операция')}</b><small>${escapeHtml(x.network||'—')}</small></div><div><b>${escapeHtml(x.operation_type==='withdraw'?'Вывод':'Продажа')}</b><small>${escapeHtml(x.status||'pending')}</small></div><div><b>${formatDate(x.created_at)}</b><small>${x.amount?escapeHtml(x.amount)+' USD':'Заявка №'+x.id}</small></div></div>`).join('')}catch(err){box.innerHTML=`<div class="empty-state"><b>${escapeHtml(err.message)}</b></div>`}}
$('#historyBtn').addEventListener('click',showHistory);$('#historyCardBtn').addEventListener('click',showHistory);
[['modalClose','modalBackdrop'],['authClose','authBackdrop'],['historyClose','historyBackdrop']].forEach(([btn,id])=>$('#'+btn).addEventListener('click',()=>closeModal(id)));
$$('.modal-backdrop').forEach(b=>b.addEventListener('click',e=>{if(e.target===b)closeModal(b.id)}));document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-backdrop.open').forEach(m=>closeModal(m.id))});
$$('[data-placeholder]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();toast('Контакт или документ будет добавлен перед запуском сервиса.')}));
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function formatDate(v){if(!v)return '—';const d=new Date(v.replace(' ','T')+'Z');return isNaN(d)?escapeHtml(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}
