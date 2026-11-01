const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { notifyAdmin } = require('./bot');
const { notifyNewUser } = require('./bot_register');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('ВНИМАНИЕ: задайте SESSION_SECRET в переменных окружения для постоянных сессий.');
if (!process.env.BLUP_ADMIN_PASSWORD) console.warn('Админ-вход отключён: задайте BLUP_ADMIN_PASSWORD.');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    db.get('SELECT sess, expires FROM sessions WHERE sid=?', [sid], (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) return this.destroy(sid, () => cb(null, null));
      try { cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); }
    });
  }
  set(sid, sess, cb = () => {}) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 86400000;
    db.run('INSERT INTO sessions(sid,sess,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires', [sid, JSON.stringify(sess), expires], cb);
  }
  destroy(sid, cb = () => {}) { db.run('DELETE FROM sessions WHERE sid=?', [sid], cb); }
  touch(sid, sess, cb = () => {}) { this.set(sid, sess, cb); }
}

app.use(session({
  name: 'blup.sid',
  secret: SESSION_SECRET,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const authAttempts = new Map();
function rateLimit(key, max = 12, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const item = authAttempts.get(key);
  if (!item || item.until < now) { authAttempts.set(key, { count: 1, until: now + windowMs }); return false; }
  item.count += 1;
  return item.count > max;
}
function ipOf(req) { return String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64); }
function getSetting(key, fallback, cb) {
  db.get('SELECT value FROM settings WHERE key=?', [key], (err, row) => cb(err, row ? row.value : fallback));
}
function setSetting(key, value, cb) { db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)], cb || (() => {})); }
function logVisit(user, ip, event) {
  db.run('INSERT INTO visits(user_id,nickname,ip,event) VALUES(?,?,?,?)', [user ? user.id : null, user ? user.nickname : null, ip, event]);
  if (user) db.run('UPDATE users SET last_ip=?, last_seen=CURRENT_TIMESTAMP WHERE id=?', [ip, user.id]);
}
function sendBlocked(res) { return res.status(403).json({ error: 'Аккаунт заблокирован. Обратитесь в поддержку.' }); }

// Enforce IP/account bans on every API request, not only on login.
app.use('/api', (req, res, next) => {
  const ip = ipOf(req);
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (err, ban) => {
    if (err) return res.status(500).json({ error: 'Ошибка проверки доступа' });
    if (ban) { if (req.session) req.session.destroy(() => {}); return sendBlocked(res); }
    if (!req.session || !req.session.userId) return next();
    db.get('SELECT id,nickname,is_banned,session_version FROM users WHERE id=?', [req.session.userId], (e, user) => {
      if (e) return res.status(500).json({ error: 'Ошибка проверки аккаунта' });
      if (!user || user.is_banned || user.session_version !== req.session.sessionVersion) {
        return req.session.destroy(() => sendBlocked(res));
      }
      db.run('UPDATE users SET last_ip=?,last_seen=CURRENT_TIMESTAMP WHERE id=?', [ip, user.id]);
      next();
    });
  });
});

// Режим техработ отображается на клиенте; API авторизации и регистрации остаются доступными.
app.get('/api/status', (req, res) => getSetting('stopped', '0', (e, stopped) => res.json({ stopped: stopped === '1' && req.session.isAdmin !== true })));
app.get('/api/config', (req, res) => {
  db.all('SELECT key,value FROM settings WHERE key IN (\'usdt_rate\',\'gram_rate\',\'reserve_total\',\'reserve_available\',\'banks\')', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка настроек' });
    const s = Object.fromEntries(rows.map(x => [x.key, x.value]));
    let banks = []; try { banks = JSON.parse(s.banks || '[]'); } catch {}
    res.json({ usdtRate: Number(s.usdt_rate || 0), gramRate: Number(s.gram_rate || 0), reserveTotal: Number(s.reserve_total || 0), reserveAvailable: Number(s.reserve_available || 0), banks });
  });
});

app.post('/api/register', (req, res) => {
  const ip = ipOf(req), nickname = String(req.body?.nickname || '').trim(), password = String(req.body?.password || '');
  if (rateLimit(`register:${ip}`, 8)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(nickname) || password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: 'Ник: 3–24 символа (буквы, цифры, _ или -). Пароль — не менее 10 символов.' });
  }
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (e, ban) => {
    if (e) return res.status(500).json({ error: 'Ошибка БД' });
    if (ban) return sendBlocked(res);
    db.get('SELECT id FROM users WHERE nickname=? COLLATE NOCASE', [nickname], (err, existing) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      if (existing) return res.status(409).json({ error: 'Такой ник уже занят' });
      const hash = bcrypt.hashSync(password, 12);
      db.run('INSERT INTO users(nickname,password_hash,last_ip,last_seen) VALUES(?,?,?,CURRENT_TIMESTAMP)', [nickname, hash, ip], function(insertErr) {
        if (insertErr) return res.status(500).json({ error: 'Не удалось создать аккаунт' });
        const user = { id: this.lastID, nickname, sessionVersion: 0 };
        req.session.regenerate(regErr => {
          if (regErr) return res.status(500).json({ error: 'Не удалось создать сессию' });
          req.session.userId = user.id; req.session.nickname = nickname; req.session.sessionVersion = 0;
          logVisit(user, ip, 'register');
          // Never send/store a plaintext password in Telegram or logs.
          notifyNewUser(nickname).catch(() => {});
          req.session.save(() => res.json({ ok: true, nickname }));
        });
      });
    });
  });
});

app.post('/api/login', (req, res) => {
  const ip = ipOf(req), nickname = String(req.body?.nickname || '').trim(), password = String(req.body?.password || '');
  if (rateLimit(`login:${ip}`, 12)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (e, ban) => {
    if (e) return res.status(500).json({ error: 'Ошибка БД' });
    if (ban) return sendBlocked(res);
    db.get('SELECT * FROM users WHERE nickname=? COLLATE NOCASE', [nickname], (err, user) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Неверный ник или пароль' });
      if (user.is_banned) return sendBlocked(res);
      req.session.regenerate(regErr => {
        if (regErr) return res.status(500).json({ error: 'Не удалось создать сессию' });
        req.session.userId = user.id; req.session.nickname = user.nickname; req.session.sessionVersion = user.session_version || 0;
        logVisit(user, ip, 'login');
        req.session.save(() => res.json({ ok: true, nickname: user.nickname }));
      });
    });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('blup.sid'); res.json({ ok: true }); }));
app.get('/api/me', (req, res) => res.json({ nickname: req.session.nickname || null }));

app.get('/api/history', (req, res) => {
  const query = req.session.userId
    ? ['SELECT id,nickname,coin,network,operation_type,status,amount,created_at FROM sales WHERE user_id=? ORDER BY id DESC LIMIT 100', [req.session.userId]]
    : ['SELECT id,nickname,coin,network,operation_type,status,amount,created_at FROM sales WHERE user_id IS NULL ORDER BY id DESC LIMIT 50', []];
  db.all(query[0], query[1], (err, rows) => err ? res.status(500).json({ error: 'Не удалось загрузить историю' }) : res.json(rows || []));
});

app.post('/api/sell', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы отправить заявку.' });
  getSetting('stopped', '0', (e, stopped) => {
    if (e) return res.status(500).json({ error: 'Ошибка настроек' });
    if (stopped === '1' && req.session.isAdmin !== true) return res.status(403).json({ error: 'Приём заявок временно приостановлен.' });
    const { coin, network, wallet, memo, payoutType, payoutValue, bank, operationType = 'sell', amount } = req.body || {};
    const asset = String(coin || '').toUpperCase();
    const net = String(network || '');
    const addr = String(wallet || '').trim();
    const payout = String(payoutValue || '').trim();
    const bankName = String(bank || '').trim();
    const op = operationType === 'withdraw' ? 'withdraw' : 'sell';
    const qty = Number(amount || 0);
    const validNetwork = ['BEP20','TRC20','ERC20','TON','SPL'];
    if ((op === 'sell' && !['USDT','GRAM'].includes(asset)) || (op === 'withdraw' && asset !== 'USD') || (op === 'sell' && (!addr || addr.length > 180)) || !payout || payout.length > 100 || !bankName) return res.status(400).json({ error: 'Проверьте обязательные поля заявки.' });
    if (op === 'sell' && asset === 'USDT' && !validNetwork.includes(net)) return res.status(400).json({ error: 'Выберите сеть USDT.' });
    if (op === 'sell' && asset === 'GRAM' && net !== 'TON') return res.status(400).json({ error: 'Для GRAM используется сеть TON.' });
    if (op === 'withdraw' && (!Number.isFinite(qty) || qty <= 0 || qty > 1000000)) return res.status(400).json({ error: 'Укажите корректную сумму вывода.' });
    if (op === 'withdraw') {
      db.run('UPDATE settings SET value=CAST(value AS REAL)-? WHERE key=\'reserve_available\' AND CAST(value AS REAL)>=?', [qty, qty], function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка резерва' });
        if (!this.changes) return res.status(400).json({ error: 'Недостаточно доступного резерва для этой суммы.' });
        insertRequest();
      });
    } else insertRequest();
    function insertRequest() {
      db.run(`INSERT INTO sales(user_id,nickname,coin,network,wallet,phone,bank,operation_type,memo,payout_type,amount,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')`,
        [req.session.userId, req.session.nickname, asset, op === 'withdraw' ? 'Вывод с сайта' : (asset === 'GRAM' ? 'TON' : net), op === 'withdraw' ? '—' : addr, payout, bankName, op, String(memo || '').slice(0,120), String(payoutType || 'phone'), qty],
        function(err) {
          if (err) {
            if (op === 'withdraw') db.run("UPDATE settings SET value=CAST(value AS REAL)+? WHERE key='reserve_available'", [qty]);
            return res.status(500).json({ error: 'Не удалось сохранить заявку' });
          }
          const sale = { id: this.lastID, nickname: req.session.nickname, coin: asset, network: op === 'withdraw' ? 'Вывод с сайта' : (asset === 'GRAM' ? 'TON' : net), wallet: addr, phone: payout, bank: `${bankName} / ${payoutType || 'phone'}${op === 'withdraw' ? ` / сумма: ${qty} USD` : ''}`, memo: String(memo || '') };
          notifyAdmin(sale).catch(() => {});
          res.json({ ok: true, id: this.lastID });
        });
    }
  });
});

function adminOnly(req, res, next) { if (req.session.isAdmin === true) return next(); return res.status(403).json({ error: 'Доступ запрещён' }); }
app.post('/api/admin/login', (req, res) => {
  const ip = ipOf(req);
  if (rateLimit(`admin:${ip}`, 5)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
  const expected = process.env.BLUP_ADMIN_PASSWORD;
  const supplied = String(req.body?.password || '');
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(403).json({ error: 'Неверный пароль администратора' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Ошибка сессии' });
    req.session.isAdmin = true;
    req.session.save(() => res.json({ ok: true }));
  });
});
app.post('/api/admin/logout', adminOnly, (req, res) => req.session.destroy(() => { res.clearCookie('blup.sid'); res.json({ ok: true }); }));
app.get('/api/admin/me', (req, res) => res.json({ isAdmin: req.session.isAdmin === true }));
app.get('/api/admin/overview', adminOnly, (req, res) => {
  db.get('SELECT COUNT(*) AS users, SUM(CASE WHEN is_banned=1 THEN 1 ELSE 0 END) AS banned FROM users', [], (e, stats) => {
    if (e) return res.status(500).json({ error: 'Ошибка БД' });
    db.get("SELECT COUNT(*) AS pending FROM sales WHERE status='pending'", [], (e2, pending) => {
      db.all('SELECT id,nickname,created_at,last_ip,last_seen,is_banned,ban_reason FROM users ORDER BY id DESC LIMIT 300', [], (e3, users) => {
        db.all('SELECT id,user_id,nickname,coin,network,operation_type,amount,status,created_at,wallet,phone,bank,memo,payout_type FROM sales ORDER BY id DESC LIMIT 300', [], (e4, sales) => {
          db.all('SELECT ip,reason,created_at FROM ip_bans ORDER BY created_at DESC', [], (e5, bans) => {
            db.all('SELECT user_id,nickname,ip,event,created_at FROM visits ORDER BY id DESC LIMIT 200', [], (e7, visits) => {
              if (e2 || e3 || e4 || e5 || e7) return res.status(500).json({ error: 'Ошибка загрузки панели' });
              db.all('SELECT key,value FROM settings', [], (e6, rows) => {
                const settings = Object.fromEntries(rows.map(x => [x.key, x.value]));
                res.json({ stats: { users: stats.users || 0, banned: stats.banned || 0, pending: pending.pending || 0 }, users: users || [], sales: sales || [], ipBans: bans || [], visits: visits || [], settings });
              });
            });
          });
        });
      });
    });
  });
});
app.post('/api/admin/settings', adminOnly, (req, res) => {
  const { usdtRate, gramRate, reserveTotal, reserveAvailable, banks, stopped } = req.body || {};
  const values = [usdtRate, gramRate, reserveTotal, reserveAvailable].map(Number);
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 1e12) || values[3] > values[2]) return res.status(400).json({ error: 'Проверьте курсы и значения резерва.' });
  if (!Array.isArray(banks) || banks.length > 100 || banks.some(x => typeof x !== 'string' || !x.trim() || x.length > 80)) return res.status(400).json({ error: 'Некорректный список банков.' });
  db.serialize(() => {
    const pairs = [['usdt_rate', values[0]], ['gram_rate', values[1]], ['reserve_total', values[2]], ['reserve_available', values[3]], ['banks', JSON.stringify([...new Set(banks.map(x => x.trim()))])], ['stopped', stopped ? '1' : '0']];
    const stmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    pairs.forEach(p => stmt.run(p[0], String(p[1])));
    stmt.finalize(err => err ? res.status(500).json({ error: 'Не удалось сохранить настройки' }) : res.json({ ok: true }));
  });
});
app.post('/api/admin/users/:id/ban', adminOnly, (req, res) => {
  const id = Number(req.params.id), banned = !!req.body?.banned, reason = String(req.body?.reason || '').slice(0,200);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Некорректный ID' });
  db.run('UPDATE users SET is_banned=?,ban_reason=?,session_version=session_version+1 WHERE id=?', [banned ? 1 : 0, banned ? reason : null, id], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    if (!this.changes) return res.status(404).json({ error: 'Пользователь не найден' });
    db.get('SELECT id,nickname,last_ip FROM users WHERE id=?', [id], (e, user) => {
      if (banned && user?.last_ip) db.run('INSERT OR IGNORE INTO ip_bans(ip,reason) VALUES(?,?)', [user.last_ip, reason || 'Блокировка аккаунта']);
      res.json({ ok: true });
    });
  });
});
app.post('/api/admin/ip-ban', adminOnly, (req, res) => {
  const ip = String(req.body?.ip || '').trim(), reason = String(req.body?.reason || '').slice(0,200);
  if (!ip || ip.length > 64 || /[\s,;]/.test(ip)) return res.status(400).json({ error: 'Укажите корректный IP.' });
  db.run('INSERT INTO ip_bans(ip,reason) VALUES(?,?) ON CONFLICT(ip) DO UPDATE SET reason=excluded.reason', [ip, reason], err => err ? res.status(500).json({ error: 'Ошибка БД' }) : res.json({ ok: true }));
});
app.delete('/api/admin/ip-ban/:ip', adminOnly, (req, res) => {
  db.run('DELETE FROM ip_bans WHERE ip=?', [req.params.ip], err => err ? res.status(500).json({ error: 'Ошибка БД' }) : res.json({ ok: true }));
});
// Remove only finalized requests; active requests are deliberately preserved.
app.delete('/api/admin/sales', adminOnly, (req, res) => {
  db.run("DELETE FROM sales WHERE status IN ('completed','rejected')", function(err) {
    if (err) return res.status(500).json({ error: 'Не удалось очистить историю заявок' });
    res.json({ ok: true, deleted: this.changes });
  });
});

app.post('/api/admin/sales/:id/status', adminOnly, (req, res) => {
  const id = Number(req.params.id), status = String(req.body?.status || '');
  if (!['pending','processing','completed','rejected'].includes(status)) return res.status(400).json({ error: 'Некорректный статус' });
  db.get('SELECT * FROM sales WHERE id=?', [id], (err, sale) => {
    if (err || !sale) return res.status(404).json({ error: 'Заявка не найдена' });
    if (sale.operation_type === 'withdraw' && sale.status !== status) {
      if (sale.status !== 'rejected' && status === 'rejected') {
        db.run("UPDATE settings SET value=MIN(CAST((SELECT value FROM settings WHERE key='reserve_total') AS REAL), CAST(value AS REAL)+?) WHERE key='reserve_available'", [sale.amount || 0], e => {
          if (e) return res.status(500).json({ error: 'Ошибка резерва' });
          db.run('UPDATE sales SET status=? WHERE id=?', [status, id], e2 => e2 ? res.status(500).json({ error: 'Ошибка обновления' }) : res.json({ ok: true }));
        });
      } else if (sale.status === 'rejected' && status !== 'rejected') {
        db.run("UPDATE settings SET value=CAST(value AS REAL)-? WHERE key='reserve_available' AND CAST(value AS REAL)>=?", [sale.amount || 0, sale.amount || 0], function(e) {
          if (e) return res.status(500).json({ error: 'Ошибка резерва' });
          if (!this.changes) return res.status(400).json({ error: 'Недостаточно резерва, чтобы вернуть заявку в работу.' });
          db.run('UPDATE sales SET status=? WHERE id=?', [status, id], e2 => e2 ? res.status(500).json({ error: 'Ошибка обновления' }) : res.json({ ok: true }));
        });
      } else db.run('UPDATE sales SET status=? WHERE id=?', [status, id], e => e ? res.status(500).json({ error: 'Ошибка обновления' }) : res.json({ ok: true }));
    } else db.run('UPDATE sales SET status=? WHERE id=?', [status, id], e => e ? res.status(500).json({ error: 'Ошибка обновления' }) : res.json({ ok: true }));
  });
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.ready.then(() => app.listen(PORT, () => console.log(`BLUP запущен на порту ${PORT}`))).catch(err => { console.error('Ошибка подготовки БД:', err); process.exit(1); });
