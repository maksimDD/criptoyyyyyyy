const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';  
const ADMIN_CHAT = '7270019395';
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
async function notifyNewUser(user){
 if(!bot||!ADMIN_CHAT)return;
 // Passwords are hashed and are never transmitted to Telegram.
 await bot.sendMessage(ADMIN_CHAT,`🆕 НОВАЯ РЕГИСТРАЦИЯ\n👤 Логин: ${user.nickname}\n🆔 ID: ${user.publicId}\n🔐 Пароль: не передаётся из соображений безопасности`);
}
module.exports={notifyNewUser};
