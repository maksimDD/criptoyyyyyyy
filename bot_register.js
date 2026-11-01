const TelegramBot = require('node-telegram-bot-api');
const TOKEN = process.env.REGISTER_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
async function notifyNewUser(nickname) {
  if (!bot || !ADMIN_CHAT) return;
  // Passwords are never sent to Telegram.
  await bot.sendMessage(ADMIN_CHAT, `🆕 Новая регистрация\n👤 Ник: ${nickname}`);
}
module.exports = { notifyNewUser };
