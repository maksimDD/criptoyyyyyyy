const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { notifyAdmin } = require('./bot');
const { notifyNewUser } = require('./bot_register');

const app = express();
const BLUP_WALLETS = { USDT: { BEP20:'0x4eb35b332de372683aD24d7377abFa53F89451E4', TRC20:'TWCzWBarQUEfDd9pHYUwT5Chxr37e6Cdod', ERC20:'0xefF29984a72b0CFf45c57210f7Df8B60340724C5', TON:'UQDm8YmLVhliKT_SLlxw0yvi3rv91FFkxlbDnY0dDZ_Kb5r2', SPL:'3J5d7AadxyoVwh97ALxPW1h1m35bSVcgoPY3cHdMuMmR' }, GRAM: { TON:'UQDm8YmLVhliKT_SLlxw0yvi3rv91FFkxlbDnY0dDZ_Kb5r2' } };
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
    res.json({ usdtRate: Number(s.usdt_rate || 0), gramRate: Number(s.gram_rate || 0), reserveTotal: Number(s.reserve_total || 0), reserveAvailable: Number(s.reserve_available || 0), banks, wallets: BLUP_WALLETS });
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
      let publicId; const pickId = cb => { const n=Math.floor(Math.random()*99999)+1; db.get('SELECT id FROM users WHERE public_id=?',[n],(e,row)=>row?pickId(cb):cb(n)); }; pickId(publicIdValue => { publicId=publicIdValue; db.run('INSERT INTO users(nickname,password_hash,last_ip,last_seen,public_id) VALUES(?,?,?,CURRENT_TIMESTAMP,?)', [nickname, hash, ip, publicId], function(insertErr) {
        if (insertErr) return res.status(500).json({ error: 'Не удалось создать аккаунт' });
        const user = { id: this.lastID, nickname, sessionVersion: 0 };
        req.session.regenerate(regErr => {
          if (regErr) return res.status(500).json({ error: 'Не удалось создать сессию' });
          req.session.userId = user.id; req.session.nickname = nickname; req.session.sessionVersion = 0;
          logVisit(user, ip, 'register');
          // Never send/store a plaintext password in Telegram or logs.
          notifyNewUser({nickname, publicId}).catch(() => {});
          req.session.save(() => res.json({ ok: true, nickname, publicId }));
        });
      }); });
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

app.get('/api/profile', (req,res) => {
  if(!req.session.userId) return res.status(401).json({error:'Войдите в аккаунт'});
  db.get(`SELECT u.nickname,u.public_id,u.created_at,COALESCE(SUM(CASE WHEN s.operation_type='sell' AND s.status='completed' THEN s.amount ELSE 0 END),0) sold_usd
    FROM users u LEFT JOIN sales s ON s.user_id=u.id WHERE u.id=? GROUP BY u.id`,[req.session.userId],(e,row)=>e?res.status(500).json({error:'Ошибка профиля'}):res.json(row||{}));
});
app.post('/api/sell',(req,res)=>{
 if(!req.session.userId)return res.status(401).json({error:'Войдите в аккаунт'});
 getSetting('stopped','0',(me,stopped)=>{if(stopped==='1'&&req.session.isAdmin!==true)return res.status(403).json({error:'Приём заявок временно приостановлен.'});
 const coin=String(req.body?.coin||'').toUpperCase(), network=String(req.body?.network||''), amount=Number(req.body?.amount), comment=String(req.body?.comment||'').slice(0,500), tg=String(req.body?.telegramUsername||'').trim().replace(/^@/, '');
 if(!['USDT','GRAM'].includes(coin)||!(coin==='GRAM'?network==='TON':['BEP20','TRC20','ERC20','TON','SPL'].includes(network))||!BLUP_WALLETS[coin]?.[network]||!Number.isFinite(amount)||amount<=0||amount>1000000||!/^([A-Za-z0-9_]{5,32})$/.test(tg))return res.status(400).json({error:'Проверьте монету, сеть, сумму и Telegram username.'});
 db.run(`INSERT INTO sales(user_id,nickname,coin,network,destination_wallet,operation_type,amount,memo,comment,status) VALUES(?,?,?,?,?,'sell',?,?,?,'pending')`,[req.session.userId,req.session.nickname,coin,network,BLUP_WALLETS[coin][network],amount,'',comment],function(e){if(e)return res.status(500).json({error:'Не удалось создать заявку'});const item={id:this.lastID,nickname:req.session.nickname,coin,network,amount,comment,telegramUsername:tg,created_at:new Date().toISOString()};notifyAdmin(item).catch(()=>{});db.run('UPDATE users SET telegram_username=? WHERE id=?',[tg,req.session.userId]);res.json({ok:true,id:this.lastID});});
 });
});
app.post('/api/withdraw',(req,res)=>{
 if(!req.session.userId)return res.status(401).json({error:'Войдите в аккаунт'});
 const saleId=Number(req.body?.saleId), payoutType=String(req.body?.payoutType||'phone'), payout=String(req.body?.payoutValue||'').trim(), bank=String(req.body?.bank||'').trim();
 db.get("SELECT * FROM sales WHERE id=? AND user_id=? AND operation_type='sell' AND status='completed'",[saleId,req.session.userId],(e,sale)=>{
  if(e||!sale)return res.status(400).json({error:'Вывод доступен только после одобрения продажи'});
  const rateKey=sale.coin==='GRAM'?'gram_rate':'usdt_rate';getSetting(rateKey,'0',(err,rateRaw)=>{const rate=Number(rateRaw),usd=Number(req.body?.amount||sale.amount);if(err||!rate||!Number.isFinite(usd)||usd<=0||usd>sale.amount||!payout||payout.length>100||!bank||!['phone','card'].includes(payoutType))return res.status(400).json({error:'Проверьте сумму, курс и банковские реквизиты'});const rub=Number((usd*rate).toFixed(2));db.run(`INSERT INTO sales(user_id,nickname,coin,network,operation_type,amount,payout_rub,phone,bank,payout_type,parent_sale_id,status) VALUES(?,?,?,?,'withdraw',?,?,?,?,?,?, 'pending')`,[req.session.userId,req.session.nickname,sale.coin,sale.network,usd,rub,payout,bank,payoutType,saleId],function(ins){if(ins)return res.status(500).json({error:'Не удалось создать заявку на вывод'});notifyAdmin({id:this.lastID,nickname:req.session.nickname,coin:sale.coin,network:sale.network,amount:usd,payoutRub:rub,phone:payout,bank,operation:'withdraw'}).catch(()=>{});res.json({ok:true,id:this.lastID,usd,rub,rate});});});
 });
});
app.get('/api/withdraw/eligible',(req,res)=>{if(!req.session.userId)return res.status(401).json({error:'Войдите'});db.all("SELECT id,coin,network,amount,created_at FROM sales WHERE user_id=? AND operation_type='sell' AND status='completed' ORDER BY id DESC",[req.session.userId],(e,rows)=>e?res.status(500).json({error:'Ошибка'}):res.json(rows));});
app.get('/api/promos',(req,res)=>db.all('SELECT code,description,reward_type,reward_value FROM promos WHERE active=1 ORDER BY id DESC',(e,rows)=>e?res.status(500).json({error:'Ошибка'}):res.json(rows)));
app.post('/api/promos/apply',(req,res)=>{if(!req.session.userId)return res.status(401).json({error:'Войдите в аккаунт'});const code=String(req.body?.code||'').trim();db.get('SELECT code,description,reward_type,reward_value FROM promos WHERE code=? COLLATE NOCASE AND active=1',[code],(e,row)=>e||!row?res.status(404).json({error:'Промокод не найден или неактивен'}):res.json({ok:true,promo:row}));});

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
app.post('/api/admin/maintenance', adminOnly, (req, res) => setSetting('stopped', req.body?.stopped ? '1' : '0', err => err ? res.status(500).json({ error: 'Не удалось изменить режим техработ' }) : res.json({ ok: true, stopped: !!req.body?.stopped })));
app.get('/api/admin/me', (req, res) => res.json({ isAdmin: req.session.isAdmin === true }));
app.get('/api/admin/overview', adminOnly, (req, res) => {
  db.get('SELECT COUNT(*) AS users, SUM(CASE WHEN is_banned=1 THEN 1 ELSE 0 END) AS banned FROM users', [], (e, stats) => {
    if (e) return res.status(500).json({ error: 'Ошибка БД' });
    db.get("SELECT COUNT(*) AS pending FROM sales WHERE status='pending'", [], (e2, pending) => {
      db.all('SELECT id,nickname,created_at,last_ip,last_seen,is_banned,ban_reason FROM users ORDER BY id DESC LIMIT 300', [], (e3, users) => {
        db.all('SELECT id,user_id,nickname,coin,network,operation_type,amount,payout_rub,status,created_at,wallet,destination_wallet,phone,bank,memo,payout_type,comment,parent_sale_id FROM sales ORDER BY id DESC LIMIT 300', [], (e4, sales) => {
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
  const { usdtRate, gramRate, reserveTotal, reserveAvailable, banks } = req.body || {};
  const values = [usdtRate, gramRate, reserveTotal, reserveAvailable].map(Number);
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 1e12) || values[3] > values[2]) return res.status(400).json({ error: 'Проверьте курсы и значения резерва.' });
  if (!Array.isArray(banks) || banks.length > 100 || banks.some(x => typeof x !== 'string' || !x.trim() || x.length > 80)) return res.status(400).json({ error: 'Некорректный список банков.' });
  db.serialize(() => {
    const pairs = [['usdt_rate', values[0]], ['gram_rate', values[1]], ['reserve_total', values[2]], ['reserve_available', values[3]], ['banks', JSON.stringify([...new Set(banks.map(x => x.trim()))])]];
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
app.post('/api/admin/promos',adminOnly,(req,res)=>{const code=String(req.body?.code||'').trim().toUpperCase(),type=String(req.body?.rewardType||'info'),value=Number(req.body?.rewardValue||0),description=String(req.body?.description||'').slice(0,200);if(!/^[A-Z0-9_-]{3,24}$/.test(code)||!['info','percent','fixed'].includes(type)||!Number.isFinite(value)||value<0||value>1000000)return res.status(400).json({error:'Проверьте данные промокода'});db.run('INSERT INTO promos(code,reward_type,reward_value,description) VALUES(?,?,?,?)',[code,type,value,description],e=>e?res.status(409).json({error:'Такой промокод уже существует'}):res.json({ok:true}));});
app.get('/api/admin/promos',adminOnly,(req,res)=>db.all('SELECT * FROM promos ORDER BY id DESC',(e,rows)=>e?res.status(500).json({error:'Ошибка'}):res.json(rows)));
app.post('/api/admin/promos/:id/toggle',adminOnly,(req,res)=>db.run('UPDATE promos SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?',[Number(req.params.id)],function(e){e?res.status(500).json({error:'Ошибка'}):res.json({ok:true});}));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.ready.then(() => app.listen(PORT, () => console.log(`BLUP запущен на порту ${PORT}`))).catch(err => { console.error('Ошибка подготовки БД:', err); process.exit(1); });
