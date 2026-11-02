const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g';  
const ADMIN_CHAT = '7646143249'; 
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
function moscowTime(value){return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'medium'}).format(value?new Date(value):new Date());}
async function notifyAdmin(item){
 if(!bot||!ADMIN_CHAT)return;
 const isWithdraw=item.operation==='withdraw';
 if(item.operation==='promo'){await bot.sendMessage(ADMIN_CHAT,`🎟️ АКТИВАЦИЯ ПРОМОКОДА\n👤 Ник: ${item.nickname||'—'}\n🆔 ID: ${item.publicId||'—'}\n🏷️ Код: ${item.promoCode||'—'}\n🕐 Время МСК: ${moscowTime()}`);return;}
 const lines=[isWithdraw?'💸 ЗАПРОС НА ВЫВОД':'🪙 НОВАЯ ПРОДАЖА',`👤 Имя пользователя: ${item.nickname||'—'}`,`🪙 Монета: ${item.coin||'—'}`,`🌐 Сеть: ${item.network||'—'}`,`🕐 Время МСК: ${moscowTime(item.created_at)}`];
 if(isWithdraw){lines.push(`💵 Сумма: ${item.amount||'—'} USD`, `💴 К выплате: ${item.payoutRub||'—'} RUB`,`📱 Реквизиты: ${item.phone||'—'}`,`🏦 Банк: ${item.bank||'—'}`)}
 else {lines.push(`💵 Сумма: ${item.amount||'—'} USD`,`💱 Курс: ${item.rate||'—'} RUB за 1 ${item.coin||''}`,`💴 К выплате: ${item.payoutRub||'—'} RUB`,...(item.discountPercent?[`🎟️ Применена скидка: ${item.discountPercent}%`]:[]),`📥 Кошелёк BLUP: ${item.wallet||'—'}`,`💳 Тип выплаты: ${item.payoutType==='card'?'Банковская карта':'Телефон / СБП'}`,`📱 Реквизиты выплаты: ${item.phone||'—'}`,`🏦 Банк: ${item.bank||'—'}`,`📝 Комментарий: ${item.comment||'—'}`,`✈️ Telegram: @${item.telegramUsername||'—'}`,`🧾 Заявка: #${item.id||'—'}`)}
 await bot.sendMessage(ADMIN_CHAT,lines.join('\n'));
}
module.exports={notifyAdmin};
