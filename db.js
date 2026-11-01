const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'data.db'));
const run = (sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(err){if(err)reject(err);else resolve(this);}));
const all = (sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(err,rows)=>err?reject(err):resolve(rows)));

// Expose a readiness promise so the HTTP server never accepts requests before migrations finish.
db.ready = (async () => {
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
    users: { last_ip:'TEXT', last_seen:'TEXT', is_banned:'INTEGER DEFAULT 0', ban_reason:'TEXT', session_version:'INTEGER DEFAULT 0' },
    sales: { operation_type:"TEXT DEFAULT 'sell'", memo:'TEXT', payout_type:'TEXT', amount:'REAL DEFAULT 0', status:"TEXT DEFAULT 'pending'" }
  };
  for (const [table, columns] of Object.entries(migrations)) {
    const existing = new Set((await all(`PRAGMA table_info(${table})`)).map(x=>x.name));
    for (const [column, definition] of Object.entries(columns)) {
      if (!existing.has(column)) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  const defaults = {
    stopped:'0', usdt_rate:'0', gram_rate:'0', reserve_total:'0', reserve_available:'0',
    banks:JSON.stringify(['Сбербанк','Т-Банк','ВТБ','Альфа-Банк','Газпромбанк','Россельхозбанк','Промсвязьбанк','Совкомбанк','Райффайзенбанк','Московский кредитный банк','Банк ДОМ.РФ','Уралсиб','Ак Барс Банк','Банк Санкт-Петербург','ОТП Банк','ЮниКредит Банк','Почта Банк','Озон Банк','Яндекс Банк','МТС Банк','Ренессанс Банк','Банк Зенит','Банк Россия','Синара Банк','Центр-инвест','Примсоцбанк','Кубань Кредит','Локо-Банк','Металлинвестбанк','Банк Левобережный','ББР Банк','Экспобанк','Точка','Модульбанк','Дальневосточный банк','Генбанк','Авангард','Банк Казани','Энерготрансбанк','Форштадт','Кредит Европа Банк','Банк Интеза','Банк Акцепт','Финсервис','Челиндбанк','Банк СГБ','Приморье','Кольцо Урала','Новикомбанк','Абсолют Банк','Банк Санкт-Петербург'])
  };
  for (const [key,value] of Object.entries(defaults)) await run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',[key,value]);
  await run('DELETE FROM sessions WHERE expires < ?',[Date.now()]);
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_nocase ON users(nickname COLLATE NOCASE)').catch(err=>console.warn('Не удалось создать индекс уникальности ников без учёта регистра:',err.message));
  console.log('База BLUP готова; миграции завершены.');
})();
module.exports = db;
