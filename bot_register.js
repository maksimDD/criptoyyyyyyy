const TelegramBot = require('node-telegram-bot-api');

// Configure these values with environment variables. Never send passwords to chat.
const TOKEN = process.env.REGISTER_BOT_TOKEN;
const ADMIN_CHAT = process.env.ADMIN_CHAT_ID;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyNewUser(nickname) {
  if (!bot || !ADMIN_CHAT) return;
  try {
    await bot.sendMessage(ADMIN_CHAT, `Новая регистрация: ${String(nickname).slice(0, 64)}`);
  } catch (e) {
    console.error('Ошибка уведомления о регистрации:', e.message);
  }
}

module.exports = { notifyNewUser };
