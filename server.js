const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');
const db = require('./db');
const { notifyAdmin } = require('./bot');
const { notifyNewUser } = require('./bot_register');

const app = express();
const BLUP_WALLETS = { USDT: { BEP20:'0x88EdAc4B11E87EB124A5270CfD4Dc04dEB843184', TRC20:'TCphExgGrK3TBWtfeubGQ7QXDCKTuMoTZA', ERC20:'0xa6511569eF753c10E4e145E447D619a3186d0509', TON:'UQCgljUWsZtjfBcGLZj72Yqq5pir-auWZtD5soVvWZnEVS7H', SPL:'8ztJwQUPr4iHyRrdaUT77KqDmKxzu6qJi2Emy14bsb5f' }, GRAM: { TON:'UQCgljUWsZtjfBcGLZj72Yqq5pir-auWZtD5soVvWZnEVS7H' }, TRX: { TRON:'TCphExgGrK3TBWtfeubGQ7QXDCKTuMoTZA' } };
const PORT = process.env.PORT || 3000;
const SESSION_SECRET_FILE = path.join(__dirname, '.blup-session-secret');

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) { 
  try { SESSION_SECRET = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim(); } catch {} 
  if (!SESSION_SECRET) { 
    SESSION_SECRET = crypto.randomBytes(48).toString('hex'); 
    try { fs.writeFileSync(SESSION_SECRET_FILE, SESSION_SECRET, { mode: 0o600, flag: 'wx' }); } 
    catch { try { SESSION_SECRET = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim(); } catch {} } 
  } 
}

if (!process.env.BLUP_ADMIN_PASSWORD) console.warn('Админ-вход отключён.');
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));

class SQLiteSessionStore extends session.Store {
  get(sid, cb) { db.get('SELECT sess, expires FROM sessions WHERE sid=?', [sid], (err, row) => { if (err) return cb(err); if (!row) return cb(null, null); if (row.expires < Date.now()) return this.destroy(sid, () => cb(null, null)); try { cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); } }); }
  set(sid, sess, cb = () => {}) { const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 86400000; db.run('INSERT INTO sessions(sid,sess,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires', [sid, JSON.stringify(sess), expires], cb); }
  destroy(sid, cb = () => {}) { db.run('DELETE FROM sessions WHERE sid=?', [sid], cb); }
  touch(sid, sess, cb = () => {}) { this.set(sid, sess, cb); }
}

app.use(session({ name: 'blup.sid', secret: SESSION_SECRET, store: new SQLiteSessionStore(), resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 } }));
app.use(express.static(path.join(__dirname, 'public')));

const onlineSessions = new Map();
const ONLINE_TIMEOUT_MS = 75 * 1000;
function reportOnline(req, res) {
  req.session.onlinePresence = true;
  onlineSessions.set(req.sessionID, Date.now());
  const now = Date.now();
  let count = 0;
  for (const [sessionId, lastSeen] of onlineSessions) {
    if (now - lastSeen <= ONLINE_TIMEOUT_MS) count++;
    else onlineSessions.delete(sessionId);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ online: count });
}
app.get('/api/real-online', reportOnline);
app.get('/api/online', reportOnline);

const authAttempts = new Map();
function rateLimit(key, max = 12, windowMs = 15 * 60 * 1000) { const now = Date.now(); const item = authAttempts.get(key); if (!item || item.until < now) { authAttempts.set(key, { count: 1, until: now + windowMs }); return false; } item.count += 1; return item.count > max; }
function ipOf(req) { return String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64); }
function getSetting(key, fallback, cb) { db.get('SELECT value FROM settings WHERE key=?', [key], (err, row) => cb(err, row ? row.value : fallback)); }
function setSetting(key, value, cb) { db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)], cb || (() => {})); }
function logVisit(user, ip, event) { db.run('INSERT INTO visits(user_id,nickname,ip,event) VALUES(?,?,?,?)', [user ? user.id : null, user ? user.nickname : null, ip, event]); if (user) db.run('UPDATE users SET last_ip=?,last_seen=CURRENT_TIMESTAMP WHERE id=?', [ip, user.id]); }
function sendBlocked(res) { return res.status(403).json({ error: 'Аккаунт заблокирован.' }); }
function adminOnly(req, res, next) { if (req.session.isAdmin === true) return next(); return res.status(403).json({ error: 'Доступ запрещён' }); }

app.use('/api', (req, res, next) => {
  const ip = ipOf(req);
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (err, ban) => {
    if (err) return res.status(500).json({ error: 'Ошибка' });
    if (ban) { if (req.session) req.session.destroy(() => {}); return sendBlocked(res); }
    if (!req.session || !req.session.userId) return next();
    db.get('SELECT id,nickname,is_banned,session_version FROM users WHERE id=?', [req.session.userId], (e, user) => {
      if (e) return res.status(500).json({ error: 'Ошибка' });
      if (!user || user.is_banned || user.session_version !== req.session.sessionVersion) return req.session.destroy(() => sendBlocked(res));
      db.run('UPDATE users SET last_ip=?,last_seen=CURRENT_TIMESTAMP WHERE id=?', [ip, user.id]);
      next();
    });
  });
});

app.get('/api/status', (req, res) => getSetting('stopped', '0', (e, stopped) => res.json({ stopped: stopped === '1' && req.session.isAdmin !== true })));
app.get('/api/config', (req, res) => { db.all('SELECT key,value FROM settings WHERE key IN (\'usdt_rate\',\'gram_rate\',\'reserve_total\',\'reserve_available\',\'banks\')', [], (err, rows) => { if (err) return res.status(500).json({ error: 'Ошибка' }); const s = Object.fromEntries(rows.map(x => [x.key, x.value])); let banks = []; try { banks = JSON.parse(s.banks || '[]'); } catch {} res.json({ usdtRate: Number(s.usdt_rate || 0), gramRate: Number(s.gram_rate || 0), reserveTotal: Number(s.reserve_total || 0), reserveAvailable: Number(s.reserve_available || 0), banks, wallets: BLUP_WALLETS }); }); });
app.get('/api/auth/telegram/config', (req, res) => { const token = process.env.TELEGRAM_LOGIN_BOT_TOKEN || process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN; if (!token) return res.status(503).json({ error: 'Telegram Login не настроен: задайте TELEGRAM_LOGIN_BOT_TOKEN' }); const botId = token.split(':')[0]; if (!/^\d+$/.test(botId || '')) return res.status(503).json({ error: 'Некорректный токен Telegram Login' }); res.json({ botId, botUsername: (process.env.TELEGRAM_LOGIN_BOT_USERNAME || '').replace(/^@/, '') }); });

// ... (остальной код регистрации, логина, админки — БЕЗ ИЗМЕНЕНИЙ, он у тебя правильный) ...

// === BLUP Cases API — ИСПРАВЛЕНО ===
function ensureGameBalance(userId, cb) {
  db.run('INSERT OR IGNORE INTO game_balance(user_id,balance) VALUES(?,0)', [userId], err => {
    if (err) return cb(err);
    db.get('SELECT balance FROM game_balance WHERE user_id=?', [userId], (e, row) => cb(e, row));
  });
}
let CASE_CATALOG = require('./cases-data.json');
const CASE_CATALOG_FILE = path.join(__dirname, 'cases-data.json');
const CASE_CATALOG_PUBLIC_FILE = path.join(__dirname, 'public', 'cases-data.json');
const CASE_WALLETS = BLUP_WALLETS;
function caseUser(req,res,next){ if(!req.session?.userId) return res.status(401).json({error:'Войди в аккаунт, чтобы пользоваться кейсами'}); next(); }
function getCaseBalance(userId,cb){ ensureGameBalance(userId,cb); }

// ... (все роуты /api/cases/* — БЕЗ ИЗМЕНЕНИЙ, они у тебя правильные) ...

// ГЛАВНЫЙ ФИКС: PUT /api/admin/cases/catalog/:caseId — БЕЗ app, только db и fs
app.put('/api/admin/cases/catalog/:caseId', adminOnly, (req, res) => {
  const caseId = String(req.params.caseId || '');
  const incoming = req.body || {};
  const current = CASE_CATALOG.cases.find(c => String(c.id) === caseId);
  if (!current) return res.status(404).json({ error: 'Кейс не найден' });

  const price = Number(incoming.price);
  const chances = incoming.chances;

  if (!Number.isFinite(price) || price < 1 || price > 21)
    return res.status(400).json({ error: 'Цена кейса должна быть $1–$21' });
  if (!chances || typeof chances !== 'object' || Array.isArray(chances))
    return res.status(400).json({ error: 'Не переданы шансы кейса' });

  let sum = 0;
  const next = {};
  for (const id of current.items) {
    const value = Number(chances[id]);
    if (!Number.isFinite(value) || value < 0.05 || value > 65)
      return res.status(400).json({ error: `Шанс предмета ${id} должен быть 0,05–65%` });
    next[id] = Number(value.toFixed(4));
    sum += value;
  }
  if (Math.abs(sum - 100) > 0.02)
    return res.status(400).json({ error: `Сумма шансов должна быть 100% (сейчас ${sum.toFixed(2)}%)` });

  try {
    current.price = price;
    current.chances = next;
    const json = JSON.stringify(CASE_CATALOG, null, 2);
    fs.writeFileSync(CASE_CATALOG_FILE, json);
    fs.writeFileSync(CASE_CATALOG_PUBLIC_FILE, json);
    res.json({ ok: true });
  } catch (e) {
    console.error('case odds save:', e);
    res.status(500).json({ error: 'Не удалось сохранить настройки кейса' });
  }
});

// GET /api/cases/catalog — для сайта (публичный, без админки)
app.get('/api/cases/catalog', (req, res) => {
  try {
    const file = path.join(__dirname, 'cases-data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ... (остальные роуты — БЕЗ ИЗМЕНЕНИЙ) ...

db.ready.then(() => app.listen(PORT, () => {
  console.log(`BLUP запущен на порту ${PORT}`);
})).catch(err => { console.error('Ошибка:', err); process.exit(1); });
