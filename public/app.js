const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const toast = msg => { const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.classList.remove('show'),3200); };
const openModal = id => { const el=$('#'+id); el.classList.add('open'); el.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; };
const closeModal = id => { const el=$('#'+id); el.classList.remove('open'); el.setAttribute('aria-hidden','true'); if (!$('.modal-backdrop.open')) document.body.style.overflow=''; };
$('#year').textContent = new Date().getFullYear();
$('#menuToggle').addEventListener('click',()=>$('#nav').classList.toggle('open'));
$$('.nav-link').forEach(a=>a.addEventListener('click',()=>{$$('.nav-link').forEach(x=>x.classList.remove('active'));a.classList.add('active');$('#nav').classList.remove('open')}));
$('#promosNav').addEventListener('click',e=>{e.preventDefault();$('#nav').classList.remove('open');openModal('promoBackdrop');$('#promoMessage').textContent='';});
$('#promoClose').addEventListener('click',()=>closeModal('promoBackdrop'));
const userChip=$('#userChip'), loginBtn=$('#loginBtn');
let blockedNotified=false;
async function api(url, options={}) { const r=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Ошибка запроса'); return d; }
async function refreshUser(){try{const d=await api('/api/me');if(d.nickname){userChip.classList.remove('hidden');$('#userName').textContent=d.nickname;loginBtn.classList.add('hidden')}else{userChip.classList.add('hidden');loginBtn.classList.remove('hidden')}}catch(e){userChip.classList.add('hidden');loginBtn.classList.remove('hidden');if((e.message||'').includes('заблокирован')&&!blockedNotified){blockedNotified=true;toast(e.message)}}}
async function refreshConfig(){try{const c=await api('/api/config');const money=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2});const dealRate=$('#dealRate');if(dealRate)dealRate.textContent=c.usdtRate>0?`| ${money(200*c.usdtRate)} ₽`:'| сумма в рублях';const usdtRateDisplay=$('#usdtRateDisplay'),gramRateDisplay=$('#gramRateDisplay');if(usdtRateDisplay)usdtRateDisplay.textContent=c.usdtRate>0?`${money(c.usdtRate)} ₽`:'не задан';if(gramRateDisplay)gramRateDisplay.textContent=c.gramRate>0?`${money(c.gramRate)} ₽`:'не задан';window.blupBanks=c.banks||[];window.blupWallets=c.wallets||{};window.blupRates={USDT:c.usdtRate,GRAM:c.gramRate};}catch{}}
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
function walletFor(coin,network){return window.blupWallets?.[coin]?.[network]||'';}
function walletPanel(coin,network){const address=walletFor(coin,network);return `<div class="wallet-panel full"><span>КОШЕЛЁК BLUP · ${escapeHtml(network)}</span><b>${escapeHtml(address||'Адрес не найден')}</b><button type="button" class="copy-wallet" data-copy-wallet="${escapeHtml(address)}">Копировать адрес</button></div>`;}
function renderOperationFields(){
 operationFields.innerHTML=`${labelSelect('Криптовалюта','coin',[{value:'USDT',label:'USDT — Tether'},{value:'GRAM',label:'GRAM'}])}<div id="networkField">${labelSelect('Сеть USDT','network',['BEP20','TRC20','ERC20','TON','SPL'].map(x=>({value:x,label:x})))}</div><div id="platformWallet">${walletPanel('USDT','BEP20')}</div>${labelInput('Сумма для продажи (USD)','amount','Например, 100','number',true)}<div id="rubPreview" class="field-note full">Итого к выплате: укажи сумму и курс</div><div id="discountOffer" class="field-note full hidden"></div>${labelSelect('Куда отправить выплату','payoutType',[{value:'phone',label:'На номер телефона (СБП)'},{value:'card',label:'На банковскую карту'}])}${labelInput('Номер телефона или карты','payoutValue','Без CVV и срока действия','text',true)}${labelSelect('Банк получателя','bank',bankOptions(),true)}${labelInput('Telegram username','telegramUsername','Например, @username','text',true)}${labelInput('Комментарий к продаже','comment','Комментарий (необязательно)','text',true,false)}<p class="field-note full">Проверь адрес и сеть, отправь криптовалюту на кошелёк BLUP. Укажи реквизиты для выплаты. После отправки заявки администратор проверит поступление и вручную отправит рубли. Не вводи CVV, PIN или SMS-коды.</p>`;
 const coin=operationFields.querySelector('[name="coin"]');
 function updateWallet(){const net=coin.value==='GRAM'?'TON':(operationFields.querySelector('[name="network"]')?.value||'BEP20');$('#platformWallet').innerHTML=walletPanel(coin.value,net);}
 function networkWrap(){const gram=coin.value==='GRAM';$('#networkField').innerHTML=gram?'<div class="static-field"><span>Сеть</span><b>TON</b></div>':labelSelect('Сеть USDT','network',['BEP20','TRC20','ERC20','TON','SPL'].map(x=>({value:x,label:x})));updateWallet();}
 coin.addEventListener('change',networkWrap);operationFields.addEventListener('change',e=>{if(e.target.name==='network')updateWallet();});
 const amountInput=operationFields.querySelector('[name="amount"]');amountInput.max='200';amountInput.placeholder='До 200 USD';let discountPercent=0;
 function updateRub(){const coinName=coin.value,rate=Number(window.blupRates?.[coinName]||0),amount=Number(amountInput.value||0);const base=amount*rate;const apply=!!operationFields.querySelector('#applyDiscount')?.checked;const total=base*(apply?1+discountPercent/100:1);$('#rubPreview').textContent=rate>0&&amount>0?`Курс: ${rate.toLocaleString('ru-RU')} ₽ за 1 ${coinName}. Итого к выплате: ${total.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽`:'Итого к выплате:';}
 amountInput.addEventListener('input',updateRub);coin.addEventListener('change',updateRub);
 // Скидка: берём максимум из постоянной (админ) и одноразовых купонов.
 if($('#userName').textContent){api('/api/profile').then(profile=>{
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
 }).catch(updateRub);}else updateRub();
}

function showOperation(){operationType='sell';$('#operationMessage').textContent='';$('#modalEyebrow').textContent='BLUP / ПРОДАЖА';$('#modalTitle').textContent='Продажа криптовалюты';$('#modalDesc').textContent='Укажи сумму, выбери сеть, проверь кошелёк BLUP и заполни реквизиты для выплаты.';renderOperationFields();const sendBtn=$('#sendCryptoBtn');if(sendBtn)sendBtn.classList.remove('hidden');$('#operationSubmitBtn').textContent='ПОДАТЬ ЗАЯВКУ';openModal('modalBackdrop');}
$$('[data-open="sell"]').forEach(b=>b.addEventListener('click',showOperation));
async function copyCurrentBlupWallet(){const coin=operationFields.querySelector('[name="coin"]')?.value||'USDT';const network=coin==='GRAM'?'TON':(operationFields.querySelector('[name="network"]')?.value||'BEP20');const address=walletFor(coin,network);if(!address){toast('Адрес кошелька не найден');return;}try{await navigator.clipboard.writeText(address);toast('Адрес BLUP скопирован. Отправь криптовалюту из своего кошелька.');}catch{toast('Не удалось скопировать. Нажми на адрес и скопируй его вручную.');}}
$('#sendCryptoBtn').addEventListener('click',copyCurrentBlupWallet);
operationFields.addEventListener('click',e=>{const b=e.target.closest('[data-copy-wallet]');if(b&&b.dataset.copyWallet)navigator.clipboard?.writeText(b.dataset.copyWallet).then(()=>toast('Адрес скопирован')).catch(()=>toast('Не удалось скопировать адрес'));});
$('#operationForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;if(!$('#userName').textContent){closeModal('modalBackdrop');setAuthMode('login');openModal('authBackdrop');toast('Сначала войди или зарегистрируйся');return;}const payload=Object.fromEntries(new FormData(form).entries());payload.applyDiscount=!!form.querySelector('#applyDiscount')?.checked;const endpoint='/api/sell';payload.coin=payload.coin||'USDT';payload.network=payload.coin==='GRAM'?'TON':payload.network;$('#operationMessage').textContent='Отправляем заявку…';try{const d=await api(endpoint,{method:'POST',body:JSON.stringify(payload)});$('#operationMessage').textContent='';form.reset();closeModal('modalBackdrop');toast(`Заявка №${d.id} отправлена`);refreshConfig();}catch(err){$('#operationMessage').textContent=err.message;}});

let authMode='login';
const tgLoginBtn = $('#tgLoginBtn');
let tgBotUsername = null;

async function ensureTgConfig() {
  if (tgBotUsername) return tgBotUsername;
  const r = await fetch('/api/auth/telegram/config');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Telegram-вход не настроен');
  tgBotUsername = d.botUsername;
  return tgBotUsername;
}

loginBtn.addEventListener('click', () => { openModal('authBackdrop'); $('#authMessage').textContent=''; });

tgLoginBtn?.addEventListener('click', async () => {
  $('#authMessage').textContent = '';
  try {
    const bot = await ensureTgConfig();
    if (!window.Telegram || !window.Telegram.Login || !window.Telegram.Login.auth) {
      throw new Error('Telegram-виджет ещё не загрузился. Обнови страницу.');
    }
    window.Telegram.Login.auth(
      { bot_id: bot, request_access: 'write', lang: 'ru' },
      async (user) => {
        if (!user) { $('#authMessage').textContent = 'Вход отменён'; return; }
        try {
          const r = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(user)
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || 'Ошибка Telegram-входа');
          closeModal('authBackdrop');
          await refreshUser();
          toast('Вход через Telegram выполнен');
          location.href = '/profile';
        } catch (e) { $('#authMessage').textContent = e.message; }
      }
    );
  } catch (e) {
    $('#authMessage').textContent = e.message;
  }
});

// Telegram Login Widget callback
window.onTelegramAuth = async function(user) {
  try {
    const r = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(user)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Ошибка Telegram-входа');
    closeModal('authBackdrop');
    await refreshUser();
    toast('Вход через Telegram выполнен');
    // После входа TG — предлагаем перейти в профиль
    if (confirm('Вход выполнен. Перейти в профиль?')) location.href = '/profile';
  } catch (e) {
    toast(e.message);
  }
};
