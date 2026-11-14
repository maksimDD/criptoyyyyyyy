async function readProfileApiJson(response, label='API') {
  const type = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!type.includes('application/json')) {
    if (/<!doctype html|<html/i.test(raw)) throw new Error(`${label}: сервер вернул HTML вместо JSON. Backend на Amvera, вероятно, не обновлён или API-маршрут недоступен.`);
    throw new Error(`${label}: неожиданный формат ответа.`);
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error(`${label}: некорректный JSON.`); }
}
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtDate(v){ if(!v) return '—'; const d=new Date(String(v).replace(' ','T')+'Z'); return isNaN(d)?esc(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}); }

let currentProfile = null;

// 1. Загрузка профиля
(async function(){
  try {
    const r = await fetch('/api/profile', { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/'; return; }
    const p = await r.json();
    if (!r.ok) throw new Error(p.error || 'Ошибка');

    currentProfile = p;

    const img = $('#p-avatar');
    if (p.telegram_photo_url) {
      img.src = p.telegram_photo_url;
      img.onerror = () => { img.style.display='none'; $('#p-avatar-fallback').style.display='grid'; };
    } else {
      img.style.display='none';
      $('#p-avatar-fallback').style.display='grid';
      $('#p-avatar-fallback').textContent = (p.nickname || 'B').trim().slice(0,1).toUpperCase() || 'B';
    }

    $('#p-nick').textContent = p.nickname || '—';
    const tradeInput = $('#steamTradeUrl'); if (tradeInput) tradeInput.value = p.steam_trade_url || '';
    const publicId = p.public_id || '—';
    const publicLink = $('#p-user-link');
    if (publicLink) {
      publicLink.textContent = `ID пользователя: ${publicId}`;
      publicLink.href = publicId !== '—' ? `/user/${encodeURIComponent(publicId)}` : '#';
      publicLink.title = publicId !== '—' ? 'Открыть публичный профиль' : 'Публичный профиль недоступен';
      publicLink.style.pointerEvents = publicId !== '—' ? 'auto' : 'none';
    }
    const validTgUsername = /^[a-zA-Z0-9_]{5,32}$/.test(String(p.telegram_username || ''));
    
    const tgIdEl = $('#p-tg-id');
    if (tgIdEl) tgIdEl.textContent = p.telegram_id || '—';

    const tgStatus = $('#p-tg-status');
    if (tgStatus) {
      tgStatus.textContent = validTgUsername ? '@' + p.telegram_username : 'не привязан';
      tgStatus.style.color = validTgUsername ? '#5ce3a4' : '#8fa8b4';
    }

    $('#p-created').textContent = fmtDate(p.created_at);
    $('#p-sold').textContent = Number(p.sold_usd || 0).toFixed(2) + ' USD';
    $('#p-discount').textContent = Number(p.discount_percent || 0) > 0 ? p.discount_percent + '%' : 'нет';

    const coupons = p.coupons || [];
    $('#p-coupons').innerHTML = coupons.length
      ? coupons.map(c => `<div class="coupon"><b>${esc(c.percent)}%</b><span>Купон #${esc(c.id)} · получен ${fmtDate(c.created_at)}</span></div>`).join('')
      : '<p class="muted">Активных купонов нет</p>';
      
    initLinkTelegram();
    initReferralSystem(); // Вызываем после загрузки профиля
    initProfilePromoForm();
  } catch (e) {
    $('#p-error').textContent = e.message;
  }

  $('#p-logout').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    location.href = '/';
  });
})();

// 2. Привязка Telegram
function initLinkTelegram() {
  const linkTgBtn = $('#linkTgBtn');
  if (!linkTgBtn) return;

  if (currentProfile && currentProfile.is_telegram) {
    linkTgBtn.style.display = 'none';
    return;
  }

  linkTgBtn.addEventListener('click', async () => {
    linkTgBtn.textContent = 'Загрузка Telegram…';
    linkTgBtn.disabled = true;

    let waited = 0;
    while ((!window.Telegram || !window.Telegram.Login) && waited < 5000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }

    if (!window.Telegram || !window.Telegram.Login || !window.Telegram.Login.auth) {
      alert('Telegram не загрузился. Проверьте интернет или AdBlock.');
      linkTgBtn.textContent = 'Привязать Telegram';
      linkTgBtn.disabled = false;
      return;
    }

    try {
      const r = await fetch('/api/auth/telegram/config');
      const config = await readProfileApiJson(r, 'Настройки Telegram');
      if (!r.ok) throw new Error(config.error || 'Telegram-вход не настроен');

      window.Telegram.Login.auth(
        { bot_id: config.botId, request_access: 'write', lang: 'ru' },
        async (user) => {
          if (!user) {
            linkTgBtn.textContent = 'Привязать Telegram';
            linkTgBtn.disabled = false;
            return;
          }
          try {
            const authRes = await fetch('/api/auth/link-telegram', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(user)
            });
            const d = await readProfileApiJson(authRes, 'Привязка Telegram');
            if (!authRes.ok) throw new Error(d.error || 'Ошибка');
            alert('Telegram успешно привязан!');
            location.reload();
          } catch (e) { 
            alert(e.message); 
            linkTgBtn.textContent = 'Привязать Telegram';
            linkTgBtn.disabled = false;
          }
        }
      );
    } catch (e) { 
      alert(e.message); 
      linkTgBtn.textContent = 'Привязать Telegram';
      linkTgBtn.disabled = false;
    }
  });
}

// 3. Реферальная система
function initReferralSystem() {
  const refBtn = $('#openRefBtn');
  const refClose = $('#refClose');
  const refBackdrop = $('#refBackdrop');

  if (refBtn) {
    refBtn.addEventListener('click', async () => {
      refBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      await loadReferralData();
    });
  }

  if (refClose) {
    refClose.addEventListener('click', () => {
      refBackdrop.classList.remove('open');
      document.body.style.overflow = '';
    });
  }

  if (refBackdrop) {
    refBackdrop.addEventListener('click', (e) => {
      if (e.target === refBackdrop) {
        refBackdrop.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  }

  $('#saveRefCodeBtn')?.addEventListener('click', async () => {
    const code = $('#refCodeInput').value.trim();
    if (!code) return alert('Введите код');
    try {
      const r = await fetch('/api/referral/set-code', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      alert('Код сохранен!');
      loadReferralData();
    } catch (e) { alert(e.message); }
  });

  $('#refWithdrawBtn')?.addEventListener('click', async () => {
    const amount = Number($('#refWithdrawAmount').value);
    const phone = $('#refWithdrawPhone').value;
    const bank = $('#refWithdrawBank').value;

    if (!amount || amount < 10) return alert('Мин. сумма $10');
    if (!phone || !bank) return alert('Введите реквизиты');

    try {
      const r = await fetch('/api/referral/withdraw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount, phone, bank }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      alert('Заявка на вывод создана!');
      loadReferralData();
    } catch (e) { alert(e.message); }
  });
}

async function loadReferralData() {
  try {
    const r = await fetch('/api/referral');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);

    $('#refBalance').innerText = `$${Number(d.balance || 0).toFixed(2)}`;
    
    const code = d.ref_code || '';
    $('#refCodeInput').value = code;
    $('#refLinkDisplay').innerText = code ? `https://blup-bluup.msk1.amvera.tech/ref/${code}` : 'Код не создан';

    const list = $('#refList');
    if (d.referrals.length === 0) {
      list.innerHTML = '<p style="color:#8fa5b5; font-size:11px;">У тебя пока нет рефералов.</p>';
    } else {
      list.innerHTML = d.referrals.map(ref => `
        <div style="display:flex; flex-direction:column; gap:5px; background:#0c1026; padding:10px; border-radius:8px; font-size:12px; margin-bottom:7px;">
          <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(ref.nickname)} <small style="color:#8fa5b5;">#${esc(ref.public_id)}</small></b><span style="color:#8fa5b5;">${new Date(ref.created_at).toLocaleDateString('ru-RU')}</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;color:#9eb4c8"><span>Продал: $${Number(ref.sold_usd||0).toFixed(2)} · ${Number(ref.sold_rub||0).toFixed(2)} ₽</span><b style="color:#5ce3a4">Твой доход: ${Number(ref.earned_rub||0).toFixed(2)} ₽</b></div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error(e);
  }
}


function initProfilePromoForm() {
  const form = document.getElementById('profilePromoApplyForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('profilePromoMessage');
    const code = new FormData(form).get('code');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    message.textContent = 'Проверяем промокод…';
    try {
      const response = await fetch('/api/promos/apply', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}) });
      const data = await readProfileApiJson(response, 'Промокод');
      if (!response.ok) throw new Error(data.error || 'Не удалось применить промокод');
      message.textContent = `Промокод найден: ${data.promo?.description || data.promo?.code || code}. Условия уточняются у поддержки.`;
      form.reset();
    } catch (error) { message.textContent = error.message; }
    finally { submit.disabled = false; }
  });
}


// Steam Trade URL для получения предметов из инвентаря BLUP.
$('#steamTradeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#steamTradeUrl'), message = $('#steamTradeMessage');
  const url = input.value.trim(); message.textContent = 'Сохраняем…';
  try {
    const r = await fetch('/api/profile/steam-trade', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const d = await readProfileApiJson(r, 'Steam Trade URL');
    if (!r.ok) throw new Error(d.error || 'Не удалось сохранить ссылку');
    input.value = d.url; message.textContent = 'Ссылка обмена сохранена.';
  } catch (err) { message.textContent = err.message; }
});


// Inventory visible from /cases/profile as well as the regular profile page.
async function loadCasesInventory(){
  const grid=$('#casesInventoryGrid'); if(!grid)return;
  try{
    const [inv,art]=await Promise.all([
      fetch('/api/cases/inventory',{credentials:'same-origin'}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Не удалось загрузить инвентарь');return d}),
      fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json').then(r=>r.ok?r.json():[]).catch(()=>[])
    ]);
    const images={};for(const x of art)if(x.name&&x.image)images[x.name]=x.image;
    if(!inv.items?.length){grid.innerHTML='<p class="muted">Пока нет скинов. Открой кейс, чтобы получить первый предмет.</p>';return;}
    grid.innerHTML=inv.items.map(x=>`<article class="profile-skin"><img loading="lazy" src="${esc(images[x.skin_name]||'')}" alt="${esc(x.skin_name)}"><b>${esc(x.skin_name)}</b><span>$${Number(x.price).toFixed(2)} · продажа $${(Number(x.price)*.9).toFixed(2)}</span><div class="profile-skin-actions"><button data-profile-sell="${x.id}">Продать за $${(Number(x.price)*.9).toFixed(2)}</button><button data-profile-withdraw="${x.id}" ${x.withdrawal_pending?'disabled':''}>${x.withdrawal_pending?'Заявка отправлена':'Вывести в Steam'}</button></div></article>`).join('');
    grid.querySelectorAll('[data-profile-sell]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Продать скин за 90% от указанной рыночной цены?'))return;try{const r=await fetch(`/api/cases/inventory/${btn.dataset.profileSell}/sell`,{method:'POST',credentials:'same-origin'});const d=await readProfileApiJson(r,'Продажа скина');if(!r.ok)throw new Error(d.error||'Ошибка');alert(`Скин продан. На игровой баланс начислено $${Number(d.credited).toFixed(2)}.`);loadCasesInventory()}catch(e){alert(e.message)}}));
    grid.querySelectorAll('[data-profile-withdraw]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Создать заявку на вывод этого скина в Steam?'))return;try{const r=await fetch(`/api/cases/inventory/${btn.dataset.profileWithdraw}/withdraw`,{method:'POST',credentials:'same-origin'});const d=await readProfileApiJson(r,'Вывод скина');if(!r.ok)throw new Error(d.error||'Ошибка');alert(`Заявка №${d.id} создана. Отправка Steam-трейда будет выполнена администратором.`);loadCasesInventory()}catch(e){alert(e.message);if(e.message.includes('Trade URL'))$('#steamTradeCard')?.scrollIntoView({behavior:'smooth'})}}));
  }catch(e){grid.innerHTML=`<p class="muted">${esc(e.message)}</p>`;}
}
loadCasesInventory();
