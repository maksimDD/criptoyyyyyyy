const TelegramBot = require('node-telegram-bot-api');

// Configure through environment variables; do not hard-code bot secrets in source.
const TOKEN = process.env.SALES_BOT_TOKEN;
const ADMIN_CHAT = process.env.ADMIN_CHAT_ID;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyAdmin(sale) {
  if (!bot || !ADMIN_CHAT) return;
  // Only send a minimal notification. Never forward phone/card/bank or wallet details to chat.
  const text = [
    'Новая заявка на обмен',
    `Пользователь: ${String(sale.nickname || 'гость').slice(0, 64)}`,
    `Актив: ${String(sale.coin || '').slice(0, 20)}`,
    `Сеть: ${String(sale.network || 'не указана').slice(0, 32)}`,
    `Время: ${new Date().toLocaleString('ru-RU')}`
  ].join('\n');
  try {
    await bot.sendMessage(ADMIN_CHAT, text);
    console.log('Уведомление о заявке отправлено.');
  } catch (e) {
    console.error('Ошибка отправки уведомления:', e.message);
  }
}

module.exports = { notifyAdmin };
