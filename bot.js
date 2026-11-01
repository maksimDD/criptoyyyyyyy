const TelegramBot = require('node-telegram-bot-api');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;
function maskPayment(value) { const v=String(value||''); return v.length>4 ? '•••• '+v.slice(-4) : '••••'; }
async function notifyAdmin(sale) {
  if (!bot || !ADMIN_CHAT) return;
  const isWithdraw = sale.network === 'Вывод с сайта';
  const text = `${isWithdraw ? '💸 Новый запрос на вывод' : '🔔 Новая заявка'}\n\n` +
    `👤 Пользователь: ${sale.nickname || '—'}\n🪙 Актив: ${sale.coin || '—'}\n` +
    `${sale.network ? `🌐 Сеть: ${sale.network}\n` : ''}` +
    `💼 Кошелёк: ${sale.wallet || '—'}\n` +
    `${sale.memo ? `📝 MEMO: ${sale.memo}\n` : ''}` +
    `📱 Получение: ${maskPayment(sale.phone)}\n🏦 ${sale.bank || '—'}\n` +
    `🕐 ${new Date().toLocaleString('ru-RU')}`;
  await bot.sendMessage(ADMIN_CHAT, text);
}
module.exports = { notifyAdmin };
