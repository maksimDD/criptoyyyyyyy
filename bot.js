const TelegramBot = require('node-telegram-bot-api');

// Токен и ID для бота ПРОДАЖ (сюда приходят продажи и выводы)
const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
const ADMIN_CHAT = '7270019395'; 

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
           `🏦 ${sale.bank}\n` + 
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