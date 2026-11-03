const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = '/data';
if (!fs.existsSync(dbDir)) {
  try { fs.mkdirSync(dbDir, { recursive: true }); } catch (e) { console.error(e.message); }
}
const dbPath = path.join(dbDir, 'data.db');
console.log(`>>> БАЗА ДАННЫХ БУДЕТ ПОДКЛЮЧЕНА ПО ПУТИ: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('>>> КРИТИЧЕСКАЯ ОШИБКА ПОДКЛЮЧЕНИЯ К БД:', err.message);
  else console.log('>>> БАЗА ДАННЫХ УСПЕШНО ПОДКЛЮЧЕНА!');
});

const run = (sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(err){if(err)reject(err);else resolve(this);}));
const all = (sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(err,rows)=>err?reject(err):resolve(rows)));

db.ready = (async () => {
  try {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_ip TEXT, last_seen TEXT, is_banned INTEGER DEFAULT 0,
      ban_reason TEXT, session_version INTEGER DEFAULT 0
    )`);
    await run(`CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, nickname TEXT, coin TEXT,
      network TEXT, wallet TEXT, phone TEXT, bank TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      operation_type TEXT DEFAULT 'sell', memo TEXT, payout_type TEXT,
      amount REAL DEFAULT 0, status TEXT DEFAULT 'pending'
    )`);
    await run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    await run(`CREATE TABLE IF NOT EXISTS ip_bans (ip TEXT PRIMARY KEY, reason TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, nickname TEXT, ip TEXT, event TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)');

    const migrations = {
      users: { last_ip:'TEXT', last_seen:'TEXT', is_banned:'INTEGER DEFAULT 0', ban_reason:'TEXT', session_version:'INTEGER DEFAULT 0', public_id:'INTEGER', telegram_username:'TEXT',
        telegram_id:'INTEGER', telegram_first_name:'TEXT', telegram_last_name:'TEXT', telegram_photo_url:'TEXT', referred_by:'INTEGER' },
      sales: { operation_type:"TEXT DEFAULT 'sell'", memo:'TEXT', payout_type:'TEXT', amount:'REAL DEFAULT 0', status:"TEXT DEFAULT 'pending'", destination_wallet:'TEXT', parent_sale_id:'INTEGER', payout_rub:'REAL', comment:'TEXT' }
    };
    for (const [table, columns] of Object.entries(migrations)) {
      const existing = new Set((await all(`PRAGMA table_info(${table})`)).map(x=>x.name));
      for (const [column, definition] of Object.entries(columns)) {
        if (!existing.has(column)) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    await run('CREATE TABLE IF NOT EXISTS promos (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE COLLATE NOCASE, reward_type TEXT, reward_value REAL DEFAULT 0, description TEXT DEFAULT \'\', active INTEGER DEFAULT 1, activation_limit INTEGER DEFAULT 0, activation_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    const promoCols = new Set((await all('PRAGMA table_info(promos)')).map(x=>x.name));
    if (!promoCols.has('activation_limit')) await run('ALTER TABLE promos ADD COLUMN activation_limit INTEGER DEFAULT 0');
    if (!promoCols.has('activation_count')) await run('ALTER TABLE promos ADD COLUMN activation_count INTEGER DEFAULT 0');
    await run(`CREATE TABLE IF NOT EXISTS promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, promo_id INTEGER NOT NULL, user_id INTEGER NOT NULL, public_id INTEGER, nickname TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(promo_id,user_id))`);
    await run(`CREATE TABLE IF NOT EXISTS user_discounts (user_id INTEGER PRIMARY KEY, percent INTEGER NOT NULL, source TEXT DEFAULT 'admin', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS user_coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, promo_id INTEGER, percent INTEGER NOT NULL, source TEXT DEFAULT 'promo', created_at TEXT DEFAULT CURRENT_TIMESTAMP, used_at TEXT, used_sale_id INTEGER)`);
    await run('CREATE INDEX IF NOT EXISTS idx_user_coupons_active ON user_coupons(user_id, used_at)');
    
    // Таблицы для мини-игр
    await run(`CREATE TABLE IF NOT EXISTS game_balance (user_id INTEGER PRIMARY KEY, balance REAL DEFAULT 0)`);
    await run(`CREATE TABLE IF NOT EXISTS game_bets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, game TEXT, amount REAL, multiplier REAL, win_amount REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

    // Реферальная система
    await run(`CREATE TABLE IF NOT EXISTS user_referrals (user_id INTEGER PRIMARY KEY, referrer_id INTEGER, ref_code TEXT UNIQUE, balance REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS referral_withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, phone TEXT, bank TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

    // Таблица отзывов
    await run(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      nickname TEXT,
      amount REAL,
      text TEXT,
      rating INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    const defaults = {
      stopped:'0', usdt_rate:'0', gram_rate:'0', reserve_total:'0', reserve_available:'0',
      banks:JSON.stringify(['Сбербанк','Т-Банк','ВТБ','Альфа-Банк','Газпромбанк','Россельхозбанк','Промсвязьбанк','Совкомбанк','Райффайзенбанк','Московский кредитный банк','Банк ДОМ.РФ','Уралсиб','Ак Барс Банк','Банк Санкт-Петербург','ОТП Банк','ЮниКредит Банк','Почта Банк','Озон Банк','Яндекс Банк','МТС Банк','Ренессанс Банк','Банк Зенит','Банк Россия','Синара Банк','Центр-инвест','Примсоцбанк','Кубань Кредит','Локо-Банк','Металлинвестбанк','Банк Левобережный','ББР Банк','Экспобанк','Точка','Модульбанк','Дальневосточный банк','Генбанк','Авангард','Банк Казани','Энерготрансбанк','Форштадт','Кредит Европа Банк','Банк Интеза','Банк Акцепт','Финсервис','Челиндбанк','Банк СГБ','Приморье','Кольцо Урала','Новикомбанк','Абсолют Банк','Банк Санкт-Петербург'])
    };
    for (const [key,value] of Object.entries(defaults)) await run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',[key,value]);
    const missingPublicIds = await all('SELECT id FROM users WHERE public_id IS NULL');
    for (const row of missingPublicIds) { let candidate; do { candidate = Math.floor(Math.random()*99999)+1; } while (await all('SELECT id FROM users WHERE public_id=?',[candidate]).then(x=>x.length)); await run('UPDATE users SET public_id=? WHERE id=?',[candidate,row.id]); }
    await run('DELETE FROM sessions WHERE expires < ?',[Date.now()]);
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_nocase ON users(nickname COLLATE NOCASE)').catch(err=>console.warn(err.message));
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL').catch(err=>console.warn(err.message));
    
    console.log('База BLUP готова; миграции завершены.');
  } catch (e) {
    console.error('КРИТИЧЕСКАЯ ОШИБКА ИНИЦИАЛИЗАЦИИ БД:', e);
    throw e;
  }
})();
module.exports = db;
