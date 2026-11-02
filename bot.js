const TelegramBot = require('node-telegram-bot-api');

const TOKEN = '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g';
const ADMIN_CHAT = '7646143249';
const destinations = [
  { bot: new TelegramBot(TOKEN, { polling: false }), chatId: ADMIN_CHAT }
];

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
