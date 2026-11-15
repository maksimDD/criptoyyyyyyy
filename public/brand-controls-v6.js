(()=>{
  const selector='select:not([multiple]):not([size]):not([data-native-select]):not(.blup-select-native)';
  const closeAll=except=>document.querySelectorAll('.blup-select-wrap.is-open').forEach(w=>{if(w!==except){w.classList.remove('is-open');w.querySelector('.blup-select-trigger')?.setAttribute('aria-expanded','false')}});
  function enhance(select){
    if(!(select instanceof HTMLSelectElement)||select.dataset.blupEnhanced==='1'||!select.matches(selector))return;
    const wrap=document.createElement('div');wrap.className='blup-select-wrap';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='blup-select-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const value=document.createElement('span');value.className='blup-select-value';
    const arrow=document.createElement('i');arrow.className='blup-select-arrow';arrow.setAttribute('aria-hidden','true');trigger.append(value,arrow);
    const menu=document.createElement('div');menu.className='blup-select-menu';menu.setAttribute('role','listbox');
    select.parentNode.insertBefore(wrap,select);wrap.append(trigger,menu);wrap.append(select);select.classList.add('blup-select-native');select.dataset.blupEnhanced='1';
    const rebuild=()=>{
      value.textContent=select.selectedOptions[0]?.textContent?.trim()||'Выбрать';menu.innerHTML='';
      [...select.options].forEach((opt,index)=>{
        const item=document.createElement('button');item.type='button';item.className='blup-select-option'+(opt.selected?' is-selected':'');item.setAttribute('role','option');item.setAttribute('aria-selected',opt.selected?'true':'false');item.disabled=opt.disabled;item.textContent=opt.textContent.trim();
        item.addEventListener('click',()=>{if(opt.disabled)return;select.selectedIndex=index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));rebuild();wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');trigger.focus()});menu.append(item);
      });
      trigger.disabled=select.disabled;wrap.classList.toggle('is-disabled',select.disabled);
    };
    trigger.addEventListener('click',()=>{if(select.disabled)return;const open=!wrap.classList.contains('is-open');closeAll(wrap);wrap.classList.toggle('is-open',open);trigger.setAttribute('aria-expanded',String(open));if(open){const chosen=menu.querySelector('.is-selected');chosen?.scrollIntoView({block:'nearest'})}});
    trigger.addEventListener('keydown',e=>{if(e.key==='Escape'){wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false')}if(e.key==='ArrowDown'||e.key==='Enter'||e.key===' '){e.preventDefault();if(!wrap.classList.contains('is-open'))trigger.click();else (menu.querySelector('.is-selected')||menu.querySelector('.blup-select-option:not(:disabled)'))?.focus()}});
    select.addEventListener('change',rebuild);select.addEventListener('input',rebuild);
    new MutationObserver(rebuild).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected']});
    rebuild();
  }
  const scan=root=>(root.matches?.(selector)?enhance(root):null,root.querySelectorAll?.(selector).forEach(enhance));
  const start=()=>{scan(document);new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.body,{childList:true,subtree:true});document.addEventListener('click',e=>{if(!e.target.closest('.blup-select-wrap'))closeAll()});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
