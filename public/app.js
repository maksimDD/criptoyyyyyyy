const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const toast = msg => { const el=$('#toast'); if(!el)return; el.textContent=msg; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.classList.remove('show'),3200); };
const openModal = id => { const el=$('#'+id); if(!el)return; el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; };
const closeModal = id => { const el=$('#'+id); if(!el)return; el.classList.remove('open'); el.setAttribute('aria-hidden','true'); if (!$('.modal-backdrop.open')) document.body.style.overflow=''; };

if ($('#year')) $('#year').textContent = new Date().getFullYear();

if ($('#menuToggle')) {
  $('#menuToggle').addEventListener('click',()=>$('#nav').classList.toggle('open'));
}
$$('.nav-link').forEach(a=>a.addEventListener('click',()=>{$$('.nav-link').forEach(x=>x.classList.remove('active'));a.classList.add('active');$('#nav').classList.remove('open')}));

if ($('#promosNav')) {
  $('#promosNav').addEventListener('click',e=>{e.preventDefault();$('#nav').classList.remove('open');openModal('promoBackdrop');if($('#promoMessage'))$('#promoMessage').textContent='';});
}
if ($('#promoClose')) $('#promoClose').addEventListener('click',()=>closeModal('promoBackdrop'));

const userChip=$('#userChip'), loginBtn=$('#loginBtn');
let blockedNotified=false;

async function api(url, options={}) { const r=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Ошибка запроса'); return d; }

async function refreshUser(){
  try{
    const d=await api('/api/me');
    if(d.nickname){
      userChip.classList.remove('hidden');$('#userName').textContent=d.nickname;loginBtn.classList.add('hidden');
    }else{
      userChip.classList.add('hidden');loginBtn.classList.remove('hidden');
    }
  }catch(e){
    userChip.classList.add('hidden');loginBtn.classList.remove('hidden');
    if((e.message||'').includes('заблокирован')&&!blockedNotified){blockedNotified=true;toast(e.message)}
  }
}

async function refreshConfig(){
  try{
    const c=await api('/api/config');
    const money=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
    const dealRate=$('#dealRate');
    if(dealRate)dealRate.textContent=c.usdtRate>0?`| ${money(200*c.usdtRate)} ₽`:'| сумма в рублях';
    const usdtRateDisplay=$('#usdtRateDisplay'),gramRateDisplay=$('#gramRateDisplay');
    if(usdtRateDisplay)usdtRateDisplay.textContent=c.usdtRate>0?`${money(c.usdtRate)} ₽`:'не задан';
    if(gramRateDisplay)gramRateDisplay.textContent=c.gramRate>0?`${money(c.gramRate)} ₽`:'не задан';
    window.blupBanks=c.banks||[];window.blupWallets=c.wallets||{};window.blupRates={USDT:c.usdtRate,GRAM:c.gramRate};
  }catch{}
}
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
setInterval(refreshUser,15000);

// ==========================================
// ОПЕРАЦИИ (ПРОДАЖА)
// ==========================================
let operationType='sell';
const operationFields=$('#operationFields');
function labelInput(label,name,placeholder,type='text',full=false,required=true){return `<label class="${full?'full':''}">${label}<input name="${name}" type="${type}" placeholder="${placeholder}" ${required?'required':''} ${type==='number'?'min="0.01" step="0.01"':''}></label>`;}
function labelSelect(label,name,options,full=false){return `<label class="${full?'full':''}">${label}<select name="${name}" required>${options.map((x,i)=>`<option value="${escapeHtml(x.value)}" ${i===0?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}</select></label>`;}
function bankOptions(){const banks=window.blupBanks?.length?window.blupBanks:['Сбербанк','Т-Банк','ВТБ','Альфа-Банк','Газпромбанк'];return banks.map(b=>({value:b,label:`${bankIcon(b)}  ${b}`}));}
function bankIcon(name){const n=name.toLowerCase();if(n.includes('сбер'))return '🟢';if(n.includes('т-')||n.includes('тинь'))return '🟡';if(n.includes('втб'))return '🔵';if(n.includes('альфа'))return '🔴';if(n.includes('газпром'))return '💠';if(n.includes('озон'))return '🟣';return '🏦';}
function walletFor(coin,network){return window.blupWallets?.[coin]?.[network]||'';}
function walletPanel(coin,network){const address=walletFor(coin,network);return `<div class="wallet-panel full"><span>КОШЕЛЁК BLUP · ${escapeHtml(network)}</span><b>${escapeHtml(address||'Адрес не найден')}</b><button type="button" class="copy-wallet" data-copy-wallet="${escapeHtml(address)}">Копировать адрес</button></div>`;}

function renderOperationFields(){
 if(!operationFields) return;
 // TRC20 первый в списке!
 operationFields.innerHTML=`${labelSelect('Криптовалюта','coin',[{value:'USDT',label:'USDT — Tether'},{value:'GRAM',label:'GRAM'}])}<div id="networkField">${labelSelect('Сеть USDT','network',['TRC20','BEP20','ERC20','TON','SPL'].map(x=>({value:x,label:x})))}</div><div id="platformWallet">${walletPanel('USDT','TRC20')}</div>${labelInput('Сумма для продажи (USD)','amount','Например, 100','number',true)}<div id="rubPreview" class="field-note full">Итого к выплате: укажи сумму и курс</div><div id="discountOffer" class="field-note full hidden"></div>${labelSelect('Куда отправить выплату','payoutType',[{value:'phone',label:'На номер телефона (СБП)'},{value:'card',label:'На банковскую карту'}])}${labelInput('Номер телефона или карты','payoutValue','Без CVV и срока действия','text',true)}${labelSelect('Банк получателя','bank',bankOptions(),true)}${labelInput('Telegram username','telegramUsername','Например, @username','text',true)}${labelInput('Комментарий к продаже','comment','Комментарий (необязательно)','text',true,false)}<p class="field-note full">Проверь адрес и сеть, отправь криптовалюту на кошелёк BLUP. Укажи реквизиты для выплаты. После отправки заявки администратор проверит поступление и вручную отправит рубли. Не вводи CVV, PIN или SMS-коды.</p>`;
 const coin=operationFields.querySelector('[name="coin"]');
 function updateWallet(){const net=coin.value==='GRAM'?'TON':(operationFields.querySelector('[name="network"]')?.value||'TRC20');$('#platformWallet').innerHTML=walletPanel(coin.value,net);}
 // TRC20 первый в списке!
 function networkWrap(){const gram=coin.value==='GRAM';$('#networkField').innerHTML=gram?'<div class="static-field"><span>Сеть</span><b>TON</b></div>':labelSelect('Сеть USDT','network',['TRC20','BEP20','ERC20','TON','SPL'].map(x=>({value:x,label:x})));updateWallet();}
 coin.addEventListener('change',networkWrap);operationFields.addEventListener('change',e=>{if(e.target.name==='network')updateWallet();});
 const amountInput=operationFields.querySelector('[name="amount"]');amountInput.max='200';amountInput.placeholder='До 200 USD';let discountPercent=0;
 function updateRub(){const coinName=coin.value,rate=Number(window.blupRates?.[coinName]||0),amount=Number(amountInput.value||0);const base=amount*rate;const apply=!!operationFields.querySelector('#applyDiscount')?.checked;const total=base*(apply?1+discountPercent/100:1);$('#rubPreview').textContent=rate>0&&amount>0?`Курс: ${rate.toLocaleString('ru-RU')} ₽ за 1 ${coinName}. Итого к выплате: ${total.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽`:'Итого к выплате:';}
 amountInput.addEventListener('input',updateRub);coin.addEventListener('change',updateRub);
 
 // Скидка: берём максимум из постоянной (админ) и одноразовых купонов.
 if($('#userName').textContent){
   api('/api/profile').then(profile=>{
     const manual=Number(profile.discount_percent||0);
     const coupon=(profile.coupons||[]).reduce((m,c)=>Math.max(m,Number(c.percent)||0),0);
     discountPercent=Math.max(manual,coupon);
     if(discountPercent){
       const isCoupon=coupon>=manual&&coupon>0;
       $('#discountOffer').classList.remove('hidden');
       $('#discountOffer').innerHTML=`У тебя есть ${isCoupon?'одноразовый купон':'скидка'} <b>${discountPercent}%</b>. <label><input type="checkbox" id="applyDiscount"> Применить ${discountPercent}% к этой продаже${isCoupon?' (купон сгорит)':''}</label>`;
       $('#applyDiscount').addEventListener('change',updateRub);
     }
     updateRub();
   }).catch(updateRub);
 }else updateRub();
}

function showOperation(){
  operationType='sell';
  $('#operationMessage').textContent='';
  $('#modalEyebrow').textContent='BLUP / ПРОДАЖА';
  $('#modalTitle').textContent='Продажа криптовалюты';
  $('#modalDesc').textContent='Укажи сумму, выбери сеть, проверь кошелёк BLUP и заполни реквизиты для выплаты.';
  renderOperationFields();
  const sendBtn=$('#sendCryptoBtn');
  if(sendBtn)sendBtn.classList.remove('hidden');
  $('#operationSubmitBtn').textContent='ПОДАТЬ ЗАЯВКУ';
  openModal('modalBackdrop');
}
$$('[data-open="sell"]').forEach(b=>b.addEventListener('click',showOperation));

async function copyCurrentBlupWallet(){
  const coin=operationFields.querySelector('[name="coin"]')?.value||'USDT';
  const network=coin==='GRAM'?'TON':(operationFields.querySelector('[name="network"]')?.value||'TRC20');
  const address=walletFor(coin,network);
  if(!address){toast('Адрес кошелька не найден');return;}
  try{await navigator.clipboard.writeText(address);toast('Адрес BLUP скопирован. Отправь криптовалюту из своего кошелька.');}
  catch{toast('Не удалось скопировать. Нажми на адрес и скопируй его вручную.');}
}
if ($('#sendCryptoBtn')) $('#sendCryptoBtn').addEventListener('click',copyCurrentBlupWallet);

if (operationFields) {
  operationFields.addEventListener('click',e=>{
    const b=e.target.closest('[data-copy-wallet]');
    if(b&&b.dataset.copyWallet)navigator.clipboard?.writeText(b.dataset.copyWallet).then(()=>toast('Адрес скопирован')).catch(()=>toast('Не удалось скопировать адрес'));
  });
}

if ($('#operationForm')) {
  $('#operationForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    if(!$('#userName').textContent){
      closeModal('modalBackdrop');
      openModal('authBackdrop');
      toast('Сначала войди через Telegram');
      return;
    }
    const payload=Object.fromEntries(new FormData(form).entries());
    payload.applyDiscount=!!form.querySelector('#applyDiscount')?.checked;
    const endpoint='/api/sell';
    payload.coin=payload.coin||'USDT';
    payload.network=payload.coin==='GRAM'?'TON':payload.network;
    $('#operationMessage').textContent='Отправляем заявку…';
    try{
      const d=await api(endpoint,{method:'POST',body:JSON.stringify(payload)});
      $('#operationMessage').textContent='';
      form.reset();
      closeModal('modalBackdrop');
      toast(`Заявка №${d.id} отправлена`);
      refreshConfig();
    }catch(err){
      $('#operationMessage').textContent=err.message;
    }
  });
}

// ==========================================
// АВТОРИЗАЦИЯ И ИСТОРИЯ
// ==========================================
if (loginBtn) {
  loginBtn.addEventListener('click', () => { openModal('authBackdrop'); if($('#authMessage')) $('#authMessage').textContent=''; });
}

async function showHistory(){
  openModal('historyBackdrop');
  const box=$('#historyContent');
  box.innerHTML='<div class="empty-state"><small>Загружаем историю…</small></div>';
  try{
    const rows=await api('/api/history');
    if(!rows.length){
      box.innerHTML='<div class="empty-state"><span>◷</span><b>Здесь пока пусто</b><small>Твои заявки появятся здесь после отправки.</small></div>';
      return;
    }
    box.innerHTML=rows.map(x=>`<div class="history-row"><div><b>${escapeHtml(x.coin||'Операция')}</b><small>${escapeHtml(x.network||'—')}</small></div><div><b>${'Продажа'}</b><small>${escapeHtml(x.status||'pending')}</small></div><div><b>${formatDate(x.created_at)}</b><small>${x.amount?escapeHtml(x.amount)+' USD':'Заявка №'+x.id}</small></div></div>`).join('');
  }catch(err){
    box.innerHTML=`<div class="empty-state"><b>${escapeHtml(err.message)}</b></div>`;
  }
}
if ($('#historyBtn')) $('#historyBtn').addEventListener('click',showHistory);
if ($('#historyCardBtn')) $('#historyCardBtn').addEventListener('click',showHistory);

[['modalClose','modalBackdrop'],['authClose','authBackdrop'],['historyClose','historyBackdrop'],['promoClose','promoBackdrop'],['termsClose','termsBackdrop'],['privacyClose','privacyBackdrop'],['reviewsClose','reviewsBackdrop']].forEach(([btn,id])=>{
  if($('#'+btn)) $('#'+btn).addEventListener('click',()=>closeModal(id));
});

$$('.modal-backdrop').forEach(b=>b.addEventListener('click',e=>{if(e.target===b)closeModal(b.id)}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-backdrop.open').forEach(m=>closeModal(m.id))});
$$('[data-placeholder]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();toast('Контакт или документ будет добавлен перед запуском сервиса.')}));

// Открытие юридических модалок
if ($('#footerTerms')) $('#footerTerms').addEventListener('click', (e) => { e.preventDefault(); openModal('termsBackdrop'); });
if ($('#footerPrivacy')) $('#footerPrivacy').addEventListener('click', (e) => { e.preventDefault(); openModal('privacyBackdrop'); });

if ($('#promoApplyForm')) {
  $('#promoApplyForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const code=new FormData(e.currentTarget).get('code');
    try{
      const d=await api('/api/promos/apply',{method:'POST',body:JSON.stringify({code})});
      $('#promoMessage').textContent=`Промокод найден: ${d.promo.description||d.promo.code}. Условия уточняются у поддержки.`;
    }catch(err){
      $('#promoMessage').textContent=err.message;
    }
  });
}

if ($('#logoutBtn')) {
  $('#logoutBtn').addEventListener('click',async()=>{
    try{await api('/api/logout',{method:'POST'});await refreshUser();toast('Ты вышел из аккаунта')}
    catch{toast('Не удалось выйти')}
  });
}

function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function formatDate(v){if(!v)return '—';const d=new Date(v.replace(' ','T')+'Z');return isNaN(d)?escapeHtml(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}

// ==========================================
// ВХОД ЧЕРЕЗ TELEGRAM (ОДНА КНОПКА)
// ==========================================
const tgLoginBtn = $('#tgLoginBtn');
if (tgLoginBtn) {
  tgLoginBtn.addEventListener('click', async () => {
    const msgEl = $('#authMessage');
    if (msgEl) msgEl.textContent = 'Загрузка Telegram…';

    // Ждём появления объекта Telegram (до 5 секунд)
    let waited = 0;
    while ((!window.Telegram || !window.Telegram.Login) && waited < 5000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }

    if (!window.Telegram || !window.Telegram.Login || !window.Telegram.Login.auth) {
      if (msgEl) msgEl.textContent = 'Telegram не загрузился. Проверьте, не блокирует ли его AdBlock, и обновите страницу.';
      return;
    }

    if (msgEl) msgEl.textContent = '';

    try {
      const r = await fetch('/api/auth/telegram/config');
      const config = await r.json();
      if (!r.ok) throw new Error(config.error || 'Telegram-вход не настроен');

      window.Telegram.Login.auth(
        { bot_id: config.botId, request_access: 'write', lang: 'ru' },
        async (user) => {
          if (!user) { if (msgEl) msgEl.textContent = 'Вход отменён'; return; }
          try {
            const authRes = await fetch('/api/auth/telegram', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(user)
            });
            const d = await authRes.json().catch(() => ({}));
            if (!authRes.ok) throw new Error(d.error || 'Ошибка Telegram-входа');
            closeModal('authBackdrop');
            await refreshUser();
            toast('Вход через Telegram выполнен');
            location.href = '/profile';
          } catch (e) { if (msgEl) msgEl.textContent = e.message; }
        }
      );
    } catch (e) {
      if (msgEl) msgEl.textContent = e.message;
    }
  });
}

// Онлайн
async function refreshOnline() {
  try {
    const r = await fetch('/api/online');
    const d = await r.json();
    const countEl = $('#onlineCount');
    if (countEl) countEl.textContent = d.online; // Без принудительной 1
  } catch {}
}
refreshOnline();
setInterval(refreshOnline, 10000);

// ==========================================
// ЛОГИКА ВХОДА (ЛОГИН/ПАРОЛЬ И TG)
// ==========================================
let authMode = 'login';

const tabLogin = $('#tabLogin');
const tabRegister = $('#tabRegister');
const authForm = $('#authForm');

function setAuthMode(mode) {
  authMode = mode;
  if (tabLogin) tabLogin.classList.toggle('selected', mode === 'login');
  if (tabRegister) tabRegister.classList.toggle('selected', mode === 'register');
  if ($('#authTitle')) $('#authTitle').textContent = mode === 'login' ? 'Вход в аккаунт' : 'Создать аккаунт';
  if ($('#authSubmit')) $('#authSubmit').innerHTML = (mode === 'login' ? 'Войти' : 'Зарегистрироваться') + ' <span>↗</span>';
  if ($('#passwordHint')) $('#passwordHint').textContent = mode === 'register' ? 'Для нового аккаунта пароль должен быть не короче 10 символов.' : '';
  if ($('#authMessage')) $('#authMessage').textContent = '';
  if (authForm) authForm.querySelector('[name="password"]').minLength = mode === 'register' ? 10 : 4;
}

if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode('login'));
if (tabRegister) tabRegister.addEventListener('click', () => setAuthMode('register'));

if (authForm) {
  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if ($('#authMessage')) $('#authMessage').textContent = 'Проверяем данные…';
    try {
      const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
      await api(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(f.entries())) });
      closeModal('authBackdrop');
      await refreshUser();
      toast(authMode === 'login' ? 'Ты вошёл в аккаунт' : 'Аккаунт создан');
      form.reset();
    } catch (err) {
      if ($('#authMessage')) $('#authMessage').textContent = err.message;
    }
  });
}

// ==========================================
// ОТЗЫВЫ (МОДАЛКА)
// ==========================================
const reviewsNav = $('#reviewsNav');
if (reviewsNav) {
  reviewsNav.addEventListener('click', (e) => {
    e.preventDefault();
    $('#nav').classList.remove('open'); // Закрываем мобильное меню
    openModal('reviewsBackdrop');
    loadReviews();
  });
}

if ($('#reviewsClose')) {
  $('#reviewsClose').addEventListener('click', () => closeModal('reviewsBackdrop'));
}

async function loadReviews() {
  const container = $('#reviewsModalContent');
  if (!container) return;
  
  try {
    const res = await fetch('/api/reviews');
    const data = await res.json();
    
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color: #8fa5b5; text-align: center; padding: 20px;">Пока нет отзывов.</p>';
      return;
    }

    container.innerHTML = data.map(r => {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      return `
        <div class="review-card">
          <div class="review-header">
            <div>
              <b>${escapeHtml(r.nickname)}</b>
              ${r.amount ? `<small>Продал на ${Number(r.amount).toLocaleString('ru-RU')} ₽</small>` : ''}
            </div>
            <div class="review-stars">${stars}</div>
          </div>
          <p class="review-text">"${escapeHtml(r.text)}"</p>
          <div class="review-date">${new Date(r.created_at).toLocaleDateString('ru-RU')}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p style="color: #ff9aaf;">Ошибка загрузки отзывов.</p>';
  }
}
