const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtDate(v){ if(!v) return '—'; const d=new Date(String(v).replace(' ','T')+'Z'); return isNaN(d)?esc(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}); }

// Глобальная переменная для хранения профиля
let currentProfile = null;

(async function(){
  try {
    const r = await fetch('/api/profile', { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/'; return; }
    const p = await r.json();
    if (!r.ok) throw new Error(p.error || 'Ошибка загрузки профиля');

    currentProfile = p; // Сохраняем профиль

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
    
    // Скрываем блок ID, если он есть в HTML (чтобы было аккуратно)
    const tgIdEl = $('#p-tg-id');
    if (tgIdEl) tgIdEl.textContent = p.telegram_id || '—';

    const tgNameEl = $('#p-tg-name');
    if (tgNameEl) tgNameEl.textContent = [p.telegram_first_name, p.telegram_last_name].filter(Boolean).join(' ') || '—';

    $('#p-created').textContent = fmtDate(p.created_at);
    $('#p-sold').textContent = Number(p.sold_usd || 0).toFixed(2) + ' USD';
    $('#p-discount').textContent = Number(p.discount_percent || 0) > 0 ? p.discount_percent + '%' : 'нет';

    const coupons = p.coupons || [];
    $('#p-coupons').innerHTML = coupons.length
      ? coupons.map(c => `<div class="coupon"><b>${esc(c.percent)}%</b><span>Купон #${esc(c.id)} · получен ${fmtDate(c.created_at)}</span></div>`).join('')
      : '<p class="muted">Активных купонов нет</p>';
      
    // Инициализируем кнопку привязки ТГ после загрузки профиля
    initLinkTelegram();
  } catch (e) {
    $('#p-error').textContent = e.message;
  }

  $('#p-logout').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    location.href = '/';
  });
})();

// ==========================================
// ПРИВЯЗКА TELEGRAM В ПРОФИЛЕ
// ==========================================
function initLinkTelegram() {
  const linkTgBtn = $('#linkTgBtn');
  if (!linkTgBtn) return;

  // Если Telegram уже привязан, скрываем кнопку
  if (currentProfile && currentProfile.telegram_id) {
    linkTgBtn.style.display = 'none';
    return;
  }

  linkTgBtn.addEventListener('click', async () => {
    linkTgBtn.textContent = 'Загрузка Telegram…';
    linkTgBtn.disabled = true;

    // Ждём загрузки скрипта Telegram (до 5 секунд)
    let waited = 0;
    while ((!window.Telegram || !window.Telegram.Login) && waited < 5000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }

    if (!window.Telegram || !window.Telegram.Login || !window.Telegram.Login.auth) {
      alert('Telegram не загрузился. Проверьте интернет или отключите AdBlock, затем обновите страницу.');
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
            if (!authRes.ok) throw new Error(d.error || 'Ошибка привязки');
            
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
