const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';        // строка 2
const ADMIN_CHAT = '7270019395';    // строка 3
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
async function notifyNewUser(user){
 if(!bot||!ADMIN_CHAT)return;
 // Passwords are hashed and are never transmitted to Telegram.
 await bot.sendMessage(ADMIN_CHAT,`🆕 НОВАЯ РЕГИСТРАЦИЯ\n👤 Логин: ${user.nickname}\n🆔 ID: ${user.publicId}\n🔐 Пароль: нахуй не нужен`);
}
module.exports={notifyNewUser};
