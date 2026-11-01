const TelegramBot = require('node-telegram-bot-api');
//const { SocksProxyAgent } = require('socks-proxy-agent');

const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
const ADMIN_CHAT = '7270019395'; 

// Прокси (если выдает ошибку, закомментируй эту строку и добавь agent в bot)
// const agent = new SocksProxyAgent('socks5://127.0.0.1:1080');

const bot = new TelegramBot(TOKEN, { polling: false });

async function notifyAdmin(sale) {
  // Проверяем, является ли это выводом с сайта
  const isWithdraw = sale.network === 'Вывод с сайта';

  // Достаём сумму — поддерживаем разные варианты названия поля
  const amount = sale.amount ?? sale.sum ?? sale.total ?? sale.price ?? null;

  let text = '';
  
  if (isWithdraw) {
    // Сообщение для ВЫВОДА
    text = `💸 *Новый вывод с сайта!*\n\n` +
           `👤 Пользователь: ${sale.nickname || 'гость'}\n` +
           `🪙 Монета: ${sale.coin}\n` +
           (amount != null ? `💰 Сумма: *${amount}*\n` : '') +
           `💼 Кошелёк: \`${sale.wallet}\`\n` +
           `📱 Телефон/карта: \`${sale.phone}\`\n` +
           `🏦 ${sale.bank}\n` +
           `🕐 ${new Date().toLocaleString('ru-RU')}`;
  } else {
    // Сообщение для ОБЫЧНОЙ ПРОДАЖИ
    text = `🔔 *Новая продажа*\n\n` +
           `👤 Пользователь: ${sale.nickname || 'гость'}\n` +
           `🪙 Монета: ${sale.coin}\n` +
           (amount != null ? `💰 Сумма: *${amount}*\n` : '') +
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
