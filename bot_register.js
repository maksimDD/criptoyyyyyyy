const TelegramBot = require('node-telegram-bot-api');

const BOTS = [
  { token: '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI', chatId: '7270019395' },
  { token: '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g', chatId: '7646143249' }
];

const botInstances = BOTS.map(cfg => {
  try {
    return { bot: new TelegramBot(cfg.token, { polling: false }), chatId: cfg.chatId };
  } catch (e) {
    console.error('Ошибка создания бота:', e.message);
    return null;
  }
}).filter(Boolean);

async function notifyNewUser(user){
  if (!botInstances.length) return;

  let text = `🆕 НОВАЯ РЕГИСТРАЦИЯ\n`;
  text += `👤 Логин: ${user.nickname}\n`;
  text += `🆔 ID сайта: ${user.publicId}\n`;
  
  if (user.telegramId) {
    text += `✈️ Telegram ID: <code>${user.telegramId}</code>\n`;
    text += `🔗 Юзернейм: ${user.telegramUsername ? '@' + user.telegramUsername : 'нет'}\n`;
  } else {
    text += `🔐 Пароль: не передаётся из соображений безопасности\n`;
  }

  // Отправляем во все боты
  for (const inst of botInstances) {
    try {
      await inst.bot.sendMessage(inst.chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
      console.error(`Ошибка отправки в бот (${inst.chatId}):`, e.message);
    }
  }
}

module.exports = { notifyNewUser };
