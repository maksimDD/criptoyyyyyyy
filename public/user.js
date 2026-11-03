const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtDate(v){ if(!v) return '—'; const d=new Date(String(v).replace(' ','T')+'Z'); return isNaN(d)?esc(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}); }

// Достаем ID из URL: /user/123
const userId = window.location.pathname.split('/').pop();

(async function(){
  if (!userId || isNaN(userId)) {
    $('#p-error').textContent = 'Неверный ID пользователя';
    return;
  }

  try {
    const r = await fetch(`/api/user/${userId}`);
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      throw new Error(err.error || 'Ошибка загрузки профиля');
    }
    const p = await r.json();

    // Аватарка
    const img = $('#p-avatar');
    if (p.telegram_photo_url) {
      img.src = p.telegram_photo_url;
      img.onerror = () => { img.style.display='none'; $('#p-avatar-fallback').style.display='grid'; };
    } else {
      img.style.display='none';
      $('#p-avatar-fallback').style.display='grid';
      $('#p-avatar-fallback').textContent = (p.nickname || 'B').trim().slice(0,1).toUpperCase() || 'B';
    }

    // Данные
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
    
    // Скрываем кнопку привязки ТГ и кнопку выхода (это же просмотр, а не редактирование)
    const linkTgBtn = $('#linkTgBtn');
    if (linkTgBtn) linkTgBtn.style.display = 'none';
    
    const logoutBtn = $('#p-logout');
    if (logoutBtn) logoutBtn.style.display = 'none';
    
  } catch (e) {
    $('#p-error').textContent = e.message;
  }
})();
