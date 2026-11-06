const TelegramBot = require('node-telegram-bot-api');

function destinations() {
  const pairs = [
    { token: '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI', chatId: '7270019395' },
    { token: '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g', chatId: '7646143249' }
  ];

  return pairs
    .filter(x => x.token && x.chatId)
    .map(x => ({
      ...x,
      bot: new TelegramBot(x.token, { polling: false })
    }));
}

async function notifyNewUser(user) {
  const lines = [
    '🆕 НОВАЯ РЕГИСТРАЦИЯ',
    `👤 Логин: ${user.nickname || '—'}`,
    `🆔 ID сайта: ${user.publicId || '—'}`,
    `✈️ Telegram: ${user.telegramUsername ? '@' + user.telegramUsername.replace(/^@/, '') : '—'}`
  ];

  if (user.telegramId) {
    lines.push(`🆔 Telegram ID: ${user.telegramId}`);
  } else {
    lines.push('🔐 Регистрация по паролю');
  }

  const targets = destinations();

  if (!targets.length) {
    throw new Error('Не настроены Telegram-боты');
  }

  const results = await Promise.allSettled(
    targets.map(x => x.bot.sendMessage(x.chatId, lines.join('\n')))
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(
        `Telegram registration notify ${i + 1}:`,
        r.reason?.message || r.reason
      );
    }
  });

  if (results.every(r => r.status === 'rejected')) {
    throw new Error('Не удалось отправить уведомление');
  }
}

module.exports = { notifyNewUser };
