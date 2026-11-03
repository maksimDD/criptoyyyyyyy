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
  
  let text = '';
  
  if (item.operation === 'promo') {
    text = `🎟️ АКТИВАЦИЯ ПРОМОКОДА\n👤 Ник: ${item.nickname||'—'}\n🆔 ID: ${item.publicId||'—'}\n🏷️ Код: ${item.promoCode||'—'}\n🕐 Время МСК: ${moscowTime()}`;
  } else if (item.operation === 'withdraw') {
    text = `💸 ЗАПРОС НА ВЫВОД\n👤 Пользователь: ${item.nickname||'—'}\n💵 Сумма: ${item.amount||'—'} USD\n💴 К выплате: ${item.payoutRub||'—'} RUB\n📱 Реквизиты: ${item.phone||'—'}\n🏦 Банк: ${item.bank||'—'}\n🕐 Время МСК: ${moscowTime(item.created_at)}`;
  } else if (item.operation === 'ref_withdraw') {
    text = `🪙 Вывод с реф системы\n👤 Пользователь: ${item.nickname||'—'}\n🕐 Время МСК: ${moscowTime()}\n💵 Сумма: ${item.amount||'—'} USD\n💳 Тип выплаты: ${item.payoutType === 'card' ? 'Банковская карта' : 'Телефон / СБП'}\n📱 Реквизиты выплаты: ${item.phone||'—'}\n🏦 Банк: ${item.bank||'—'}`;
  } else {
    const lines = [
      '🪙 НОВАЯ ПРОДАЖА',
      `👤 Имя пользователя: ${item.nickname||'—'}`,
      `🪙 Монета: ${item.coin||'—'}`,
      `🌐 Сеть: ${item.network||'—'}`,
      `🕐 Время МСК: ${moscowTime(item.created_at)}`,
      `💵 Сумма: ${item.amount||'—'} USD`,
      `💱 Курс: ${item.rate||'—'} RUB за 1 ${item.coin||''}`,
      `💴 К выплате: ${item.payoutRub||'—'} RUB`,
      ...(item.discountPercent?[`🎟️ Применена скидка: ${item.discountPercent}%`]:[]),
      `📥 Кошелёк BLUP: ${item.wallet||'—'}`,
      `💳 Тип выплаты: ${item.payoutType==='card'?'Банковская карта':'Телефон / СБП'}`,
      `📱 Реквизиты выплаты: ${item.phone||'—'}`,
      `🏦 Банк: ${item.bank||'—'}`,
      `📝 Комментарий: ${item.comment||'—'}`,
      `✈️ Telegram: @${item.telegramUsername||'—'}`,
      `🧾 Заявка: #${item.id||'—'}`
    ];
    text = lines.join('\n');
  }

  for (const inst of botInstances) {
    try {
      await inst.bot.sendMessage(inst.chatId, text);
    } catch (e) {
      console.error(`Ошибка отправки в бот (${inst.chatId}):`, e.message);
    }
  }
}

module.exports = { notifyAdmin };
