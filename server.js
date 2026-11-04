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

// Реальный онлайн: учитываем активные браузерные сессии, которые регулярно
// отправляют heartbeat с открытой страницы. Не подменяем ноль единицей.
const onlineSessions = new Map();
const ONLINE_TIMEOUT_MS = 75 * 1000;
function reportOnline(req, res) {
  // Помечаем сессию изменённой, чтобы express-session сохранил cookie и
  // один посетитель не считался новой сессией при каждом heartbeat.
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
// Оставляем совместимость со старым адресом API.
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

app.post('/api/register', (req, res) => {
  const ip = ipOf(req), nickname = String(req.body?.nickname || '').trim(), password = String(req.body?.password || '');
  const cookieRef = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ref='));
  let refCode = String(req.body?.ref || (cookieRef ? decodeURIComponent(cookieRef.slice(4)) : '')).trim();
  if (!/^[a-f0-9]{8,32}$/i.test(refCode) && !/^[a-zA-Z0-9_]{3,20}$/.test(refCode)) refCode = '';
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
        const createUser = referrerId => {
          db.run('INSERT INTO users(nickname,password_hash,last_ip,last_seen,public_id,referred_by) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?)',
            [nickname, hash, ip, publicId, referrerId || null], function(insertErr) {
              if (insertErr) return res.status(500).json({ error: 'Ошибка БД' });
              const newUserId = this.lastID;
              req.session.regenerate(regErr => {
                if (regErr) return res.status(500).json({ error: 'Ошибка сессии' });
                req.session.userId = newUserId; req.session.nickname = nickname; req.session.sessionVersion = 0;
                logVisit({ id: newUserId, nickname }, ip, 'register');
                notifyNewUser({nickname, publicId}).catch(() => {});
                req.session.save(() => res.json({ ok: true, nickname, publicId, referred: Boolean(referrerId) }));
              });
            });
        };
        if (refCode) {
          db.get('SELECT user_id FROM user_referrals WHERE ref_code=?', [refCode], (rErr, refRow) => {
            const referrerId = refRow ? refRow.user_id : null;
            createUser(referrerId);
          });
        } else createUser(null);
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
  const botToken = process.env.TELEGRAM_LOGIN_BOT_TOKEN || process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  if (!data.id || !data.auth_date || !data.hash) return res.status(400).json({ error: 'Ошибка' });
  if (rateLimit(`tg:${ip}`, 20)) return res.status(429).json({ error: 'Много попыток' });
  if (Math.floor(Date.now()/1000) - Number(data.auth_date) > 300) return res.status(400).json({ error: 'Устарело' });
  if (!botToken) return res.status(503).json({ error: 'Telegram Login не настроен' });
  const secret = crypto.createHash('sha256').update(botToken).digest();
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
        db.run(`UPDATE users SET telegram_username=?, telegram_photo_url=?, last_ip=?, last_seen=CURRENT_TIMESTAMP WHERE id=?`, [data.username || null, data.photo_url || null, ip, byTg.id]);
        return finishLogin(byTg);
      }
      const baseNick = (data.username || `tg_${data.id}`).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20) || `tg_${data.id}`;
      const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
      let publicId; const pickId = cb => { const n = Math.floor(Math.random()*99999)+1; db.get('SELECT id FROM users WHERE public_id=?',[n],(e,row)=>row?pickId(cb):cb(n)); };
      pickId(pid => {
        publicId = pid;
        const tryInsert = (nick, cb) => {
          db.run(`INSERT INTO users(nickname,password_hash,last_ip,last_seen,public_id,telegram_id,telegram_username,telegram_photo_url) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?,?)`,
            [nick, randomHash, ip, pid, data.id, data.username||null, data.photo_url||null], function(insErr) {
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
  const botToken = process.env.TELEGRAM_LOGIN_BOT_TOKEN || process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  if (!data.id || !data.auth_date || !data.hash) return res.status(400).json({ error: 'Ошибка' });
  if (Math.floor(Date.now()/1000) - Number(data.auth_date) > 300) return res.status(400).json({ error: 'Устарело' });
  if (!botToken) return res.status(503).json({ error: 'Telegram Login не настроен' });
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const checkString = Object.keys(data).filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== data.hash) return res.status(403).json({ error: 'Неверная подпись' });

  db.get('SELECT id FROM users WHERE telegram_id=? AND id!=?', [data.id, req.session.userId], (err, existing) => {
    if (existing) return res.status(409).json({ error: 'TG уже привязан к другому' });
    db.run(`UPDATE users SET telegram_id=?, telegram_username=?, telegram_photo_url=? WHERE id=?`, [data.id, data.username || null, data.photo_url || null, req.session.userId], function() {
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
  db.get(`SELECT u.nickname,u.public_id,u.created_at,u.telegram_id,u.telegram_username,u.telegram_photo_url,
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
         // Не записываем реквизиты выплаты в telegram_username: это отдельное поле профиля.
         res.json({ok:true,id:saleId,payoutRub,discountPercent:item.discountPercent});
       });
     });
   });
 });});
 });
});

app.get('/ref/:code', (req, res) => {
  const code = String(req.params.code || '');
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(code)) return res.redirect('/');
  res.setHeader('Set-Cookie', `ref=${encodeURIComponent(code)}; Max-Age=2592000; Path=/; SameSite=Lax; Secure`);
  return res.redirect('/');
});

// === РЕФЕРАЛЬНАЯ СИСТЕМА ===
app.get('/api/referral', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите' });
  db.get('SELECT ref_code, balance FROM user_referrals WHERE user_id=?', [req.session.userId], (err, row) => {
    const ensure = cb => { if (row) return cb(row); const refCode = crypto.randomBytes(4).toString('hex'); db.run('INSERT INTO user_referrals(user_id, ref_code, balance) VALUES(?,?,0)', [req.session.userId, refCode], e => cb({ ref_code: refCode, balance: 0 })); };
    ensure(ref => db.all(`SELECT u.nickname,u.public_id,u.created_at,
      COALESCE(SUM(CASE WHEN s.status='completed' AND s.operation_type='sell' THEN s.amount ELSE 0 END),0) sold_usd,
      COALESCE(SUM(CASE WHEN s.status='completed' AND s.operation_type='sell' THEN s.payout_rub ELSE 0 END),0) sold_rub,
      COALESCE((SELECT SUM(c.commission_rub) FROM referral_commissions c JOIN sales sx ON sx.id=c.sale_id WHERE sx.user_id=u.id),0) earned_rub,
      COALESCE((SELECT SUM(c.commission_usd) FROM referral_commissions c JOIN sales sx ON sx.id=c.sale_id WHERE sx.user_id=u.id),0) earned_usd
      FROM users u LEFT JOIN sales s ON s.user_id=u.id AND s.operation_type='sell' AND s.status='completed'
      WHERE u.referred_by=? GROUP BY u.id ORDER BY u.created_at DESC`, [req.session.userId], (e, refs) => {
      res.json({ ref_code: ref.ref_code, balance: Number(ref.balance || 0), commission_percent: 2.5, referrals: refs || [] });
    }));
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
app.delete('/api/admin/sales/:id', adminOnly, (req,res) => db.run("DELETE FROM sales WHERE id=? AND operation_type='sell' AND status='rejected'", [Number(req.params.id)], function(err){ if(err)return res.status(500).json({error:'Ошибка'}); if(!this.changes)return res.status(409).json({error:'Удалять можно только отменённые заявки'}); res.json({ok:true}); }));

app.post('/api/admin/sales/:id/status', adminOnly, (req, res) => {
  const id = Number(req.params.id), status = String(req.body?.status || '');
  if (!['pending','processing','completed','rejected'].includes(status)) return res.status(400).json({ error: 'Некорректный статус' });
  db.get("SELECT * FROM sales WHERE id=? AND operation_type='sell'", [id], (findErr, sale) => {
    if (!sale) return res.status(404).json({ error: 'Не найдена' });
    db.run("UPDATE sales SET status=? WHERE id=? AND operation_type='sell'", [status, id], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка базы данных' });
      if (status !== 'completed' || sale.status === 'completed') return res.json({ ok: true });
      db.get('SELECT referred_by FROM users WHERE id=?', [sale.user_id], (e, user) => {
        if (!user?.referred_by) return res.json({ ok: true });
        db.get('SELECT value FROM settings WHERE key=?', [sale.coin === 'GRAM' ? 'gram_rate' : 'usdt_rate'], (rateErr, rateRow) => {
          const rate = Number(rateRow?.value || 0);
          const saleRub = Number(sale.payout_rub || (Number(sale.amount || 0) * rate));
          const commissionRub = Number((saleRub * 0.025).toFixed(2));
          const commissionUsd = rate > 0 ? Number((commissionRub / rate).toFixed(8)) : 0;
          db.run('INSERT OR IGNORE INTO referral_commissions(sale_id,referrer_id,sale_amount_usd,sale_amount_rub,commission_usd,commission_rub) VALUES(?,?,?,?,?,?)', [id,user.referred_by,Number(sale.amount||0),saleRub,commissionUsd,commissionRub], function(commErr) {
            if (commErr) return res.status(500).json({ error: 'Не удалось начислить реферальный бонус' });
            if (this.changes) db.run('UPDATE user_referrals SET balance=balance+? WHERE user_id=?', [commissionUsd,user.referred_by], e2 => res.json({ ok: true, referralBonusUsd: commissionUsd }));
            else res.json({ ok: true });
          });
        });
      });
    });
  });
});

// Активация промокода из профиля. Привязка к аккаунту обязательна.
app.post('/api/promos/apply', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы активировать промокод' });
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return res.status(400).json({ error: 'Введите корректный промокод' });
  db.get('SELECT id,code,reward_type,reward_value,description,active,activation_limit,activation_count FROM promos WHERE code=? COLLATE NOCASE', [code], (findErr, promo) => {
    if (findErr) return res.status(500).json({ error: 'Ошибка проверки промокода' });
    if (!promo || !promo.active) return res.status(404).json({ error: 'Промокод не найден или отключён' });
    if (Number(promo.activation_limit) > 0 && Number(promo.activation_count) >= Number(promo.activation_limit))
      return res.status(409).json({ error: 'Лимит активаций этого промокода исчерпан' });
    db.get('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?', [promo.id, req.session.userId], (usedErr, used) => {
      if (usedErr) return res.status(500).json({ error: 'Ошибка проверки активации' });
      if (used) return res.status(409).json({ error: 'Вы уже активировали этот промокод' });
      db.get('SELECT public_id,nickname FROM users WHERE id=?', [req.session.userId], (userErr, user) => {
        if (userErr || !user) return res.status(500).json({ error: 'Не удалось определить аккаунт' });
        db.run('INSERT INTO promo_redemptions(promo_id,user_id,public_id,nickname) VALUES(?,?,?,?)', [promo.id, req.session.userId, user.public_id, user.nickname], function(insertErr) {
          if (insertErr) return res.status(409).json({ error: 'Промокод уже активирован в вашем аккаунте' });
          db.run('UPDATE promos SET activation_count=activation_count+1 WHERE id=?', [promo.id], updateErr => {
            if (updateErr) return res.status(500).json({ error: 'Не удалось завершить активацию' });
            const percent = promo.reward_type === 'percent' ? Number(promo.reward_value) : 0;
            if ([1, 3].includes(percent)) {
              db.run("INSERT INTO user_coupons(user_id,promo_id,percent,source) VALUES(?,?,?,'promo')", [req.session.userId, promo.id, percent], couponErr => {
                if (couponErr) return res.status(500).json({ error: 'Промокод отмечен, но купон не удалось добавить. Обратитесь в поддержку.' });
                return res.json({ ok: true, promo: { code: promo.code, description: promo.description, rewardType: promo.reward_type, rewardValue: promo.reward_value } });
              });
            } else {
              return res.json({ ok: true, promo: { code: promo.code, description: promo.description, rewardType: promo.reward_type, rewardValue: promo.reward_value } });
            }
          });
        });
      });
    });
  });
});

app.post('/api/admin/promos',adminOnly,(req,res)=>{
 const code=String(req.body?.code||'').trim().toUpperCase(),type=String(req.body?.rewardType||''),description=String(req.body?.description||'').slice(0,200),limit=Math.max(0,Math.floor(Number(req.body?.activationLimit||0)));
 const allowed={sell_discount_1:['percent',1,'Скидка 1%'],sell_discount_3:['percent',3,'Скидка 3%'],deposit_150:['deposit_kb',150,'Депозит 150'],deposit_300:['deposit_jab',300,'Депозит 300'],games_deposit_25:['games_deposit_25',25,'+25% Games']};
 const preset=allowed[type];if(!/^[A-Z0-9_-]{3,24}$/.test(code)||!preset)return res.status(400).json({error:'Ошибка'});
 db.run('INSERT INTO promos(code,reward_type,reward_value,description,activation_limit) VALUES(?,?,?,?,?)',[code,preset[0],preset[1],description||preset[2],limit],e=>e?res.status(409).json({error:'Существует'}):res.json({ok:true}));
});
app.get('/api/admin/promos',adminOnly,(req,res)=>db.all(`SELECT p.*, (SELECT GROUP_CONCAT(COALESCE(r.public_id,r.user_id)||':'||r.nickname, char(10)) FROM promo_redemptions r WHERE r.promo_id=p.id) AS activators FROM promos p ORDER BY p.id DESC`,(e,rows)=>res.json(rows)));
app.get('/api/admin/promos/:id/users',adminOnly,(req,res)=>db.all(`SELECT r.id redemption_id,r.public_id,r.nickname,r.created_at,u.id user_id,u.telegram_id,u.telegram_username,u.telegram_photo_url FROM promo_redemptions r LEFT JOIN users u ON u.id=r.user_id WHERE r.promo_id=? ORDER BY r.id DESC`,[Number(req.params.id)],(e,rows)=>e?res.status(500).json({error:'Ошибка'}):res.json(rows||[])));
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

app.get('/api/reviews', (req,res) => db.all('SELECT * FROM reviews ORDER BY id DESC LIMIT 50', [], (e,rows) => e ? res.status(500).json({error:'Ошибка загрузки отзывов'}) : res.json(rows || [])));
app.get('/api/admin/reviews', adminOnly, (req,res) => db.all('SELECT * FROM reviews ORDER BY id DESC', [], (e,rows) => e ? res.status(500).json({error:'Ошибка загрузки отзывов'}) : res.json(rows || [])));
app.post('/api/admin/reviews', adminOnly, (req,res) => {
  const uid=String(req.body?.userId||'').trim().slice(0,40);
  const user=String(req.body?.username||'').trim().slice(0,64);
  const rawAmount=String(req.body?.amount??'').trim().replace(',','.');
  const amount=rawAmount===''?0:Number(rawAmount);
  const review=String(req.body?.text||'').trim().slice(0,1500);
  const stars=Number(req.body?.stars);
  if(!uid||!user||!Number.isFinite(amount)||amount<0||!review||!Number.isInteger(stars)||stars<1||stars>5)
    return res.status(400).json({error:'Проверьте ID, юзернейм, сумму, оценку и текст отзыва'});
  db.run('INSERT INTO reviews(user_public_id,username,sale_amount,review_text,stars) VALUES(?,?,?,?,?)',
    [uid,user,amount,review,stars],function(e){
      if(e){ console.error('Ошибка сохранения отзыва:',e); return res.status(500).json({error:'Не удалось сохранить отзыв. Проверьте подключение базы данных и попробуйте ещё раз.'}); }
      res.json({ok:true,id:this.lastID});
    });
});
app.delete('/api/admin/reviews/:id', adminOnly, (req,res) => db.run('DELETE FROM reviews WHERE id=?',[Number(req.params.id)],function(e){e?res.status(500).json({error:'Ошибка удаления'}):res.json({ok:true});}));

app.get('/api/public/user/:id', (req,res) => {
  const publicId = Number(req.params.id);
  if (!Number.isInteger(publicId) || publicId < 1) return res.status(400).json({error:'Некорректный ID'});
  db.get(`SELECT u.nickname,u.public_id,u.created_at,u.telegram_id,u.telegram_username,u.telegram_photo_url,
    COALESCE(SUM(CASE WHEN s.operation_type='sell' AND s.status='completed' THEN s.amount ELSE 0 END),0) sold_usd
    FROM users u LEFT JOIN sales s ON s.user_id=u.id WHERE u.public_id=? GROUP BY u.id`,[publicId],(e,row)=>e?res.status(500).json({error:'Ошибка'}):row?res.json(row):res.status(404).json({error:'Пользователь не найден'}));
});
// Не отдаём HTML для неизвестных API-маршрутов: клиент должен получить понятный JSON 404.
app.use('/api', (req, res) => res.status(404).json({ error: `API-маршрут не найден: ${req.method} ${req.originalUrl}` }));

app.get('/user/:id', (req,res) => res.sendFile(path.join(__dirname,'public','public-profile.html')));

app.get('/giveaways', (req, res) => res.sendFile(path.join(__dirname, 'public', 'giveaways.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

// BLUP Games API. Баланс хранится на сервере; клиент не задаёт результат игры.
function requireGameUser(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы играть' });
  next();
}
function ensureGameBalance(userId, cb) {
  db.run('INSERT OR IGNORE INTO game_balance(user_id,balance) VALUES(?,0)', [userId], err => {
    if (err) return cb(err);
    db.get('SELECT balance FROM game_balance WHERE user_id=?', [userId], (e, row) => cb(e, row));
  });
}
app.get('/api/games/balance', requireGameUser, (req, res) => ensureGameBalance(req.session.userId, (e, row) => {
  if (e) return res.status(500).json({ error: 'Не удалось загрузить игровой баланс' });
  res.set('Cache-Control', 'no-store'); res.json({ balance: Number(row.balance || 0) });
}));
// Платёжного провайдера Games в текущем проекте нет: не зачисляем деньги по одному запросу браузера.
app.post('/api/games/deposit', requireGameUser, (req, res) => res.status(503).json({ error: 'Пополнение Games пока не подключено к платёжному провайдеру. Средства не списаны.' }));
app.post('/api/games/promo', requireGameUser, (req, res) => {
  const code = String(req.body?.code || '').trim().slice(0, 40);
  if (!code) return res.status(400).json({ error: 'Введите промокод' });
  db.get('SELECT * FROM promos WHERE code=? COLLATE NOCASE', [code], (e, promo) => {
    if (e) return res.status(500).json({ error: 'Ошибка базы данных' });
    if (!promo || !promo.active) return res.status(404).json({ error: 'Промокод не найден или отключён' });
    if (Number(promo.activation_limit) > 0 && Number(promo.activation_count) >= Number(promo.activation_limit)) return res.status(400).json({ error: 'Лимит активаций промокода исчерпан' });
    if (promo.reward_type !== 'games_deposit_25') return res.status(400).json({ error: 'Этот промокод не предназначен для BLUP Games' });
    db.get('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?', [promo.id, req.session.userId], (e2, used) => {
      if (e2) return res.status(500).json({ error: 'Ошибка базы данных' });
      if (used) return res.status(409).json({ error: 'Вы уже активировали этот промокод' });
      ensureGameBalance(req.session.userId, (e3) => {
        if (e3) return res.status(500).json({ error: 'Ошибка игрового баланса' });
        const bonus = Math.max(0, Number(promo.reward_value) || 0);
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');
          db.run('INSERT INTO promo_redemptions(promo_id,user_id,nickname) VALUES(?,?,?)', [promo.id, req.session.userId, req.session.nickname], function(e4) {
            if (e4) { db.run('ROLLBACK'); return res.status(409).json({ error: 'Промокод уже использован' }); }
            db.run('UPDATE game_balance SET balance=balance+? WHERE user_id=?', [bonus, req.session.userId], e5 => {
              if (e5) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Не удалось начислить бонус' }); }
              db.run('UPDATE promos SET activation_count=activation_count+1 WHERE id=?', [promo.id], e6 => {
                if (e6) { db.run('ROLLBACK'); return res.status(500).json({ error: 'Не удалось завершить активацию' }); }
                db.run('COMMIT', e7 => e7 ? res.status(500).json({ error: 'Ошибка сохранения' }) : ensureGameBalance(req.session.userId, (e8,row) => res.json({ ok:true, bonus, balance:Number(row?.balance||0) })));
              });
            });
          });
        });
      });
    });
  });
});
app.post('/api/games/play', requireGameUser, (req, res) => {
  const game = String(req.body?.game || ''), bet = Math.round(Number(req.body?.bet) * 100) / 100;
  if (!Number.isFinite(bet) || bet < 0.1 || bet > 10000) return res.status(400).json({ error: 'Ставка должна быть от $0.10 до $10,000' });
  let result = {}, payout = 0, multiplier = 0, won = false;
  if (game === 'dice') {
    const chance = Number(req.body?.chance);
    if (!Number.isInteger(chance) || chance < 2 || chance > 96) return res.status(400).json({ error: 'Некорректный шанс' });
    const roll = crypto.randomInt(0, 10000) / 100;
    won = roll < chance; multiplier = 98 / chance; payout = won ? Math.floor(bet * multiplier * 100) / 100 : 0; result = { roll, chance };
  } else if (game === 'flip') {
    const side = req.body?.side;
    if (!['heads','tails'].includes(side)) return res.status(400).json({ error: 'Выберите орла или решку' });
    const landed = crypto.randomInt(0,2) ? 'heads' : 'tails'; won = landed === side; multiplier = 1.96; payout = won ? Math.floor(bet * multiplier * 100) / 100 : 0; result = { result: landed };
  } else if (game === 'keno') {
    const picks = [...new Set((Array.isArray(req.body?.picks) ? req.body.picks : []).map(Number))];
    if (picks.length < 1 || picks.length > 10 || picks.some(n => !Number.isInteger(n) || n < 1 || n > 40)) return res.status(400).json({ error: 'Выберите от 1 до 10 чисел от 1 до 40' });
    const pool = Array.from({length:40},(_,i)=>i+1), drawn=[];
    for(let i=0;i<10;i++) drawn.push(pool.splice(crypto.randomInt(0,pool.length),1)[0]);
    const hits = picks.filter(n=>drawn.includes(n)).length;
    const tables = {1:[0,3.8],2:[0,1.5,5],3:[0,1,2.5,25],4:[0,.5,1.5,5,60],5:[0,0,1,3,15,120],6:[0,0,.5,2,8,40,300],7:[0,0,.5,1.5,5,20,100,500],8:[0,0,0,1,3,10,50,250,1000],9:[0,0,0,.5,2,5,20,100,500,1500],10:[0,0,0,.5,1.5,4,15,50,250,1000,2000]};
    multiplier = tables[picks.length][hits] || 0; payout = Math.floor(bet * multiplier * 100) / 100; won = payout > 0; result = { drawn, hits };
  } else return res.status(400).json({ error: 'Неизвестная игра' });
  ensureGameBalance(req.session.userId, (e,row) => {
    if(e) return res.status(500).json({error:'Ошибка баланса'});
    const current = Number(row.balance || 0);
    if(current < bet) return res.status(400).json({error:'Недостаточно средств на игровом балансе'});
    const newBalance = Math.round((current - bet + payout) * 100) / 100;
    db.run('UPDATE game_balance SET balance=? WHERE user_id=?', [newBalance, req.session.userId], e2 => {
      if(e2) return res.status(500).json({error:'Не удалось обновить баланс'});
      db.run('INSERT INTO game_bets(user_id,game,amount,multiplier,win_amount) VALUES(?,?,?,?,?)',[req.session.userId,game,bet,multiplier,payout], e3 => {
        if(e3) console.error('game_bets insert:',e3.message);
        res.json({ok:true,balance:newBalance,payout,multiplier,won,...result});
      });
    });
  });
});
// Stateful rounds: mine locations and crash point stay on the server.
const activeGameRounds = new Map();
app.post('/api/games/start', requireGameUser, (req,res) => {
  const game=String(req.body?.game||''), bet=Math.round(Number(req.body?.bet)*100)/100;
  if(!['mines','crash'].includes(game) || !Number.isFinite(bet) || bet<0.1 || bet>10000) return res.status(400).json({error:'Некорректная ставка или игра'});
  const mineCount=Math.max(1,Math.min(24,Number(req.body?.mines)||5));
  ensureGameBalance(req.session.userId,(e,row)=>{if(e)return res.status(500).json({error:'Ошибка баланса'});if(Number(row.balance)<bet)return res.status(400).json({error:'Недостаточно средств на игровом балансе'});
    const id=crypto.randomBytes(18).toString('hex'),round={userId:req.session.userId,game,bet,started:Date.now(),opened:[],mines:[],mineCount,crashPoint:1+crypto.randomInt(0,50001)/10000};
    if(game==='mines'){while(round.mines.length<mineCount){const n=crypto.randomInt(0,25);if(!round.mines.includes(n))round.mines.push(n)}}
    db.run('UPDATE game_balance SET balance=balance-? WHERE user_id=?',[bet,req.session.userId],err=>{if(err)return res.status(500).json({error:'Не удалось списать ставку'});activeGameRounds.set(id,round);res.json({ok:true,roundId:id,balance:Number(row.balance)-bet})});
  });
});
app.post('/api/games/pick', requireGameUser, (req,res)=>{
  const id=String(req.body?.roundId||''),index=Number(req.body?.index),round=activeGameRounds.get(id);
  if(!round||round.userId!==req.session.userId||round.game!=='mines')return res.status(400).json({error:'Раунд не найден или уже завершён'});
  if(!Number.isInteger(index)||index<0||index>24||round.opened.includes(index))return res.status(400).json({error:'Некорректная ячейка'});
  round.opened.push(index);
  if(round.mines.includes(index)){activeGameRounds.delete(id);db.run('INSERT INTO game_bets(user_id,game,amount,multiplier,win_amount) VALUES(?,?,?,?,0)',[round.userId,'mines',round.bet,0]);return res.json({safe:false,opened:round.opened,mines:round.mines,balance:null})}
  const k=round.opened.length,safe=25-round.mineCount;let m=1;for(let i=0;i<k;i++)m*= (25-i)/(safe-i);m*=.99;const multiplier=Math.floor(m*100)/100;
  res.json({safe:true,opened:round.opened,multiplier,potential:Math.floor(round.bet*multiplier*100)/100});
});
app.get('/api/games/status', requireGameUser, (req,res)=>{
  const round=activeGameRounds.get(String(req.query.roundId||''));
  if(!round||round.userId!==req.session.userId||round.game!=='crash')return res.status(404).json({error:'Раунд не найден'});
  const current=Math.exp((Date.now()-round.started)/5200);
  if(current>=round.crashPoint){activeGameRounds.delete(String(req.query.roundId));db.run('INSERT INTO game_bets(user_id,game,amount,multiplier,win_amount) VALUES(?,?,?,?,0)',[round.userId,'crash',round.bet,0]);return res.json({crashed:true,point:round.crashPoint});}
  res.json({crashed:false,current});
});
app.post('/api/games/settle', requireGameUser, (req,res)=>{
  const id=String(req.body?.roundId||''),round=activeGameRounds.get(id);
  if(!round||round.userId!==req.session.userId)return res.status(400).json({error:'Раунд не найден или уже завершён'});
  let multiplier=0;
  if(round.game==='mines'){if(!round.opened.length)return res.status(400).json({error:'Сначала открой хотя бы одну безопасную ячейку'});const safe=25-round.mineCount;let m=1;for(let i=0;i<round.opened.length;i++)m*=(25-i)/(safe-i);multiplier=Math.floor(m*.99*100)/100}
  else if(round.game==='crash'){const elapsed=(Date.now()-round.started)/5200;const current=Math.exp(elapsed);if(current>=round.crashPoint){activeGameRounds.delete(id);db.run('INSERT INTO game_bets(user_id,game,amount,multiplier,win_amount) VALUES(?,?,?,?,0)',[round.userId,'crash',round.bet,0]);return res.status(400).json({error:'Краш! Раунд проигран'});}multiplier=Math.floor(current*100)/100;}
  else return res.status(400).json({error:'Неподдерживаемый раунд'});
  const payout=Math.floor(round.bet*multiplier*100)/100;activeGameRounds.delete(id);
  db.run('UPDATE game_balance SET balance=balance+? WHERE user_id=?',[payout,round.userId],e=>{if(e)return res.status(500).json({error:'Ошибка выплаты'});db.get('SELECT balance FROM game_balance WHERE user_id=?',[round.userId],(e2,row)=>{db.run('INSERT INTO game_bets(user_id,game,amount,multiplier,win_amount) VALUES(?,?,?,?,?)',[round.userId,round.game,round.bet,multiplier,payout]);res.json({ok:true,payout,multiplier,balance:Number(row?.balance||0)})})});
});

app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.ready.then(() => app.listen(PORT, () => console.log(`BLUP запущен на порту ${PORT}`))).catch(err => { console.error('Ошибка:', err); process.exit(1); });
