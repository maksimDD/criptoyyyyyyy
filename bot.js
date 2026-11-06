const TelegramBot = require('node-telegram-bot-api');

function destinations() {
  const pairs = [
    {
      token: '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI',
      chatId: '7270019395'
    },
    {
      token: '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g',
      chatId: '7646143249'
    }
  ].filter(x => x.token && x.chatId);

  return pairs.map(x => ({
    ...x,
    bot: new TelegramBot(x.token, { polling: false })
  }));
}

const moscowTime = value =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(value ? new Date(value) : new Date());

async function sendToAll(message, options = {}) {
  const results = await Promise.allSettled(
    destinations().map(({ bot, chatId }) =>
      bot.sendMessage(chatId, message, options)
    )
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Telegram notify ${i + 1}:`, r.reason?.message || r.reason);
    }
  });

  if (!results.length || results.every(r => r.status === 'rejected')) {
    throw new Error('Не удалось отправить уведомление ни в один Telegram-чат');
  }
}

async function notifyAdmin(item) {
  const isWithdraw =
    item.operation === 'withdraw' ||
    item.operation === 'ref_withdraw';

  if (item.operation === 'promo') {
    return sendToAll(
      `🎟️ АКТИВАЦИЯ ПРОМОКОДА
👤 Ник: ${item.nickname || '—'}
🆔 ID: ${item.publicId || '—'}
✈️ Telegram: ${item.telegramUsername ? '@' + item.telegramUsername.replace(/^@/, '') : '—'}
🏷️ Код: ${item.promoCode || '—'}
🕐 Время МСК: ${moscowTime()}`
    );
  }

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
      `📱 Реквизиты: ${item.phone || '—'}`,
      `🏦 Банк: ${item.bank || '—'}`
    );
  } else {
    lines.push(
      `💵 Сумма: ${item.amount || '—'} USD`,
      `💱 Курс: ${item.rate || '—'} RUB за 1 ${item.coin || ''}`,
      `💴 К выплате: ${item.payoutRub || '—'} RUB`,
      ...(item.discountPercent ? [`🎟️ Скидка: ${item.discountPercent}%`] : []),
      `📥 Кошелёк BLUP: ${item.wallet || '—'}`,
      `💳 Тип выплаты: ${item.payoutType === 'card' ? 'Банковская карта' : 'Телефон / СБП'}`,
      `📱 Реквизиты: ${item.phone || '—'}`,
      `🏦 Банк: ${item.bank || '—'}`,
      `📝 Комментарий: ${item.comment || '—'}`,
      `✈️ Telegram: @${item.telegramUsername || '—'}`,
      `🧾 Заявка: #${item.id || '—'}`
    );
  }

  return sendToAll(lines.join('\n'));
}

module.exports = { notifyAdmin };
