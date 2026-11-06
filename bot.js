const TelegramBot = require('node-telegram-bot-api');

// Configure both notification destinations through server environment variables.
// No bot token is shipped to the browser or committed to source code.
function destinations() {
  const pairs = [1, 2].map(n => ({
    token: process.env[`TELEGRAM_BOT_${n}_TOKEN`],
    chatId: process.env[`TELEGRAM_BOT_${n}_CHAT_ID`]
  })).filter(x => x.token && x.chatId);
  // Backwards compatibility for existing single-bot deployments.
  if (!pairs.length && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT) {
    pairs.push({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_ADMIN_CHAT });
  }
  return pairs.map(x => ({ ...x, bot: new TelegramBot(x.token, { polling: false }) }));
}
const moscowTime = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(value ? new Date(value) : new Date());
async function sendToAll(message, options = {}) {
  const results = await Promise.allSettled(destinations().map(({ bot, chatId }) => bot.sendMessage(chatId, message, options)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`Telegram notify ${i + 1}:`, r.reason?.message || r.reason); });
  if (results.length && results.every(r => r.status === 'rejected')) throw new Error('Не удалось отправить уведомление ни в один Telegram-чат');
}
async function notifyAdmin(item) {
  const isWithdraw = item.operation === 'withdraw' || item.operation === 'ref_withdraw';
  if (item.operation === 'promo') return sendToAll(`🎟️ АКТИВАЦИЯ ПРОМОКОДА\n👤 Ник: ${item.nickname || '—'}\n🆔 ID: ${item.publicId || '—'}\n🏷️ Код: ${item.promoCode || `✈️ Telegram: @${item.telegramUsername || '—'}`, '—'}\n🕐 Время МСК: ${moscowTime()}`);
  const lines = [isWithdraw ? '💸 ЗАПРОС НА ВЫВОД' : '🪙 НОВАЯ ПРОДАЖА', `👤 Имя пользователя: ${item.nickname || '—'}`, `🪙 Монета: ${item.coin || '—'}`, `🌐 Сеть: ${item.network || '—'}`, `🕐 Время МСК: ${moscowTime(item.created_at)}`];
  if (isWithdraw) lines.push(`💵 Сумма: ${item.amount || '—'} USD`, `📱 Реквизиты: ${item.phone || '—'}`, `🏦 Банк: ${item.bank || '—'}`);
  else lines.push(`💵 Сумма: ${item.amount || '—'} USD`, `💱 Курс: ${item.rate || '—'} RUB за 1 ${item.coin || ''}`, `💴 К выплате: ${item.payoutRub || '—'} RUB`, ...(item.discountPercent ? [`🎟️ Скидка: ${item.discountPercent}%`] : []), `📥 Кошелёк BLUP: ${item.wallet || '—'}`, `💳 Тип выплаты: ${item.payoutType === 'card' ? 'Банковская карта' : 'Телефон / СБП'}`, `📱 Реквизиты: ${item.phone || '—'}`, `🏦 Банк: ${item.bank || '—'}`, `📝 Комментарий: ${item.comment || '—'}`, `✈️ Telegram: @${item.telegramUsername || '—'}`, `🧾 Заявка: #${item.id || '—'}`);
  return sendToAll(lines.join('\n'));
}
module.exports = { notifyAdmin };
