const TelegramBot = require('node-telegram-bot-api');

// Environment variables override these defaults. For security, rotate tokens if this archive is shared.
// Registration notifications go to the same two bot/chat pairs as general notifications.
const destinations = [
  {
    token: process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8939761902:AAGuwKyQB9PCX0OgpSUq1uKxW6tYzFegD0g',
    chatId: process.env.REGISTER_ADMIN_CHAT || process.env.TELEGRAM_ADMIN_CHAT || '7646143249'
  },
  {
    token: process.env.REGISTER_BOT_TOKEN_2 || process.env.TELEGRAM_BOT_TOKEN_2 || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnU1sI',
    chatId: process.env.REGISTER_ADMIN_CHAT_2 || process.env.TELEGRAM_ADMIN_CHAT_2 || '7270019395'
  }
].filter(x => x.token && x.chatId)
  .map(x => ({ bot: new TelegramBot(x.token, { polling: false }), chatId: x.chatId }));

async function notifyNewUser(user) {
  if (!destinations.length) return;
  // Passwords are hashed and are never transmitted to Telegram.
  const message = `🆕 НОВАЯ РЕГИСТРАЦИЯ
👤 Логин: ${user.nickname}
🆔 ID: ${user.publicId}
🔐 Пароль: не передаётся из соображений безопасности`;
  const results = await Promise.allSettled(
    destinations.map(({ bot, chatId }) => bot.sendMessage(chatId, message))
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Registration Telegram notification failed for destination ${i + 1}:`, result.reason?.message || result.reason);
    }
  });
}

module.exports = { notifyNewUser };
