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
    $('#p-public-id').textContent = '#' + (p.public_id || '—');
    $('#p-tg-username').textContent = p.telegram_username ? '@' + p.telegram_username : 'не привязан';
    
    const tgIdEl = $('#p-tg-id');
    if (tgIdEl) tgIdEl.textContent = p.telegram_id || '—';

    const tgStatus = $('#p-tg-status');
    if (tgStatus) {
      tgStatus.textContent = p.telegram_username ? '@' + p.telegram_username : 'не привязан';
      tgStatus.style.color = p.telegram_username ? '#5ce3a4' : '#8fa8b4';
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
      const config = await r.json();
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
            const d = await authRes.json();
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
