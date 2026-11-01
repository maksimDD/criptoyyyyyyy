const TelegramBot = require('node-telegram-bot-api');
//const { SocksProxyAgent } = require('socks-proxy-agent');

const TOKEN = '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
const ADMIN_CHAT = '7270019395';

// const agent = new SocksProxyAgent('socks5://127.0.0.1:1080');

const bot = new TelegramBot(TOKEN, { polling: false });

async function notifyAdmin(sale) {
  const isWithdraw = sale.network === 'Вывод с сайта';

  // Сумма, которую выбрал пользователь на сайте (сколько продаёт / выводит)
  const amount = sale.amount ?? sale.sum ?? sale.total ?? sale.price ?? sale.selectedAmount ?? '';

  // Сумма к реальной отправке (после комиссии / по курсу) — если есть
  const toSend = sale.toSend ?? sale.sendAmount ?? sale.payout ?? sale.send ?? null;

  let text = '';

  if (isWithdraw) {
    text = `💸 *Новый вывод с сайта!*\n\n` +
           `👤 Пользователь: ${sale.nickname || 'гость'}\n` +
           `🪙 Монета: ${sale.coin}\n` +
           (toSend != null ? `💵 К отправке: *${toSend}*\n` : '') +
           `🪙 Сумма: ${sale.wallet}\n` +
           `📱 Телефон/карта: \`${sale.phone}\`\n` +
           `🏦 ${sale.bank}\n` +
           `🕐 ${new Date().toLocaleString('ru-RU')}`;
  } else {
    text = `🔔 *Новая продажа*\n\n` +
           `👤 Пользователь: ${sale.nickname || 'гость'}\n` +
           `🪙 Монета: ${sale.coin}\n` +
           (sale.network ? `🌐 Сеть: ${sale.network}\n` : '') +
           (toSend != null ? `💵 К отправке: *${toSend}*\n` : '') +
           `🪙 Монета: ${sale.wallet}\n` +
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
