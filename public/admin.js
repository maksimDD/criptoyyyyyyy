const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>{if(!v)return '—';const d=new Date(String(v).replace(' ','T')+'Z');return isNaN(d)?esc(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});};
function toast(s){const e=$('#adminToast');e.textContent=s;e.classList.add('show');clearTimeout(window.__at);window.__at=setTimeout(()=>e.classList.remove('show'),2800)}
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Ошибка');return d;}
function showDashboard(){ $('#adminLoginView').classList.add('hidden');$('#adminDashboard').classList.remove('hidden');$('#adminLogout').classList.remove('hidden');load(); }
async function check(){try{const d=await api('/api/admin/me');if(d.isAdmin)showDashboard()}catch{}}

$('#adminLoginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  $('#adminLoginError').textContent='Проверка…';
  try{
    const password=new FormData(form).get('password');
    await api('/api/admin/login',{method:'POST',body:JSON.stringify({password})});
    form.reset();
    showDashboard();
  }catch(err){
    $('#adminLoginError').textContent=err.message;
  }
});

$('#adminLogout').addEventListener('click',async()=>{
  try{await api('/api/admin/logout',{method:'POST'});location.reload();}catch(e){toast(e.message);}
});

$('#refreshAdmin').addEventListener('click',load);

$('#clearSales').addEventListener('click',async()=>{
 if(!confirm('Удалить все выполненные и отклонённые продажи? Продажи «Ожидает» и «В работе» останутся.'))return;
 try{const d=await api('/api/admin/sales',{method:'DELETE'});toast(`Удалено заявок: ${d.deleted}`);load();}
 catch(e){toast(e.message);}
});

async function load(){
  try{
    const d=await api('/api/admin/overview');
    const s=d.settings||{};
    
    $('#statUsers').textContent=d.stats.users;
    $('#statPending').textContent=d.stats.pending;
    $('#statBanned').textContent=d.stats.banned;
    $('#statReserve').textContent='$'+Number(s.reserve_available||0).toLocaleString('ru-RU');
    $('#statReserveTotal').textContent='из $'+Number(s.reserve_total||0).toLocaleString('ru-RU');
    
    const f=$('#settingsForm');
    f.usdtRate.value=s.usdt_rate||0;
    f.gramRate.value=s.gram_rate||0;
    f.reserveTotal.value=s.reserve_total||0;
    f.reserveAvailable.value=s.reserve_available||0;
    try{f.banks.value=JSON.parse(s.banks||'[]').join('\n')}catch{f.banks.value=''}
    
    const maintenance=$('#maintenanceToggle');
    if(maintenance)maintenance.checked=s.stopped==='1';
    const state=$('#serviceState');
    if(state){
      state.innerHTML=s.stopped==='1'?'<i></i> САЙТ НА ТЕХРАБОТАХ':'<i></i> СИСТЕМА АКТИВНА';
      state.classList.toggle('maintenance',s.stopped==='1');
    }

    $('#usersTable').innerHTML=d.users.length?d.users.map(u=>`
      <tr>
        <td><b>${esc(u.nickname)}</b><small>#${u.id} · ${date(u.created_at)}</small></td>
        <td>${esc(u.last_ip||'—')}</td>
        <td>${date(u.last_seen)}</td>
        <td><span class="status-pill ${u.is_banned?'banned':''}">${u.is_banned?'Заблокирован':'Активен'}</span></td>
        <td style="display:flex;gap:4px;">
          <button class="table-action ${u.is_banned?'':'danger'}" data-user="${u.id}" data-banned="${u.is_banned?0:1}">${u.is_banned?'Разблок.':'Блок'}</button>
          <button class="table-action danger" data-del-user="${u.id}" title="Удалить" style="background:#731f31;">✕</button>
        </td>
      </tr>
    `).join(''):'<tr><td colspan="5" class="empty-cell">Пользователей пока нет</td></tr>';

    $('#salesTable').innerHTML=d.sales.length?d.sales.map(x=>`
      <tr>
        <td><b>#${x.id} · ${esc(x.nickname||'—')}</b><small>${date(x.created_at)}</small></td>
        <td>${esc('Продажа')} · ${esc(x.coin)} · ${Number(x.amount||0)} USD${x.payout_rub?` / ${Number(x.payout_rub).toFixed(2)} RUB`:''}</td>
        <td><small>${esc(x.network||'—')} · ${esc(x.bank||'—')}</small><small>${esc(x.wallet||'—')}</small><small>Кошелёк BLUP: ${esc(x.destination_wallet||'—')}</small><small>${esc('Реквизиты выплаты')}: ${esc(x.phone||'—')}</small>${x.memo?`<small>MEMO: ${esc(x.memo)}</small>`:''}${x.comment?`<small>Комментарий: ${esc(x.comment)}</small>`:''}</td>
        <td>${date(x.created_at)}</td>
        <td><span class="status-pill ${x.status==='completed'?'completed':x.status==='rejected'?'rejected':''}">${esc(statusLabel(x.status))}</span></td>
        <td><select class="status-select" data-sale="${x.id}"><option value="pending" ${x.status==='pending'?'selected':''}>Ожидает</option><option value="processing" ${x.status==='processing'?'selected':''}>В работе</option><option value="completed" ${x.status==='completed'?'selected':''}>Выполнена</option><option value="rejected" ${x.status==='rejected'?'selected':''}>Отменена</option></select>${x.status==='rejected'?`<button class="table-action danger" data-delete-sale="${x.id}" style="margin-top:5px;background:#731f31">Удалить</button>`:''}</td>
      </tr>
    `).join(''):'<tr><td colspan="6" class="empty-cell">Продаж пока нет</td></tr>';

    const visitsHead = $('#visitsTable').closest('.admin-card-head');
    if (visitsHead && !visitsHead.querySelector('.clear-visits-btn')) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-small clear-visits-btn';
      btn.textContent = 'Очистить историю';
      btn.onclick = async () => {
        if(!confirm('Удалить всю историю входов?')) return;
        try { await api('/api/admin/visits', {method:'DELETE'}); toast('История очищена'); load(); } catch(e){ toast(e.message); }
      };
      visitsHead.appendChild(btn);
    }
    $('#visitsTable').innerHTML=(d.visits||[]).length?d.visits.map(v=>`
      <tr>
        <td><b>${esc(v.nickname||'—')}</b><small>#${v.user_id||'—'}</small></td>
        <td>${esc(v.event==='register'?'Регистрация':v.event==='login'?'Вход':v.event)}</td>
        <td>${esc(v.ip||'—')}</td>
        <td>${date(v.created_at)}</td>
      </tr>
    `).join(''):'<tr><td colspan="4" class="empty-cell">История входов пока пуста</td></tr>';

    $('#ipBanList').innerHTML=d.ipBans.length?d.ipBans.map(b=>`<div class="ban-item"><span><b>${esc(b.ip)}</b><small>${esc(b.reason||'Без причины')} · ${date(b.created_at)}</small></span><button data-unban="${esc(b.ip)}">Снять блокировку</button></div>`).join(''):'<div class="empty-cell">Заблокированных IP нет</div>';
    
    loadPromos();
  } catch(e){
    toast(e.message);
    if(e.message.includes('Доступ')) location.reload();
  }
}

function statusLabel(s){return ({pending:'Ожидает',processing:'В работе',completed:'Выполнена',rejected:'Отменена'})[s]||s}

$('#maintenanceToggle').addEventListener('change',async e=>{
  const toggle=e.currentTarget;
  toggle.disabled=true;
  $('#maintenanceMessage').textContent='Применяем…';
  try{
    await api('/api/admin/maintenance',{method:'POST',body:JSON.stringify({stopped:toggle.checked})});
    $('#maintenanceMessage').textContent=toggle.checked?'Сайт закрыт для посетителей.':'Сайт снова открыт.';
    load();
  }catch(err){
    toggle.checked=!toggle.checked;
    $('#maintenanceMessage').textContent=err.message;
  }finally{
    toggle.disabled=false;
  }
});

$('#settingsForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.currentTarget;
  const data={
    usdtRate:f.usdtRate.value,
    gramRate:f.gramRate.value,
    reserveTotal:f.reserveTotal.value,
    reserveAvailable:f.reserveAvailable.value,
    banks:f.banks.value.split('\n').map(x=>x.trim()).filter(Boolean),
  };
  $('#settingsMessage').textContent='Сохраняем…';
  try{
    await api('/api/admin/settings',{method:'POST',body:JSON.stringify(data)});
    $('#settingsMessage').textContent='Настройки сохранены.';
    toast('Настройки обновлены');
    load();
  }catch(err){
    $('#settingsMessage').textContent=err.message;
  }
});

$('#ipBanForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const f=new FormData(form);
  $('#ipBanMessage').textContent='';
  try{
    await api('/api/admin/ip-ban',{method:'POST',body:JSON.stringify({ip:f.get('ip'),reason:f.get('reason')})});
    form.reset();
    toast('IP заблокирован');
    load();
  }catch(err){
    $('#ipBanMessage').textContent=err.message;
  }
});

document.addEventListener('click',async e=>{
  const u=e.target.closest('[data-user]');
  if(u){
    const id=u.dataset.user,banned=u.dataset.banned==='1';
    const reason=banned?prompt('Причина блокировки (необязательно):')||'Нарушение правил':'';
    if(!confirm(banned?'Заблокировать аккаунт и последний IP?':'Разблокировать аккаунт?'))return;
    try{
      await api(`/api/admin/users/${id}/ban`,{method:'POST',body:JSON.stringify({banned,reason})});
      toast(banned?'Аккаунт заблокирован':'Аккаунт разблокирован');
      load();
    }catch(err){toast(err.message);}
  }

  const delBtn = e.target.closest('[data-del-user]');
  if (delBtn) {
    if (!confirm('Удалить этот аккаунт навсегда? Все его заявки останутся в базе, но доступ будет потерян.')) return;
    try {
      await api(`/api/admin/users/${delBtn.dataset.delUser}`, { method: 'DELETE' });
      toast('Аккаунт удален');
      load();
    } catch (err) { toast(err.message); }
  }

  const b=e.target.closest('[data-unban]');
  if(b){
    try{
      await api(`/api/admin/ip-ban/${encodeURIComponent(b.dataset.unban)}`,{method:'DELETE'});
      toast('IP разблокирован');
      load();
    }catch(err){toast(err.message);}
  }
});

document.addEventListener('change',async e=>{
  const s=e.target.closest('[data-sale]');
  if(!s)return;
  try{
    await api(`/api/admin/sales/${s.dataset.sale}/status`,{method:'POST',body:JSON.stringify({status:s.value})});
    toast('Статус заявки обновлён');
    load();
  }catch(err){toast(err.message);}
});

// Сворачиваемые секции админки: заголовок остаётся видимым.
function makeCollapsible(selector, label) {
  const card = document.querySelector(selector); if (!card) return;
  const head = card.querySelector('.admin-card-head'); if (!head || head.querySelector('.collapse-section-btn')) return;
  const btn = document.createElement('button'); btn.type='button'; btn.className='btn btn-ghost btn-small collapse-section-btn'; btn.textContent='Свернуть'; btn.setAttribute('aria-expanded','true');
  btn.addEventListener('click',()=>{ const collapsed=card.classList.toggle('section-collapsed'); btn.textContent=collapsed?'Развернуть':'Свернуть'; btn.setAttribute('aria-expanded',String(!collapsed)); });
  head.appendChild(btn);
}
makeCollapsible('section:has(#usersTable)', 'Аккаунты и доступ');
makeCollapsible('section:has(#salesTable)', 'Поток заявок');
makeCollapsible('section:has(#visitsTable)', 'История входов');

check();

async function loadPromos(){
  try{
    const rows=await api('/api/admin/promos');
    $('#promoAdminList').innerHTML=rows.map(x=>`
      <div class="ban-item">
        <span>
          <b><button type="button" class="promo-code-open" data-promo-details="${x.id}">${esc(x.code)}</button></b>
          <small>${esc(x.description||x.reward_type)} · активаций ${x.activation_count||0}${x.activation_limit?'/'+x.activation_limit:' / без лимита'} · ${x.active?'Активен':'Выключен'}</small>
          <small>Нажми на код, чтобы открыть список активаций и Telegram-профили пользователей</small>
        </span>
        <span style="display:flex;gap:6px;flex-wrap:wrap"><button data-promo-toggle="${x.id}">${x.active?'Отключить':'Включить'}</button><button data-promo-delete="${x.id}" style="background:#731f31;color:#fff">Удалить</button></span>
      </div>
    `).join('')||'<div class="empty-cell">Промокодов пока нет</div>';
  }catch(e){toast(e.message);}
}

document.addEventListener('click', async e => {
  const del = e.target.closest('[data-delete-sale]');
  if (del) {
    if (!confirm('Удалить эту отменённую заявку без возможности восстановления?')) return;
    try { await api(`/api/admin/sales/${del.dataset.deleteSale}`, {method:'DELETE'}); toast('Заявка удалена'); load(); } catch(err) { toast(err.message); }
    return;
  }
  const promo = e.target.closest('[data-promo-details]');
  if (promo) {
    try {
      const users = await api(`/api/admin/promos/${promo.dataset.promoDetails}/users`);
      let modal = document.getElementById('promoUsersModal');
      if (!modal) { modal = document.createElement('div'); modal.id='promoUsersModal'; modal.className='modal-backdrop open'; modal.innerHTML='<section class="modal history-modal" role="dialog" aria-modal="true"><button class="modal-close" type="button" data-close-promo>×</button><div class="modal-eyebrow">PROMO / ACTIVATIONS</div><h2>Активации промокода</h2><div id="promoUsersContent"></div></section>'; document.body.appendChild(modal); modal.addEventListener('click', ev=>{if(ev.target===modal||ev.target.closest('[data-close-promo]'))modal.remove();}); }
      const content = modal.querySelector('#promoUsersContent');
      content.innerHTML = users.length ? users.map(u=>`<div class="ban-item"><span style="display:flex;align-items:center;gap:10px">${u.telegram_photo_url?`<img src="${esc(u.telegram_photo_url)}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover">`:''}<span><b>${esc(u.nickname||'Удалённый пользователь')} · #${esc(u.public_id||'—')}</b><small>Telegram ID: ${esc(u.telegram_id||'—')} · ${u.telegram_username?'@'+esc(u.telegram_username):'username не указан'}</small><small>Активация: ${date(u.created_at)}</small>${u.public_id?`<small><a href="/user/${encodeURIComponent(u.public_id)}" target="_blank" rel="noopener">Открыть профиль пользователя ↗</a></small>`:''}</span></span></div>`).join('') : '<p class="empty-cell">Пока никто не активировал этот промокод.</p>';
    } catch(err) { toast(err.message); }
  }
});

$('#promoAdminForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  try{
    await api('/api/admin/promos',{method:'POST',body:JSON.stringify({
      code:f.get('code'),
      rewardType:'custom',
      targetText:f.get('targetText'),
      activationLimit:f.get('activationLimit'),
      description:f.get('targetText')
    })});
    e.currentTarget.reset();

    toast('Промокод создан');
    loadPromos();
  }catch(err){toast(err.message);}
});

$('#discountGrantForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  try{
    await api(`/api/admin/users/${f.get('userId')}/discount`,{method:'POST',body:JSON.stringify({percent:Number(f.get('percent'))})});
    toast('Скидка пользователя обновлена');
  }catch(err){toast(err.message);}
});

document.addEventListener('click',async e=>{
  const del=e.target.closest('[data-promo-delete]');
  if(del){if(!confirm('Полностью удалить промокод и связанные активации?'))return;try{await api(`/api/admin/promos/${del.dataset.promoDelete}`,{method:'DELETE'});toast('Промокод удалён');loadPromos()}catch(err){toast(err.message)}return;}
  const b=e.target.closest('[data-promo-toggle]');
  if(!b)return;
  try{
    await api(`/api/admin/promos/${b.dataset.promoToggle}/toggle`,{method:'POST',body:'{}'});
    loadPromos();
  }catch(err){toast(err.message);}
});

(function initBlupSelects() {
  const selects = document.querySelectorAll('.blup-select');
  if (!selects.length) return;

  selects.forEach((root) => {
    const trigger = root.querySelector('.blup-select-trigger');
    const menu = root.querySelector('.blup-select-menu');
    const labelEl = root.querySelector('.blup-select-label');
    const iconEl = root.querySelector('.blup-select-icon');
    const hidden = root.querySelector('input[type="hidden"]');
    const options = Array.from(menu.querySelectorAll('li'));

    function setValue(value) {
      const opt = options.find(o => o.dataset.value === value) || options[0];
      options.forEach(o => o.classList.toggle('is-selected', o === opt));
      if (labelEl) labelEl.textContent = opt.querySelector('.opt-text b').textContent;
      if (iconEl) iconEl.textContent = opt.dataset.icon || '';
      if (hidden) hidden.value = opt.dataset.value;
      root.dataset.value = opt.dataset.value;
    }

    function open() {
      root.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      const selected = menu.querySelector('li.is-selected');
      if (selected) {
        selected.classList.add('is-active');
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
    function close() {
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      menu.querySelectorAll('li.is-active').forEach(li => li.classList.remove('is-active'));
    }
    function toggle() {
      root.classList.contains('is-open') ? close() : open();
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.blup-select.is-open').forEach(s => {
        if (s !== root) {
          s.classList.remove('is-open');
          s.querySelector('.blup-select-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });
      toggle();
    });

    menu.addEventListener('click', (e) => {
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      setValue(li.dataset.value);
      close();
    });

    menu.addEventListener('mousemove', (e) => {
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      menu.querySelectorAll('li.is-active').forEach(x => x.classList.remove('is-active'));
      li.classList.add('is-active');
    });

    trigger.addEventListener('keydown', (e) => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        if (!root.classList.contains('is-open')) open();
        else {
          const active = menu.querySelector('li.is-active') || menu.querySelector('li.is-selected');
          if (!active) return;
          const idx = options.indexOf(active);
          let next = null;
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') next = options[(idx + 1) % options.length];
          if (e.key === 'ArrowUp') next = options[(idx - 1 + options.length) % options.length];
          if (next) {
            menu.querySelectorAll('li.is-active').forEach(x => x.classList.remove('is-active'));
            next.classList.add('is-active');
            next.scrollIntoView({ block: 'nearest' });
          }
        }
      }
      if (e.key === 'Escape') close();
    });

    setValue(root.dataset.value || (options[0] && options[0].dataset.value));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.blup-select')) {
      document.querySelectorAll('.blup-select.is-open').forEach(s => {
        s.classList.remove('is-open');
        s.querySelector('.blup-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.blup-select.is-open').forEach(s => {
        s.classList.remove('is-open');
        s.querySelector('.blup-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    }
  });
})();

// Рефералы в админке
document.getElementById('adminReferralsBtn')?.addEventListener('click', async () => {
  const modal = document.getElementById('adminRefBackdrop');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  
  try {
    const r = await api('/api/admin/referrals');
    document.getElementById('adminRefTable').innerHTML = r.map(x => `
      <tr>
        <td>${esc(x.nickname)} <small>#${x.public_id}</small></td>
        <td style="color:#5ce3a4;">$${Number(x.balance).toFixed(2)}</td>
        <td>${x.ref_count} чел.</td>
      </tr>
    `).join('') || '<tr><td colspan="3">Пусто</td></tr>';
  } catch (e) { toast(e.message); }
});

document.getElementById('adminRefClose')?.addEventListener('click', () => {
  const modal = document.getElementById('adminRefBackdrop');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
});

async function loadAdminReviews(){const rows=await api('/api/admin/reviews');$('#adminReviewsTable').innerHTML=rows.map(r=>`<tr><td>${esc(r.user_public_id)}<br><small>${esc(r.username)}</small></td><td>${Number(r.sale_amount).toFixed(2)}</td><td style="color:#ffd166">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</td><td style="white-space:normal">${esc(r.review_text)}</td><td><button class="btn btn-ghost btn-small" data-review-delete="${r.id}">Удалить</button></td></tr>`).join('')||'<tr><td colspan="5">Отзывов пока нет</td></tr>';}
$('#adminReviewsBtn')?.addEventListener('click',async()=>{ $('#adminReviewsBackdrop').classList.add('open');document.body.style.overflow='hidden';try{await loadAdminReviews()}catch(e){toast(e.message)}});
$('#adminReviewsClose')?.addEventListener('click',()=>{ $('#adminReviewsBackdrop').classList.remove('open');document.body.style.overflow='';});
$('#adminReviewForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/admin/reviews',{method:'POST',body:JSON.stringify({userId:f.get('userId'),username:f.get('username'),amount:Number(f.get('amount')),stars:Number(f.get('stars')),text:f.get('text')})});e.currentTarget.reset();$('#adminReviewMessage').textContent='Отзыв добавлен';await loadAdminReviews();}catch(err){$('#adminReviewMessage').textContent=err.message;}});
$('#adminReviewsTable')?.addEventListener('click',async e=>{const b=e.target.closest('[data-review-delete]');if(!b||!confirm('Удалить этот отзыв?'))return;try{await api('/api/admin/reviews/'+b.dataset.reviewDelete,{method:'DELETE'});await loadAdminReviews();}catch(err){toast(err.message)}});


// Tournament virtual-points administration
const bettingBackdrop=$('#adminBettingBackdrop');
$('#adminBettingBtn')?.addEventListener('click',async()=>{bettingBackdrop.classList.add('open');document.body.style.overflow='hidden';await loadTournamentAdmin();});
$('#adminBettingClose')?.addEventListener('click',()=>{bettingBackdrop.classList.remove('open');document.body.style.overflow='';});
bettingBackdrop?.addEventListener('click',e=>{if(e.target===bettingBackdrop){bettingBackdrop.classList.remove('open');document.body.style.overflow='';}});
$('#refreshBettingAdmin')?.addEventListener('click',loadTournamentAdmin);
$('#tPointsForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api('/api/admin/tournament-points',{method:'POST',body:JSON.stringify({publicId:f.get('publicId'),amount:Number(f.get('amount')),note:f.get('note')})});$('#tPointsMessage').textContent=`Начислено ${Number(f.get('amount'))} баллов пользователю ${d.user.nickname} (#${d.user.publicId}). Баланс: ${d.user.balance}`;e.currentTarget.reset();toast('Баллы начислены');}catch(err){$('#tPointsMessage').textContent=err.message;}});
$('#tMatchForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/admin/tournament-matches',{method:'POST',body:JSON.stringify({player1:f.get('player1'),player2:f.get('player2'),odds1:Number(f.get('odds1')),odds2:Number(f.get('odds2'))})});e.currentTarget.reset();toast('Матч опубликован');await loadTournamentAdmin();}catch(err){toast(err.message);}});
async function loadTournamentAdmin(){try{const d=await api('/api/admin/tournament-betting');$('#tMatchesAdmin').innerHTML=(d.matches||[]).map(m=>`<tr><td><b>${esc(m.player1)} — ${esc(m.player2)}</b><small>#${m.id}</small></td><td>${Number(m.odds1).toFixed(2)} / ${Number(m.odds2).toFixed(2)}</td><td>${m.predictions} / ${Number(m.points_total).toFixed(0)}</td><td>${esc(({open:'Открыт',closed:'Закрыт',settled:'Завершён',cancelled:'Отменён'})[m.status]||m.status)}</td><td style="min-width:220px"><button class="table-action" data-t-edit="${m.id}" data-p1="${esc(m.player1)}" data-p2="${esc(m.player2)}" data-o1="${m.odds1}" data-o2="${m.odds2}">Изменить</button> ${m.status==='open'?`<button class="table-action" data-t-action="close" data-id="${m.id}">Закрыть</button>`:''}${m.status==='closed'?`<button class="table-action" data-t-action="reopen" data-id="${m.id}">Открыть</button>`:''}${['open','closed'].includes(m.status)?`<button class="table-action danger" data-t-action="settle" data-id="${m.id}">Результат</button><button class="table-action danger" data-t-action="cancel" data-id="${m.id}">Отменить</button>`:''}<button class="table-action danger" data-t-action="delete" data-id="${m.id}">Удалить</button></td></tr>`).join('')||'<tr><td colspan="5">Матчей пока нет</td></tr>';
$('#tPredictionsAdmin').innerHTML=(d.predictions||[]).map(p=>`<tr><td>${esc(p.nickname||'—')} <small>#${esc(p.public_id||'—')}</small></td><td>${esc(p.player1)} — ${esc(p.player2)} <small>#${p.match_id}</small></td><td>${p.selection==='1'?esc(p.player1):esc(p.player2)}</td><td>${Number(p.amount).toFixed(0)}</td><td>${Number(p.odds).toFixed(2)}</td><td>${Number(p.payout||0).toFixed(2)}</td><td>${esc(({pending:'Ожидает',won:'Выиграл',lost:'Не угадал',refunded:'Возвращено'})[p.status]||p.status)}</td></tr>`).join('')||'<tr><td colspan="7">Прогнозов пока нет</td></tr>';
}catch(e){toast(e.message)}}
document.addEventListener('click',async e=>{const edit=e.target.closest('[data-t-edit]');if(edit){const id=edit.dataset.tEdit,p1=prompt('Игрок 1',edit.dataset.p1),p2=prompt('Игрок 2',edit.dataset.p2);if(p1===null||p2===null)return;const o1=prompt('Коэффициент игрока 1',edit.dataset.o1),o2=prompt('Коэффициент игрока 2',edit.dataset.o2);if(o1===null||o2===null)return;try{await api(`/api/admin/tournament-matches/${id}`,{method:'PATCH',body:JSON.stringify({player1:p1,player2:p2,odds1:Number(o1),odds2:Number(o2)})});toast('Матч обновлён');loadTournamentAdmin();}catch(err){toast(err.message)}return;}const action=e.target.closest('[data-t-action]');if(!action)return;const id=action.dataset.id,act=action.dataset.tAction;let body={action:act};if(act==='settle'){const winner=prompt('Кто победил? Введите 1 для первого ника или 2 для второго:');if(!['1','2'].includes(winner))return;body.winner=winner;}const confirmText=act==='delete'?'Удалить матч и все связанные прогнозы? Незавершённые виртуальные баллы будут возвращены пользователям. Действие необратимо.':act==='cancel'?'Отменить матч и вернуть виртуальные баллы всем участникам?':act==='settle'?'Зафиксировать результат матча?':act==='close'?'Закрыть приём прогнозов?':'Снова открыть матч?';if(!confirm(confirmText))return;try{await api(`/api/admin/tournament-matches/${id}`,{method:'PATCH',body:JSON.stringify(body)});toast(act==='delete'?'Матч удалён':'Матч обновлён');loadTournamentAdmin();}catch(err){toast(err.message)}});
