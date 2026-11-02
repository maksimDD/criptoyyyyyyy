/* ===== BLUP custom select (admin) ===== */
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
      // Закрываем другие открытые селекты
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

    // Клавиатура
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

    // Начальное значение
    setValue(root.dataset.value || (options[0] && options[0].dataset.value));
  });

  // Клик вне — закрыть все
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.blup-select')) {
      document.querySelectorAll('.blup-select.is-open').forEach(s => {
        s.classList.remove('is-open');
        s.querySelector('.blup-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Закрыть по Escape глобально
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.blup-select.is-open').forEach(s => {
        s.classList.remove('is-open');
        s.querySelector('.blup-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    }
  });
})();
