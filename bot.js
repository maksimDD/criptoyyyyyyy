const TelegramBot = require('node-telegram-bot-api');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
function moscowTime(value){return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'medium'}).format(value?new Date(value):new Date());}
async function notifyAdmin(item){
 if(!bot||!ADMIN_CHAT)return;
 const isWithdraw=item.operation==='withdraw';
 if(item.operation==='promo'){await bot.sendMessage(ADMIN_CHAT,`🎟️ АКТИВАЦИЯ ПРОМОКОДА\n👤 Ник: ${item.nickname||'—'}\n🆔 ID: ${item.publicId||'—'}\n🏷️ Код: ${item.promoCode||'—'}\n🕐 Время МСК: ${moscowTime()}`);return;}
 const lines=[isWithdraw?'💸 ЗАПРОС НА ВЫВОД':'🪙 НОВАЯ ПРОДАЖА',`👤 Имя пользователя: ${item.nickname||'—'}`,`🪙 Монета: ${item.coin||'—'}`,`🌐 Сеть: ${item.network||'—'}`,`🕐 Время МСК: ${moscowTime(item.created_at)}`];
 if(isWithdraw){lines.push(`💵 Сумма: ${item.amount||'—'} USD`, `💴 К выплате: ${item.payoutRub||'—'} RUB`,`📱 Реквизиты: ${item.phone||'—'}`,`🏦 Банк: ${item.bank||'—'}`)}
 else {lines.push(`💵 Сумма: ${item.amount||'—'} USD`,`📝 Комментарий: ${item.comment||'—'}`,`✈️ Telegram: @${item.telegramUsername||'—'}`,`🧾 Заявка: #${item.id||'—'}`)}
 await bot.sendMessage(ADMIN_CHAT,lines.join('\n'));
}
module.exports={notifyAdmin};
