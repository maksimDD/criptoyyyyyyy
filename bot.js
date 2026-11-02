const TelegramBot = require('node-telegram-bot-api');

// Configure secrets in Amvera environment variables; never commit real tokens.
// Pair 1: TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT
// Pair 2: TELEGRAM_BOT_TOKEN_2 + TELEGRAM_ADMIN_CHAT_2
const destinations = [
  { token: 8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI, chatId: 7270019395 },
  { token: 8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g, chatId: 7646143249 }
].filter(x => x.token && x.chatId)
  .map(x => ({ bot: new TelegramBot(x.token, { polling: false }), chatId: x.chatId }));

function moscowTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium'
  }).format(value ? new Date(value) : new Date());
}

async function notifyAdmin(item) {
  if (!destinations.length) return;
  const isWithdraw = item.operation === 'withdraw';
  let message;

  if (item.operation === 'promo') {
    message = `🎟️ АКТИВАЦИЯ ПРОМОКОДА
👤 Ник: ${item.nickname || '—'}
🆔 ID: ${item.publicId || '—'}
🏷️ Код: ${item.promoCode || '—'}
🕐 Время МСК: ${moscowTime()}`;
  } else {
    const lines = [
      isWithdraw ? '💸 ЗАПРОС НА ВЫВОД' : '🪙 НОВАЯ ПРОДАЖА',
      `👤 Имя пользователя: ${item.nickname || '—'}`,
      `🪙 Монета: ${item.coin || '—'}`,
      `🌐 Сеть: ${item.network || '—'}`,
      `🕐 Время МСК: ${moscowTime(item.created_at)}`
    ];
    if (isWithdraw) {
      lines.push(
        `💵 Сумма: ${item.amount || '—'} USD`,
        `💴 К выплате: ${item.payoutRub || '—'} RUB`,
        `📱 Реквизиты: ${item.phone || '—'}`,
        `🏦 Банк: ${item.bank || '—'}`
      );
    } else {
      lines.push(
        `💵 Сумма: ${item.amount || '—'} USD`,
        `💱 Курс: ${item.rate || '—'} RUB за 1 ${item.coin || ''}`,
        `💴 К выплате: ${item.payoutRub || '—'} RUB`,
        ...(item.discountPercent ? [`🎟️ Применена скидка: ${item.discountPercent}%`] : []),
        `📥 Кошелёк BLUP: ${item.wallet || '—'}`,
        `💳 Тип выплаты: ${item.payoutType === 'card' ? 'Банковская карта' : 'Телефон / СБП'}`,
        `📱 Реквизиты выплаты: ${item.phone || '—'}`,
        `🏦 Банк: ${item.bank || '—'}`,
        `📝 Комментарий: ${item.comment || '—'}`,
        `✈️ Telegram: @${item.telegramUsername || '—'}`,
        `🧾 Заявка: #${item.id || '—'}`
      );
    }
    message = lines.join('\n');
  }

  const results = await Promise.allSettled(
    destinations.map(({ bot, chatId }) => bot.sendMessage(chatId, message))
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Telegram notification failed for destination ${i + 1}:`, result.reason?.message || result.reason);
    }
  });
}

module.exports = { notifyAdmin };
