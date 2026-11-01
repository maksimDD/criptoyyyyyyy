const TelegramBot = require('node-telegram-bot-api');
<<<<<<< HEAD

// Configure through environment variables; do not hard-code bot secrets in source.
const TOKEN = process.env.SALES_BOT_TOKEN;
const ADMIN_CHAT = process.env.ADMIN_CHAT_ID;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

async function notifyAdmin(sale) {
  if (!bot || !ADMIN_CHAT) return;
  // Only send a minimal notification. Never forward phone/card/bank or wallet details to chat.
  const text = [
    'Новая заявка на обмен',
    `Пользователь: ${String(sale.nickname || 'гость').slice(0, 64)}`,
    `Актив: ${String(sale.coin || '').slice(0, 20)}`,
    `Сеть: ${String(sale.network || 'не указана').slice(0, 32)}`,
    `Время: ${new Date().toLocaleString('ru-RU')}`
  ].join('\n');
  try {
    await bot.sendMessage(ADMIN_CHAT, text);
    console.log('Уведомление о заявке отправлено.');
  } catch (e) {
    console.error('Ошибка отправки уведомления:', e.message);
  }
}

module.exports = { notifyAdmin };
=======
//const { SocksProxyAgent } = require('socks-proxy-agent');

const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
const ADMIN_CHAT = '7270019395'; 

// Прокси (если выдает ошибку, закомментируй эту строку и добавь agent в bot)
// const agent = new SocksProxyAgent('socks5://127.0.0.1:1080');

const bot = new TelegramBot(TOKEN, { polling: false });

async function notifyAdmin(sale) {
  // Проверяем, является ли это выводом с сайта
  const isWithdraw = sale.network === 'Вывод с сайта';

  let text = '';
  
  if (isWithdraw) {
    // Сообщение для ВЫВОДА
    text = `💸 *Новый вывод с сайта!*\n\n` +
           `👤 Пользователь: ${sale.nickname || 'гость'}\n` +
           `🪙 Монета: ${sale.coin}\n` +
           `💼 Кошелёк: \`${sale.wallet}\`\n` +
           `📱 Телефон/карта: \`${sale.phone}\`\n` +
           `🏦 ${sale.bank}\n` + // Тут уже придет "Банк: Сбер | Сумма вывода: 50"
           `🕐 ${new Date().toLocaleString('ru-RU')}`;
  } else {
    // Сообщение для ОБЫЧНОЙ ПРОДАЖИ
    text = `🔔 *Новая продажа*\n\n` +
           `👤 Пользователь: ${sale.nickname || 'гость'}\n` +
           `🪙 Монета: ${sale.coin}\n` +
           (sale.network ? `🌐 Сеть: ${sale.network}\n` : '') +
           `💼 Кошелёк: \`${sale.wallet}\`\n` +
           `📱 Телефон/карта: \`${sale.phone}\`\n` +
           `🏦 Банк: ${sale.bank}\n` +
           `🕐 ${new Date().toLocaleString('ru-RU')}`;
  }

  try {
    await bot.sendMessage(ADMIN_CHAT, text, { parse_mode: 'Markdown' });
    console.log(`✅ ${isWithdraw ? 'Вывод' : 'Продажа'} отправлена в Telegram!`);
  } catch (e) {
    console.error('❌ ОШИБКА ОТПРАВКИ В TELEGRAM:', e.message);
  }
}

module.exports = { notifyAdmin };
>>>>>>> d1a282aa43b0806de8c8f09c7d21ae91c9e23df8
