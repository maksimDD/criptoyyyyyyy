const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
const ADMIN_CHAT = '7270019395';
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyNewUser(nickname) {
  if (!bot || !ADMIN_CHAT) return;
  // Passwords are never sent to Telegram.
  await bot.sendMessage(ADMIN_CHAT, `🆕 Новая регистрация\n👤 Ник: ${nickname}`);
}
module.exports = { notifyNewUser };
