const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';  
const ADMIN_CHAT = '7270019395';
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyNewUser(user){
 if(!bot||!ADMIN_CHAT) return;
 
 let text = `🆕 НОВАЯ РЕГИСТРАЦИЯ\n`;
 text += `👤 Логин: ${user.nickname}\n`;
 text += `🆔 ID сайта: ${user.publicId}\n`;
 
 // Если это вход через Telegram
 if (user.telegramId) {
   text += `✈️ Telegram ID: <code>${user.telegramId}</code>\n`;
   text += `🔗 Юзернейм: ${user.telegramUsername ? '@' + user.telegramUsername : 'нет'}\n`;
 } else {
   text += `🔐 Пароль: не передаётся из соображений безопасности\n`;
 }

 await bot.sendMessage(ADMIN_CHAT, text, { parse_mode: 'HTML' }).catch(err => console.error('Telegram notify error:', err.message));
}
module.exports={notifyNewUser}; 
