const TelegramBot = require('node-telegram-bot-api');

// Registration notification pairs:
// 1) REGISTER_BOT_TOKEN + REGISTER_ADMIN_CHAT (fallback to general pair 1)
// 2) REGISTER_BOT_TOKEN_2 + REGISTER_ADMIN_CHAT_2 (fallback to general pair 2)
const destinations = [
  {
    token: process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.REGISTER_ADMIN_CHAT || process.env.TELEGRAM_ADMIN_CHAT
  },
  {
    token: process.env.REGISTER_BOT_TOKEN_2 || process.env.TELEGRAM_BOT_TOKEN_2,
    chatId: process.env.REGISTER_ADMIN_CHAT_2 || process.env.TELEGRAM_ADMIN_CHAT_2
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
