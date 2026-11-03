const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');
const { notifyAdmin } = require('./bot');
const { notifyNewUser } = require('./bot_register');

const app = express();
const BLUP_WALLETS = { USDT: { BEP20:'0x4eb35b332de372683aD24d7377abFa53F89451E4', TRC20:'TWCzWBarQUEfDd9pHYUwT5Chxr37e6Cdod', ERC20:'0xefF29984a72b0CFf45c57210f7Df8B60340724C5', TON:'UQDm8YmLVhliKT_SLlxw0yvi3rv91FFkxlbDnY0dDZ_Kb5r2', SPL:'3J5d7AadxyoVwh97ALxPW1h1m35bSVcgoPY3cHdMuMmR' }, GRAM: { TON:'UQDm8YmLVhliKT_SLlxw0yvi3rv91FFkxlbDnY0dDZ_Kb5r2' } };
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
app.use(express.json({ limit: '32kb' }));

class SQLiteSessionStore extends session.Store {
  get(sid, cb) { db.get('SELECT sess, expires FROM sessions WHERE sid=?', [sid], (err, row) => { if (err) return cb(err); if (!row) return cb(null, null); if (row.expires < Date.now()) return this.destroy(sid, () => cb(null, null)); try { cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); } }); }
  set(sid, sess, cb = () => {}) { const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 86400000; db.run('INSERT INTO sessions(sid,sess,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires', [sid, JSON.stringify(sess), expires], cb); }
  destroy(sid, cb = () => {}) { db.run('DELETE FROM sessions WHERE sid=?', [sid], cb); }
  touch(sid, sess, cb = () => {}) { this.set(sid, sess, cb); }
}

app.use(session({ name: 'blup.sid', secret: SESSION_SECRET, store: new SQLiteSessionStore(), resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 } }));
app.use(express.static(path.join(__dirname, 'public')));

const onlineUsers = new Map();
app.use((req, res, next) => {
  if (req.path.startsWith('/api/online') || req.path.match(/\.(css|js|png|jpg|svg|ico|woff|woff2)$/)) return next();
  const identifier = req.session?.userId ? `user_${req.session.userId}` : `ip_${ipOf(req)}`;
  onlineUsers.set(identifier, Date.now());
  next();
});
app.get('/api/online', (req, res) => { const now = Date.now(); let count = 0; onlineUsers.forEach((l, id) => { if (now - l < 300000) count++; else onlineUsers.delete(id); }); res.json({ online: count > 0 ? count : 1 }); });

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

// Конфиг для Telegram-входа (используем первый токен)
app.get('/api/auth/telegram/config', (req, res) => { 
  const token = process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI'; 
  if (!token) return res.status(503).json({ error: 'Нет токена' }); 
  const botId = token.split(':')[0]; 
  if (!botId || isNaN(botId)) return res.status(503).json({ error: 'Некорректный токен' }); 
  res.json({ botId }); 
});

app.post('/api/register', (req, res) => {
  const ip = ipOf(req), nickname = String(req.body?.nickname || '').trim(), password = String(req.body?.password || ''), refCode = req.body?.ref;
  if (rateLimit(`reg:${ip}`, 8)) return res.status(429).json({ error: 'Много попыток' });
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(nickname) || password.length < 10) return res.status(400).json({ error: 'Ошибка в нике или пароле' });
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (e, ban) => {
    if (ban) return sendBlocked(res);
    db.get('SELECT id FROM users WHERE nickname=? COLLATE NOCASE', [nickname], (err, existing) => {
      if (existing) return res.status(409).json({ error: 'Ник занят' });
      const hash = bcrypt.hashSync(password, 12);
      let publicId; const pickId = cb => { const n=Math.floor(Math.random()*99999)+1; db.get('SELECT id FROM users WHERE public_id=?',[n],(e,row)=>row?pickId(cb):cb(n)); }; 
      pickId(publicIdValue => { 
        publicId=publicIdValue; 
        db.run('INSERT INTO users(nickname,password_hash,last_ip,last_seen,public_id) VALUES(?,?,?,CURRENT_TIMESTAMP,?)', [nickname, hash, ip, publicId], function(insertErr) {
          if (insertErr) return res.status(500).json({ error: 'Ошибка БД' });
          const newUserId = this.lastID;
          req.session.regenerate(regErr => {
            if (regErr) return res.status(500).json({ error: 'Ошибка сессии' });
            req.session.userId = newUserId; req.session.nickname = nickname; req.session.sessionVersion = 0;
            logVisit({ id: newUserId, nickname }, ip, 'register');
            notifyNewUser({nickname, publicId}).catch(() => {});
            if (refCode) {
              db.get('SELECT user_id FROM user_referrals WHERE ref_code=?', [refCode], (rErr, refRow) => {
                if (refRow) db.run('UPDATE users SET referred_by=? WHERE id=?', [refRow.user_id, newUserId]);
              });
            }
            req.session.save(() => res.json({ ok: true, nickname, publicId }));
          });
        });
      });
    });
  });
});

app.post('/api/login', (req, res) => {
  const ip = ipOf(req), nickname = String(req.body?.nickname || '').trim(), password = String(req.body?.password || '');
  if (rateLimit(`login:${ip}`, 12)) return res.status(429).json({ error: 'Много попыток' });
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (e, ban) => {
    if (ban) return sendBlocked(res);
    db.get('SELECT * FROM users WHERE nickname=? COLLATE NOCASE', [nickname], (err, user) => {
      if (err || !user || !bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Неверный ник или пароль' });
      if (user.is_banned) return sendBlocked(res);
      req.session.regenerate(regErr => {
        req.session.userId = user.id; req.session.nickname = user.nickname; req.session.sessionVersion = user.session_version || 0;
        logVisit(user, ip, 'login');
        req.session.save(() => res.json({ ok: true, nickname: user.nickname }));
      });
    });
  });
});

app.post('/api/auth/telegram', (req, res) => {
  const ip = ipOf(req);
  const data = req.body || {};
  const tgToken = process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI'; // Изменил имя переменной
  if (!data.id || !data.auth_date || !data.hash) return res.status(400).json({ error: 'Ошибка' });
  if (rateLimit(`tg:${ip}`, 20)) return res.status(429).json({ error: 'Много попыток' });
  if (Math.floor(Date.now()/1000) - Number(data.auth_date) > 300) return res.status(400).json({ error: 'Устарело' });
  
  const secret = crypto.createHash('sha256').update(tgToken).digest();
  const checkString = Object.keys(data).filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== data.hash) return res.status(403).json({ error: 'Неверная подпись' });

  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (e, ban) => {
    if (ban) return sendBlocked(res);
    const finishLogin = user => {
      if (!user || user.is_banned) return sendBlocked(res);
      req.session.regenerate(regErr => {
        req.session.userId = user.id; req.session.nickname = user.nickname; req.session.sessionVersion = user.session_version || 0;
        logVisit(user, ip, 'login_telegram');
        if (user.isNew) notifyNewUser({ nickname: user.nickname, publicId: user.public_id, telegramId: data.id, telegramUsername: data.username || 'нет' }).catch(() => {});
        req.session.save(() => res.json({ ok: true, nickname: user.nickname }));
      });
    };
    db.get('SELECT * FROM users WHERE telegram_id=?', [data.id], (err, byTg) => {
      if (byTg) {
        db.run(`UPDATE users SET telegram_username=?, last_ip=?, last_seen=CURRENT_TIMESTAMP WHERE id=?`, [data.username || null, ip, byTg.id]);
        return finishLogin(byTg);
      }
      const baseNick = (data.username || `tg_${data.id}`).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20) || `tg_${data.id}`;
      const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
      let publicId; const pickId = cb => { const n = Math.floor(Math.random()*99999)+1; db.get('SELECT id FROM users WHERE public_id=?',[n],(e,row)=>row?pickId(cb):cb(n)); };
      pickId(pid => {
        publicId = pid;
        const tryInsert = (nick, cb) => {
          db.run(`INSERT INTO users(nickname,password_hash,last_ip,last_seen,public_id,telegram_id,telegram_username) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?)`,
            [nick, randomHash, ip, pid, data.id, data.username||null], function(insErr) {
              if (insErr) return cb(insErr);
              cb(null, { id: this.lastID, nickname: nick, session_version: 0, is_banned: 0 });
            });
        };
        tryInsert(baseNick, (err1, user1) => {
          if (!err1) { user1.isNew = true; user1.public_id = pid; return finishLogin(user1); }
          tryInsert(`${baseNick}_${data.id}`.slice(0,24), (err2, user2) => {
            if (err2) return res.status(500).json({ error: 'Ошибка' });
            user2.isNew = true; user2.public_id = pid; finishLogin(user2);
          });
        });
      });
    });
  });
});

app.post('/api/auth/link-telegram', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите' });
  const data = req.body || {};
  const linkToken = process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI'; // Изменил имя переменной
  if (!data.id || !data.auth_date || !data.hash) return res.status(400).json({ error: 'Ошибка' });
  if (Math.floor(Date.now()/1000) - Number(data.auth_date) > 300) return res.status(400).json({ error: 'Устарело' });
  
  const secret = crypto.createHash('sha256').update(linkToken).digest();
  const checkString = Object.keys(data).filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== data.hash) return res.status(403).json({ error: 'Неверная подпись' });

  db.get('SELECT id FROM users WHERE telegram_id=? AND id!=?', [data.id, req.session.userId], (err, existing) => {
    if (existing) return res.status(409).json({ error: 'TG уже привязан к другому' });
    db.run(`UPDATE users SET telegram_id=?, telegram_username=? WHERE id=?`, [data.id, data.username || null, req.session.userId], function() {
      res.json({ ok: true });
    });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('blup.sid'); res.json({ ok: true }); }));
app.get('/api/me', (req, res) => res.json({ nickname: req.session.nickname || null }));

app.get('/api/history', (req, res) => {
  const q = req.session.userId ? ["SELECT id,nickname,coin,network,operation_type,status,amount,created_at FROM sales WHERE user_id=? AND operation_type='sell' ORDER BY id DESC LIMIT 100", [req.session.userId]] : ["SELECT id,nickname,coin,network,operation_type,status,amount,created_at FROM sales WHERE user_id IS NULL ORDER BY id DESC LIMIT 50", []];
  db.all(q[0], q[1], (err, rows) => err ? res.status(500).json({ error: 'Ошибка' }) : res.json(rows || []));
});

app.get('/api/profile', (req,res) => {
  if(!req.session.userId) return res.status(401).json({error:'Войдите'});
  db.get(`SELECT u.nickname,u.public_id,u.created_at,u.telegram_id,u.telegram_username,
            COALESCE(SUM(CASE WHEN s.operation_type='sell' AND s.status='completed' THEN s.amount ELSE 0 END),0) sold_usd,
            COALESCE((SELECT percent FROM user_discounts WHERE user_id=u.id AND active=1),0) discount_percent
          FROM users u LEFT JOIN sales s ON s.user_id=u.id WHERE u.id=? GROUP BY u.id`,
    [req.session.userId], (e,row) => {
      if (e) return res.status(500).json({error:'Ошибка'});
      db.all('SELECT id,percent,created_at FROM user_coupons WHERE user_id=? AND used_at IS NULL ORDER BY id ASC', [req.session.userId], (e2, coupons) => {
        res.json({ ...row, coupons: coupons || [], is_telegram: !!row.telegram_id });
      });
    });
});

app.post('/api/sell',(req,res)=>{
 if(!req.session.userId)return res.status(401).json({error:'Войдите'});
 getSetting('stopped','0',(me,stopped)=>{if(stopped==='1'&&req.session.isAdmin!==true)return res.status(403).json({error:'Техработы'});
 const coin=String(req.body?.coin||'').toUpperCase(), network=String(req.body?.network||''), amount=Number(req.body?.amount), comment=String(req.body?.comment||'').slice(0,500), tg=String(req.body?.telegramUsername||'').trim().replace(/^@/, ''), payoutType=String(req.body?.payoutType||'phone'), payout=String(req.body?.payoutValue||'').trim(), bank=String(req.body?.bank||'').trim();
 if(!BLUP_WALLETS[coin]?.[network] || !amount || !tg || !payout || !bank)return res.status(400).json({error:'Ошибка данных'});
 db.get('SELECT value FROM settings WHERE key=?',['usdt_rate'],(rateErr,usdtRow)=>{db.get('SELECT value FROM settings WHERE key=?',['gram_rate'],(gramErr,gramRow)=>{const rate=Number(coin==='USDT'?usdtRow?.value:gramRow?.value)||0;if(rate<=0)return res.status(400).json({error:'Курс не задан'});
   db.get('SELECT percent FROM user_discounts WHERE user_id=? AND active=1',[req.session.userId],(de,discountRow)=>{
     const manualPercent=[1,3].includes(Number(discountRow?.percent))?Number(discountRow.percent):0;
     db.get('SELECT id,percent FROM user_coupons WHERE user_id=? AND used_at IS NULL AND percent IN (1,3) ORDER BY id ASC LIMIT 1',[req.session.userId],(ce,coupon)=>{
       const couponPercent=coupon?Number(coupon.percent):0;
       const chosenPercent=Math.max(manualPercent,couponPercent);
       const discountApplied=!!req.body?.applyDiscount&&chosenPercent>0;
       const payoutRub=Number((amount*rate*(discountApplied?1+chosenPercent/100:1)).toFixed(2));
       db.run(`INSERT INTO sales(user_id,nickname,coin,network,destination_wallet,operation_type,amount,memo,comment,phone,bank,payout_type,payout_rub,status) VALUES(?,?,?,?,?,'sell',?,?,?,?,?,?,?, 'pending')`,[req.session.userId,req.session.nickname,coin,network,BLUP_WALLETS[coin][network],amount,'',comment,payout,bank,payoutType,payoutRub],function(e){
         if(e)return res.status(500).json({error:'Ошибка'});
         const saleId=this.lastID;
         if(discountApplied&&coupon&&couponPercent>=manualPercent) db.run('UPDATE user_coupons SET used_at=CURRENT_TIMESTAMP, used_sale_id=? WHERE id=? AND used_at IS NULL',[saleId,coupon.id]);
         const item={id:saleId,nickname:req.session.nickname,coin,network,wallet:BLUP_WALLETS[coin][network],amount,rate,payoutRub,discountPercent:discountApplied?chosenPercent:0,comment,telegramUsername:tg,phone:payout,bank,payoutType,created_at:new Date().toISOString()};
         notifyAdmin(item).catch(()=>{});
         db.run('UPDATE users SET telegram_username=? WHERE id=?',[tg,req.session.userId]);
         res.json({ok:true,id:saleId,payoutRub,discountPercent:item.discountPercent});
       });
     });
   });
 });});
 });
});

app.get('/ref/:code', (req, res) => {
  res.send(`<script>document.cookie = "ref=${req.params.code}; max-age=" + (60*60*24*30) + "; path=/"; window.location.href = '/';</script>`);
});

// === РЕФЕРАЛЬНАЯ СИСТЕМА ===
app.get('/api/referral', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите' });
  db.get('SELECT ref_code, balance FROM user_referrals WHERE user_id=?', [req.session.userId], (err, row) => {
    if (!row) {
      const refCode = crypto.randomBytes(4).toString('hex');
      db.run('INSERT INTO user_referrals(user_id, ref_code) VALUES(?,?)', [req.session.userId, refCode]);
      return res.json({ ref_code: refCode, balance: 0, referrals: [] });
    }
    db.all('SELECT nickname, public_id, created_at FROM users WHERE referred_by=?', [req.session.userId], (e, refs) => {
      res.json({ ref_code: row.ref_code, balance: row.balance, referrals: refs || [] });
    });
  });
});

app.post('/api/referral/set-code', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите' });
  const code = String(req.body?.code || '').trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(code)) return res.status(400).json({ error: 'Код: 3-20 символов' });
  db.get('SELECT user_id FROM user_referrals WHERE ref_code=?', [code], (err, existing) => {
    if (existing) return res.status(409).json({ error: 'Занято' });
    db.run('INSERT INTO user_referrals(user_id, ref_code) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET ref_code=excluded.ref_code', [req.session.userId, code], (e) => {
      if (e) return res.status(500).json({ error: 'Ошибка' });
      res.json({ ok: true, code });
    });
  });
});

app.post('/api/referral/withdraw', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите' });
  const amount = Number(req.body?.amount), phone = String(req.body?.phone || '').trim(), bank = String(req.body?.bank || '').trim();
  if (amount < 10 || !phone || !bank) return res.status(400).json({ error: 'Мин. $10, укажите реквизиты' });
  db.get('SELECT balance FROM user_referrals WHERE user_id=?', [req.session.userId], (err, row) => {
    if (!row || row.balance < amount) return res.status(400).json({ error: 'Недостаточно средств' });
    db.run('UPDATE user_referrals SET balance = balance - ? WHERE user_id=?', [amount, req.session.userId], (e1) => {
      db.run('INSERT INTO referral_withdrawals(user_id, amount, phone, bank) VALUES(?,?,?,?)', [req.session.userId, amount, phone, bank], (e2) => {
        notifyAdmin({ operation: 'ref_withdraw', nickname: req.session.nickname, amount, phone, bank }).catch(() => {});
        res.json({ ok: true });
      });
    });
  });
});

// === АДМИНКА ===
app.post('/api/admin/login', (req, res) => {
  const ip = ipOf(req);
  if (rateLimit(`admin:${ip}`, 5)) return res.status(429).json({ error: 'Много попыток' });
  const expected = process.env.BLUP_ADMIN_PASSWORD;
  const supplied = String(req.body?.password || '');
  if (!expected || supplied !== expected) return res.status(403).json({ error: 'Неверный пароль' });
  req.session.regenerate(err => { req.session.isAdmin = true; req.session.save(() => res.json({ ok: true })); });
});
app.post('/api/admin/logout', adminOnly, (req, res) => req.session.destroy(() => { res.clearCookie('blup.sid'); res.json({ ok: true }); }));
app.post('/api/admin/maintenance', adminOnly, (req, res) => setSetting('stopped', req.body?.stopped ? '1' : '0', err => res.json({ ok: true, stopped: !!req.body?.stopped })));
app.get('/api/admin/me', (req, res) => res.json({ isAdmin: req.session.isAdmin === true }));
app.get('/api/admin/overview', adminOnly, (req, res) => {
  db.get('SELECT COUNT(*) AS users, SUM(CASE WHEN is_banned=1 THEN 1 ELSE 0 END) AS banned FROM users', [], (e, stats) => {
    db.get("SELECT COUNT(*) AS pending FROM sales WHERE status='pending' AND operation_type='sell'", [], (e2, pending) => {
      db.all('SELECT id,nickname,created_at,last_ip,last_seen,is_banned,ban_reason FROM users ORDER BY id DESC LIMIT 300', [], (e3, users) => {
        db.all("SELECT * FROM sales WHERE operation_type='sell' ORDER BY id DESC LIMIT 300", [], (e4, sales) => {
          db.all('SELECT ip,reason,created_at FROM ip_bans ORDER BY created_at DESC', [], (e5, bans) => {
            db.all('SELECT user_id,nickname,ip,event,created_at FROM visits ORDER BY id DESC LIMIT 200', [], (e7, visits) => {
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
  if (values.some(v => !Number.isFinite(v) || v < 0)) return res.status(400).json({ error: 'Ошибка' });
  db.serialize(() => {
    const pairs = [['usdt_rate', values[0]], ['gram_rate', values[1]], ['reserve_total', values[2]], ['reserve_available', values[3]], ['banks', JSON.stringify([...new Set(banks.map(x => x.trim()))])]];
    const stmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    pairs.forEach(p => stmt.run(p[0], String(p[1])));
    stmt.finalize(err => res.json({ ok: true }));
  });
});
app.post('/api/admin/users/:id/ban', adminOnly, (req, res) => {
  const id = Number(req.params.id), banned = !!req.body?.banned, reason = String(req.body?.reason || '').slice(0,200);
  db.run('UPDATE users SET is_banned=?,ban_reason=?,session_version=session_version+1 WHERE id=?', [banned ? 1 : 0, banned ? reason : null, id], function(err) {
    if (!this.changes) return res.status(404).json({ error: 'Не найден' });
    db.get('SELECT id,nickname,last_ip FROM users WHERE id=?', [id], (e, user) => {
      if (banned && user?.last_ip) db.run('INSERT OR IGNORE INTO ip_bans(ip,reason) VALUES(?,?)', [user.last_ip, reason || 'Бан']);
      res.json({ ok: true });
    });
  });
});
app.delete('/api/admin/users/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM users WHERE id=?', [Number(req.params.id)], function(err) {
    if (!this.changes) return res.status(404).json({ error: 'Не найден' });
    res.json({ ok: true });
  });
});
app.post('/api/admin/ip-ban', adminOnly, (req, res) => {
  const ip = String(req.body?.ip || '').trim(), reason = String(req.body?.reason || '').slice(0,200);
  db.run('INSERT INTO ip_bans(ip,reason) VALUES(?,?) ON CONFLICT(ip) DO UPDATE SET reason=excluded.reason', [ip, reason], err => res.json({ ok: true }));
});
app.delete('/api/admin/ip-ban/:ip', adminOnly, (req, res) => { db.run('DELETE FROM ip_bans WHERE ip=?', [req.params.ip], err => res.json({ ok: true })); });
app.delete('/api/admin/visits', adminOnly, (req, res) => { db.run('DELETE FROM visits', function(err) { res.json({ ok: true, deleted: this.changes }); }); });
app.delete('/api/admin/sales', adminOnly, (req, res) => { db.run("DELETE FROM sales WHERE operation_type='sell' AND status IN ('completed','rejected')", function(err) { res.json({ ok: true, deleted: this.changes }); }); });

app.post('/api/admin/sales/:id/status', adminOnly, (req, res) => {
  const id = Number(req.params.id), status = String(req.body?.status || '');
  db.run("UPDATE sales SET status=? WHERE id=? AND operation_type='sell'", [status, id], function(err) {
    if (!this.changes) return res.status(404).json({ error: 'Не найдена' });
    
    if (status === 'completed') {
      db.get('SELECT user_id, payout_rub FROM sales WHERE id=?', [id], (e, sale) => {
        if (sale) {
          db.get('SELECT referred_by FROM users WHERE id=?', [sale.user_id], (e2, user) => {
            if (user && user.referred_by) {
              // ТУТ БЫЛО 0.10 (10%), СТАЛО 0.02 (2%)
              const bonus = sale.payout_rub * 0.02; 
              db.run('UPDATE user_referrals SET balance = balance + ? WHERE user_id=?', [bonus, user.referred_by]);
            }
          });
        }
      });
    }
    res.json({ ok: true });
  });
});

app.post('/api/admin/promos',adminOnly,(req,res)=>{
 const code=String(req.body?.code||'').trim().toUpperCase(),type=String(req.body?.rewardType||''),description=String(req.body?.description||'').slice(0,200),limit=Math.max(0,Math.floor(Number(req.body?.activationLimit||0)));
 const allowed={sell_discount_1:['percent',1,'Скидка 1%'],sell_discount_3:['percent',3,'Скидка 3%'],deposit_150:['deposit_kb',150,'Депозит 150'],deposit_300:['deposit_jab',300,'Депозит 300'],games_deposit_25:['games_deposit_25',25,'+25% Games']};
 const preset=allowed[type];if(!/^[A-Z0-9_-]{3,24}$/.test(code)||!preset)return res.status(400).json({error:'Ошибка'});
 db.run('INSERT INTO promos(code,reward_type,reward_value,description,activation_limit) VALUES(?,?,?,?,?)',[code,preset[0],preset[1],description||preset[2],limit],e=>e?res.status(409).json({error:'Существует'}):res.json({ok:true}));
});
app.get('/api/admin/promos',adminOnly,(req,res)=>db.all(`SELECT p.*, (SELECT GROUP_CONCAT(COALESCE(r.public_id,r.user_id)||':'||r.nickname, char(10)) FROM promo_redemptions r WHERE r.promo_id=p.id) AS activators FROM promos p ORDER BY p.id DESC`,(e,rows)=>res.json(rows)));
app.post('/api/admin/promos/:id/toggle',adminOnly,(req,res)=>db.run('UPDATE promos SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?',[Number(req.params.id)],function(e){res.json({ok:true});}));
app.post('/api/admin/users/:id/discount',adminOnly,(req,res)=>{const id=Number(req.params.id),percent=Number(req.body?.percent);if(![0,1,3].includes(percent))return res.status(400).json({error:'Ошибка'});if(percent===0)return db.run('DELETE FROM user_discounts WHERE user_id=?',[id],e=>res.json({ok:true}));db.run('INSERT INTO user_discounts(user_id,percent,source,active) VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET percent=excluded.percent,source=excluded.source,active=1',[id,percent,'admin'],e=>res.json({ok:true}));});

app.get('/api/admin/referrals', adminOnly, (req, res) => {
  db.all(`SELECT r.*, u.nickname, u.public_id FROM user_referrals r JOIN users u ON r.user_id = u.id ORDER BY r.balance DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка' });
    Promise.all(rows.map(r => new Promise(resolve => {
      db.get('SELECT COUNT(*) as count FROM users WHERE referred_by=?', [r.user_id], (e, c) => {
        r.ref_count = c?.count || 0;
        resolve(r);
      });
    }))).then(() => res.json(rows));
  });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.ready.then(() => app.listen(PORT, () => console.log(`BLUP запущен на порту ${PORT}`))).catch(err => { console.error('Ошибка:', err); process.exit(1); });
