const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ВАЖНО: Для Amvera база данных должна лежать в папке /data
// Если ты запускаешь локально на компьютере, можно оставить как есть (data.db в папке проекта).
// Для Amvera раскомментируй строку ниже и закомментируй ту, что внизу.
const dbPath = process.env.NODE_ENV === 'production' ? '/data/data.db' : path.join(__dirname, 'data.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    nickname TEXT,
    coin TEXT,
    network TEXT,
    wallet TEXT,
    phone TEXT,
    bank TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Добавляем колонку status, если ее нет (чтобы не было ошибок при обновлении)
  db.run("ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'", err => {});

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT,
    ip_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ip_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.get("SELECT value FROM settings WHERE key = 'stopped'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO settings (key, value) VALUES ('stopped', '0')");
    }
  });
});

module.exports = db;