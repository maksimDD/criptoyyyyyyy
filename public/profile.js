const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtDate(v){ if(!v) return '—'; const d=new Date(String(v).replace(' ','T')+'Z'); return isNaN(d)?esc(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}); }

(async function(){
  try {
    const r = await fetch('/api/profile', { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/'; return; }
    const p = await r.json();
    if (!r.ok) throw new Error(p.error || 'Ошибка загрузки профиля');

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
    $('#p-tg-username').textContent = p.telegram_username ? '@' + p.telegram_username : 'Telegram не привязан';
    $('#p-tg-id').textContent = p.telegram_id || '—';
    $('#p-tg-name').textContent = [p.telegram_first_name, p.telegram_last_name].filter(Boolean).join(' ') || '—';
    $('#p-created').textContent = fmtDate(p.created_at);
    $('#p-sold').textContent = Number(p.sold_usd || 0).toFixed(2) + ' USD';
    $('#p-discount').textContent = Number(p.discount_percent || 0) > 0 ? p.discount_percent + '%' : 'нет';

    const coupons = p.coupons || [];
    $('#p-coupons').innerHTML = coupons.length
      ? coupons.map(c => `<div class="coupon"><b>${esc(c.percent)}%</b><span>Купон #${esc(c.id)} · получен ${fmtDate(c.created_at)}</span></div>`).join('')
      : '<p class="muted">Активных купонов нет</p>';
  } catch (e) {
    $('#p-error').textContent = e.message;
  }

  $('#p-logout').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    location.href = '/';
  });
})();
