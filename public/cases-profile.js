const $=s=>document.querySelector(s);
const setText=(s,v)=>{const e=$(s);if(e)e.textContent=v;};
const setHTML=(s,v)=>{const e=$(s);if(e)e.innerHTML=v;};
const on=(s,ev,fn)=>{const e=$(s);if(e)e.addEventListener(ev,fn);};

let inventory=[],targets=[],selected=new Set(),targetId='',busy=false,balanceAmount=0,balanceAvailable=0,statusMessage='';
const usd=n=>'$'+Number(n||0).toFixed(2);
const stake=()=>inventory.filter(x=>selected.has(Number(x.id))).reduce((a,x)=>a+Number(x.price||0),0)+balanceAmount;
const chosen=()=>targets.find(x=>String(x.id)===String(targetId));

async function api(url,opts={}){const r=await fetch(url,{...opts,credentials:'same-origin',headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Ошибка');return d}

function render(){
  try{
    const st=stake(), t=chosen(), ch=t&&st>0?Math.min(86,Math.max(1,st/Number(t.price)*100)):0;

    setHTML('#sourceGrid', inventory.length
      ? inventory.map(x=>`<button class="up-skin ${selected.has(Number(x.id))?'selected':''}" data-source="${x.id}"><b>${x.skin_name||'?'}</b><small>${usd(x.price)}</small></button>`).join('')
      : '<div class="empty-inventory">Инвентарь пуст</div>');

    setHTML('#targetGrid', targets.length
      ? targets.map(x=>`<button class="up-skin ${String(targetId)===String(x.id)?'selected':''}" data-target="${x.id}"><b>${x.name}</b><small>${usd(x.price)}</small></button>`).join('')
      : '<div class="empty-inventory">Каталог пуст</div>');

    setText('#stakeTotal', usd(st));
    setText('#stakeLabel', usd(st));
    setText('#targetLabel', t?`${t.name} · ${usd(t.price)}`:'не выбрана');
    setText('#chanceValue', ch.toFixed(2)+'%');
    setText('#selectedCount', selected.size+' / 5 скинов');
    setText('#balanceAvailable', 'Доступно '+usd(balanceAvailable));
    setText('#inventoryCount', inventory.length);
    setText('#targetCount', targets.length);

    const btn=$('#upgradeBtn');
    if(btn){
      btn.disabled=busy||(!selected.size&&balanceAmount<=0)||!t||Number(t.price)<=st;
      btn.innerHTML=busy?'◌ ПРОВЕРЯЕМ…':'⌁ УЛУЧШИТЬ';
    }

    setText('#wheelStatus', busy?'АПГРЕЙД…':statusMessage||(!t?'ВЫБЕРИ ЦЕЛЬ':'ГОТОВО'));
  }catch(e){console.error('render error:',e);}
}

async function load(){
  try{
    const [inv,cat,bal]=await Promise.allSettled([api('/api/cases/inventory'),api('/api/cases/upgrader/catalog'),api('/api/cases/balance')]);
    inventory=inv.status==='fulfilled'?(inv.value.items||[]):[];
    targets=cat.status==='fulfilled'?(cat.value.skins||[]):[];
    balanceAvailable=bal.status==='fulfilled'?Number(bal.value.balance||0):0;
  }catch(e){console.error('load error:',e);}
  render();
}

on('#sourceGrid','click',e=>{const b=e.target.closest('button[data-source]');if(!b||busy)return;const id=Number(b.dataset.source);if(selected.has(id))selected.delete(id);else if(selected.size<5)selected.add(id);statusMessage='';render();});
on('#targetGrid','click',e=>{const b=e.target.closest('button[data-target]');if(!b||busy)return;targetId=String(b.dataset.target);statusMessage='';render();});

const br=$('#balanceAmountRange');
if(br)br.oninput=e=>{balanceAmount=Math.min(balanceAvailable,Math.max(0,Number(e.target.value)||0));render();};

on('#upgradeBtn','click',async()=>{
  if(busy)return;
  const t=chosen(),total=stake();
  if(!t){statusMessage='ВЫБЕРИ ЦЕЛЬ';render();return;}
  if(Number(t.price)<=total){statusMessage='ЦЕЛЬ ДОРОЖЕ СТАВКИ';render();return;}
  busy=true;statusMessage='АПГРЕЙД…';render();
  try{
    const d=await api('/api/cases/upgrader',{method:'POST',body:JSON.stringify({sourceIds:[...selected],targetSkinId:String(t.id),balanceAmount:Number(balanceAmount.toFixed(2))})});
    statusMessage=d.won?'ПОБЕДА!':'НЕ ПОВЕЗЛО';
    selected.clear();targetId='';balanceAmount=0;
    await new Promise(r=>setTimeout(r,500));
    const [inv,bal]=await Promise.all([api('/api/cases/inventory'),api('/api/cases/balance')]);
    inventory=inv.items||[];balanceAvailable=Number(bal.balance||0);
  }catch(e){statusMessage='ОШИБКА: '+e.message;}
  busy=false;render();
});

load();
