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

function moscowTime(value){
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'medium'}).format(value?new Date(value):new Date());
}

async function notifyAdmin(item){
  if (!botInstances.length) return;
  
  const isWithdraw = item.operation === 'withdraw';
  let text = '';
  
  if (item.operation === 'promo') {
    text = `🎟️ АКТИВАЦИЯ ПРОМОКОДА\n👤 Ник: ${item.nickname||'—'}\n🆔 ID: ${item.publicId||'—'}\n🏷️ Код: ${item.promoCode||'—'}\n🕐 Время МСК: ${moscowTime()}`;
  } else {
    const lines = [isWithdraw?'💸 ЗАПРОС НА ВЫВОД':'🪙 НОВАЯ ПРОДАЖА', `👤 Имя пользователя: ${item.nickname||'—'}`, `🪙 Монета: ${item.coin||'—'}`, `🌐 Сеть: ${item.network||'—'}`, `🕐 Время МСК: ${moscowTime(item.created_at)}`];
    if (isWithdraw) {
      lines.push(`💵 Сумма: ${item.amount||'—'} USD`, `💴 К выплате: ${item.payoutRub||'—'} RUB`, `📱 Реквизиты: ${item.phone||'—'}`, `🏦 Банк: ${item.bank||'—'}`);
    } else {
      lines.push(`💵 Сумма: ${item.amount||'—'} USD`, `💱 Курс: ${item.rate||'—'} RUB за 1 ${item.coin||''}`, `💴 К выплате: ${item.payoutRub||'—'} RUB`, ...(item.discountPercent?[`🎟️ Применена скидка: ${item.discountPercent}%`]:[]), `📥 Кошелёк BLUP: ${item.wallet||'—'}`, `💳 Тип выплаты: ${item.payoutType==='card'?'Банковская карта':'Телефон / СБП'}`, `📱 Реквизиты выплаты: ${item.phone||'—'}`, `🏦 Банк: ${item.bank||'—'}`, `📝 Комментарий: ${item.comment||'—'}`, `✈️ Telegram: @${item.telegramUsername||'—'}`, `🧾 Заявка: #${item.id||'—'}`);
    }
    text = lines.join('\n');
  }

  // Отправляем во все боты
  for (const inst of botInstances) {
    try {
      await inst.bot.sendMessage(inst.chatId, text);
    } catch (e) {
      console.error(`Ошибка отправки в бот (${inst.chatId}):`, e.message);
    }
  }
}

module.exports = { notifyAdmin };
