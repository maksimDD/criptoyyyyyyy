const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g';  
const ADMIN_CHAT = '7646143249'; 
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
async function notifyNewUser(user){
 if(!bot||!ADMIN_CHAT)return;
 // Passwords are hashed and are never transmitted to Telegram.
 await bot.sendMessage(ADMIN_CHAT,`🆕 НОВАЯ РЕГИСТРАЦИЯ\n👤 Логин: ${user.nickname}\n🆔 ID: ${user.publicId}\n🔐 Пароль: не передаётся из соображений безопасности`);
}
module.exports={notifyNewUser};
