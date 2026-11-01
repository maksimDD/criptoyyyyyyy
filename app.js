const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const toast = (msg) => { const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.classList.remove('show'),3000); };
const openModal = id => { const el=$('#'+id); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; };
const closeModal = id => { const el=$('#'+id); el.classList.remove('open'); el.setAttribute('aria-hidden','true'); if (!$('.modal-backdrop.open')) document.body.style.overflow=''; };
$('#year').textContent = new Date().getFullYear();

$('#menuToggle').addEventListener('click',()=>$('#nav').classList.toggle('open'));
$$('.nav-link').forEach(a=>a.addEventListener('click',()=>{$$('.nav-link').forEach(x=>x.classList.remove('active'));a.classList.add('active');$('#nav').classList.remove('open')}));
const userChip=$('#userChip'), loginBtn=$('#loginBtn');
async function refreshUser(){try{const r=await fetch('/api/me');const d=await r.json();if(d.nickname){userChip.classList.remove('hidden');$('#userName').textContent=d.nickname;loginBtn.classList.add('hidden')}else{userChip.classList.add('hidden');loginBtn.classList.remove('hidden')}}catch{}}
refreshUser();

let operationType='sell';
const operationFields=$('#operationFields');
function field(label,name,placeholder,type='text',full=false){return `<label class="${full?'full':''}">${label}<input name="${name}" type="${type}" placeholder="${placeholder}" ${name==='coin'?'required':''} required></label>`}
function selectField(label,name,options,full=false){return `<label class="${full?'full':''}">${label}<select name="${name}" required>${options.map((x,i)=>`<option value="${x.value}" ${i===0?'selected':''}>${x.label}</option>`).join('')}</select></label>`}
function showOperation(type){
 operationType=type; $('#operationMessage').textContent='';
 const withdraw=type==='withdraw';
 $('#modalEyebrow').textContent=withdraw?'BLUP / ЗАПРОС НА ВЫВОД':'BLUP / ПРОДАЖА';
 $('#modalTitle').textContent=withdraw?'Запрос на вывод':'Продажа криптовалюты';
 $('#modalDesc').textContent=withdraw?'Заполни данные для отправки запроса на вывод.':'Заполни данные для оформления заявки на продажу.';
 operationFields.innerHTML=`
 ${field('Криптовалюта','coin','Например, USDT')}
 ${field(withdraw?'Сумма вывода':'Сеть / сеть перевода','network',withdraw?'Укажи сумму и валюту':'Например, TRC20')}
 ${field('Адрес кошелька','wallet','Адрес кошелька', 'text', true)}
 ${field('Телефон / контакт','phone','Номер для связи')}
 ${field('Банк / способ получения','bank','Укажи способ получения')}`;
 if(withdraw){const n=operationFields.querySelector('[name="network"]');n.placeholder='Сумма вывода';}
 openModal('modalBackdrop');
}
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>showOperation(b.dataset.open)));
$('#operationForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());
 if(operationType==='withdraw'){payload.network='Вывод с сайта';payload.bank=`${payload.bank} | Сумма вывода: ${f.get('network')}`;}
 $('#operationMessage').textContent='Отправляем заявку…';
 try{const r=await fetch('/api/sell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось отправить заявку');$('#operationMessage').textContent='';e.currentTarget.reset();closeModal('modalBackdrop');toast('Заявка отправлена. Спасибо!');}
 catch(err){$('#operationMessage').textContent=err.message; }
});

let authMode='login';
function setAuthMode(mode){authMode=mode;$$('.auth-tabs button').forEach(b=>b.classList.toggle('selected',b.dataset.auth===mode));$('#authTitle').textContent=mode==='login'?'Вход в аккаунт':'Создать аккаунт';$('#authSubmit').innerHTML=(mode==='login'?'Войти':'Зарегистрироваться')+' <span>↗</span>';$('#authMessage').textContent='';}
loginBtn.addEventListener('click',()=>{setAuthMode('login');openModal('authBackdrop')});
$$('[data-auth]').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.auth)));
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);$('#authMessage').textContent='Проверяем данные…';try{const r=await fetch(authMode==='login'?'/api/login':'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(f.entries()))});const d=await r.json();if(!r.ok)throw new Error(d.error||'Ошибка авторизации');closeModal('authBackdrop');await refreshUser();toast(authMode==='login'?'Ты вошёл в аккаунт':'Аккаунт создан');e.currentTarget.reset()}catch(err){$('#authMessage').textContent=err.message}});
$('#logoutBtn').addEventListener('click',async()=>{try{await fetch('/api/logout',{method:'POST'});await refreshUser();toast('Вы вышли из аккаунта')}catch{toast('Не удалось выйти')}});

async function showHistory(){openModal('historyBackdrop');const box=$('#historyContent');box.innerHTML='<div class="empty-state"><small>Загружаем историю…</small></div>';try{const r=await fetch('/api/history');const rows=await r.json();if(!rows.length){box.innerHTML='<div class="empty-state"><span>◷</span><b>Здесь пока пусто</b><small>Когда появятся заявки, они отобразятся в этом разделе.</small></div>';return;}box.innerHTML=rows.map(x=>`<div class="history-row"><div><b>${escapeHtml(x.coin||'Операция')}</b><small>${escapeHtml(x.network||'—')}</small></div><div><b>${escapeHtml(x.nickname||'Пользователь')}</b><small>Пользователь</small></div><div><b>${formatDate(x.created_at)}</b><small>Создана заявка</small></div></div>`).join('')}catch{box.innerHTML='<div class="empty-state"><b>Не удалось загрузить историю</b><small>Попробуй ещё раз позже.</small></div>'}}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function formatDate(v){if(!v)return '—';const d=new Date(v.replace(' ','T')+'Z');return isNaN(d)?escapeHtml(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}
$('#historyBtn').addEventListener('click',showHistory);$('#historyCardBtn').addEventListener('click',showHistory);
[['modalClose','modalBackdrop'],['authClose','authBackdrop'],['historyClose','historyBackdrop']].forEach(([btn,id])=>$('#'+btn).addEventListener('click',()=>closeModal(id)));
$$('.modal-backdrop').forEach(b=>b.addEventListener('click',e=>{if(e.target===b)closeModal(b.id)}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-backdrop.open').forEach(m=>closeModal(m.id))});
$$('[data-placeholder]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();toast('Контакт или документ будет добавлен перед запуском сервиса.')}));