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
  db.get(`SELECT u.nickname,u.public_id,u.created_at,u.telegram_id,u.telegram_username,u.telegram_photo_url,u.steam_trade_url,
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

app.post('/api/profile/steam-trade',(req,res)=>{
  if(!req.session.userId)return res.status(401).json({error:'Войдите'});
  const raw=String(req.body?.url||'').trim();
  if(!raw)return res.status(400).json({error:'Вставь ссылку на обмен Steam'});
  let u;try{u=new URL(raw)}catch{return res.status(400).json({error:'Некорректная ссылка'});}
  const partner=u.searchParams.get('partner'),token=u.searchParams.get('token');
  if(u.protocol!=='https:'||u.hostname!=='steamcommunity.com'||u.pathname!=='/tradeoffer/new/'||!/^\d{5,20}$/.test(partner||'')||! /^[A-Za-z0-9_-]{5,40}$/.test(token||''))return res.status(400).json({error:'Нужна личная ссылка обмена Steam из инвентаря'});
  db.run('UPDATE users SET steam_trade_url=? WHERE id=?',[u.toString(),req.session.userId],e=>e?res.status(500).json({error:'Не удалось сохранить ссылку'}):res.json({ok:true,url:u.toString()}));
});

app.post('/api/sell',(req,res)=>{
 if(!req.session.userId)return res.status(401).json({error:'Войдите'});
 getSetting('stopped','0',(me,stopped)=>{if(stopped==='1'&&req.session.isAdmin!==true)return res.status(403).json({error:'Техработы'});
 const requestedCoin=String(req.body?.coin||'USDT').toUpperCase(), coin=requestedCoin==='TON'?'GRAM':requestedCoin, network=String(req.body?.network||''), amount=Number(req.body?.amount), comment=String(req.body?.comment||'').slice(0,500), tg=String(req.body?.telegramUsername||'').trim().replace(/^@/, ''), payoutType=String(req.body?.payoutType||'phone'), payout=String(req.body?.payoutValue||'').trim(), bank=String(req.body?.bank||'').trim();
 if(!['GRAM','USDT'].includes(coin) || !BLUP_WALLETS[coin]?.[network] || !Number.isFinite(amount) || amount<=0 || (coin==='USDT'&&amount>200) || !tg || !payout || !bank)return res.status(400).json({error:'Ошибка данных'});
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

app.delete('/api/admin/promos/:id',adminOnly,(req,res)=>{
 const id=Number(req.params.id); if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Некорректный ID'});
 db.serialize(()=>{db.run('DELETE FROM promo_redemptions WHERE promo_id=?',[id],e=>{if(e)return res.status(500).json({error:'Ошибка удаления активаций'});});db.run('DELETE FROM user_coupons WHERE promo_id=?',[id],e=>{if(e)return res.status(500).json({error:'Ошибка удаления купонов'});});db.run('DELETE FROM promos WHERE id=?',[id],function(e){if(e)return res.status(500).json({error:'Ошибка удаления'});if(!this.changes)return res.status(404).json({error:'Промокод не найден'});res.json({ok:true});});});
});
app.post('/api/admin/promos',adminOnly,(req,res)=>{
 const code=String(req.body?.code||'').trim().toUpperCase(),type=String(req.body?.rewardType||''),description=String(req.body?.description||'').slice(0,200),limit=Math.max(0,Math.floor(Number(req.body?.activationLimit||0)));
 const allowed={sell_discount_1:['percent',1,'Скидка 1%'],sell_discount_3:['percent',3,'Скидка 3%'],case_bonus_5:['deposit_bonus',5,'Бонус +5% к пополнению кейсов'],case_bonus_10:['deposit_bonus',10,'Бонус +10% к пополнению кейсов'],case_bonus_25:['deposit_bonus',25,'Бонус +25% к пополнению кейсов'],deposit_150:['deposit_kb',150,'Депозит 150'],deposit_300:['deposit_jab',300,'Депозит 300']};
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

app.get('/user/:id', (req,res) => res.sendFile(path.join(__dirname,'public','public-profile.html')));


app.get('/tournament', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tournament.html')));

// Заявки на турниры. Право на платную категорию проверяется только сервером.
app.post('/api/tournament/apply', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы подать заявку' });
  const category = String(req.body?.category || '').toLowerCase();
  const steam = String(req.body?.steam || '').trim();
  const faceit = String(req.body?.faceit || '').trim();
  const elo = String(req.body?.elo || '').trim().slice(0, 40);
  const telegram = String(req.body?.telegram || '').trim().slice(0, 80);
  if (!['free','paid'].includes(category) || !steam || !faceit || !elo || !telegram)
    return res.status(400).json({ error: 'Заполните Steam, Faceit, ELO и Telegram' });
  db.get("SELECT COALESCE(SUM(amount),0) AS total FROM sales WHERE user_id=? AND operation_type='sell' AND status='completed'", [req.session.userId], (e, row) => {
    if (e) return res.status(500).json({ error: 'Не удалось проверить продажи' });
    const continueApply = () => {
    db.get('SELECT id FROM tournament_applications WHERE user_id=? AND category=?', [req.session.userId, category], (e2, existing) => {
      if (e2) return res.status(500).json({ error: 'Ошибка базы данных' });
      if (existing) return res.status(409).json({ error: 'Вы уже подали заявку в эту категорию' });
      db.run('INSERT INTO tournament_applications(user_id,nickname,category,steam_url,faceit_url,elo,telegram) VALUES(?,?,?,?,?,?,?)',
        [req.session.userId, req.session.nickname || '', category, steam, faceit, elo, telegram], function(e3) {
          if (e3) return res.status(500).json({ error: 'Не удалось сохранить заявку' });
          res.json({ ok: true, id: this.lastID });
        });
    });
    };
    if(category==='paid') db.get('SELECT user_id FROM tournament_paid_access WHERE user_id=?',[req.session.userId],(grantErr,grant)=>{ if(grant) return continueApply(); if(Number(row?.total||0)<20)return res.status(403).json({error:'Для $$$ турнира нужны завершённые продажи на сумму от $20 или персональный доступ'}); continueApply(); });
    else continueApply();
  });
});
app.get('/api/tournament/access', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт' });
  db.get("SELECT COALESCE(SUM(amount),0) AS total FROM sales WHERE user_id=? AND operation_type='sell' AND status='completed'", [req.session.userId], (e, row) => {
    if (e) return res.status(500).json({ error: 'Ошибка проверки доступа' });
    db.get('SELECT user_id FROM tournament_paid_access WHERE user_id=?',[req.session.userId],(e2,grant)=>{res.set('Cache-Control','no-store');res.json({ paidAccess: !!grant || Number(row?.total || 0) >= 20, manualAccess:!!grant, completedSales: Number(row?.total || 0) });});
  });
});
app.delete('/api/admin/tournament-applications/:id',adminOnly,(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Некорректный ID'});db.run('DELETE FROM tournament_applications WHERE id=?',[id],function(e){if(e)return res.status(500).json({error:'Ошибка удаления заявки'});if(!this.changes)return res.status(404).json({error:'Заявка не найдена'});res.json({ok:true});});});
app.post('/api/admin/tournament-access',adminOnly,(req,res)=>{const publicId=String(req.body?.publicId||'').trim();if(!/^\d{1,20}$/.test(publicId))return res.status(400).json({error:'Укажите корректный ID пользователя на сайте'});db.get('SELECT id,public_id,nickname FROM users WHERE public_id=?',[Number(publicId)],(e,user)=>{if(e)return res.status(500).json({error:'Ошибка базы данных'});if(!user)return res.status(404).json({error:'Пользователь с таким ID не найден'});db.run('INSERT OR IGNORE INTO tournament_paid_access(user_id,granted_by) VALUES(?,?)',[user.id,'admin'],err=>err?res.status(500).json({error:'Не удалось выдать доступ'}):res.json({ok:true,user:{public_id:user.public_id,nickname:user.nickname}}));});});
app.delete('/api/admin/tournament-access/:publicId',adminOnly,(req,res)=>{const id=Number(req.params.publicId);db.run('DELETE FROM tournament_paid_access WHERE user_id=(SELECT id FROM users WHERE public_id=?)',[id],function(e){e?res.status(500).json({error:'Ошибка'}):res.json({ok:true,deleted:this.changes});});});
app.get('/api/admin/tournament-applications', adminOnly, (req, res) => {
  db.all(`SELECT a.id,a.user_id,a.nickname,a.category,a.steam_url,a.faceit_url,a.elo,a.telegram,a.created_at,
    u.public_id FROM tournament_applications a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC`,
    [], (e, rows) => e ? res.status(500).json({error:'Не удалось загрузить заявки'}) : res.json(rows || []));
});

app.get('/giveaways', (req, res) => res.sendFile(path.join(__dirname, 'public', 'giveaways.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/tournament', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-tournament.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

// BLUP Cases API: баланс и результат открытия обрабатываются на сервере.
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
app.get('/api/cases/balance',caseUser,(req,res)=>getCaseBalance(req.session.userId,(e,row)=>e?res.status(500).json({error:'Не удалось загрузить баланс'}):res.set('Cache-Control','no-store').json({balance:Number(row?.balance||0)})));
app.get('/api/cases/inventory',caseUser,(req,res)=>{db.run("UPDATE case_skin_withdrawals SET status='expired',reviewed_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='pending' AND expires_at IS NOT NULL AND julianday(expires_at)<=julianday('now')",[req.session.userId],e0=>{if(e0)return res.status(500).json({error:'Не удалось проверить таймер заявок'});db.all(`SELECT i.id,i.case_id,i.skin_id,i.skin_name,i.price,i.created_at,w.expires_at AS withdrawal_expires_at,EXISTS(SELECT 1 FROM case_skin_withdrawals w WHERE w.inventory_id=i.id AND w.status='pending') AS withdrawal_pending FROM case_inventory i LEFT JOIN case_skin_withdrawals w ON w.inventory_id=i.id AND w.status='pending' WHERE i.user_id=? ORDER BY i.id DESC LIMIT 50`,[req.session.userId],(e,rows)=>e?res.status(500).json({error:'Не удалось загрузить инвентарь'}):res.json({items:rows||[]}));});});

app.get('/api/cases/upgrader/catalog',(req,res)=>{
  const skins=Object.values(CASE_CATALOG.skins||{}).filter(s=>Number(s.price)>=0.2&&Number(s.price)<=50).map(s=>({id:s.id,name:s.name,price:Number(s.price),rarity:s.rarity||'common'}));
  res.set('Cache-Control','no-store').json({skins});
});

let casesSkinImageCache={at:0,images:{},rarities:{}};
const CASE_SKIN_IMAGE_DIR=path.join(__dirname,'public','assets','skins');
let skinImageDownloadRunning=false;
async function cacheCaseSkinImages(list){
  if(skinImageDownloadRunning)return;
  skinImageDownloadRunning=true;
  try{
    fs.mkdirSync(CASE_SKIN_IMAGE_DIR,{recursive:true});
    const byName=new Map(Object.values(CASE_CATALOG.skins||{}).map(s=>[s.name,s]));
    const jobs=(list||[]).filter(x=>x&&x.name&&x.image&&byName.has(x.name)).map(x=>({item:x,skin:byName.get(x.name)}));
    let cursor=0;
    const worker=async()=>{while(cursor<jobs.length){const job=jobs[cursor++];const file=path.join(CASE_SKIN_IMAGE_DIR,`${job.skin.id}.png`);if(fs.existsSync(file))continue;try{
      const response=await fetch(job.item.image,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'BLUP-CS2-Image-Cache/1.0'}});
      if(!response.ok)continue;
      const type=String(response.headers.get('content-type')||'');if(!type.startsWith('image/'))continue;
      const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>8*1024*1024)continue;
      await fs.promises.writeFile(file,bytes);
    }catch(err){console.warn('CS2 skin image cache failed:',job.skin.id,err.message)}}};
    await Promise.all(Array.from({length:6},worker));
  }finally{skinImageDownloadRunning=false;}
}
app.get('/api/cases/skin-images',async(req,res)=>{
  res.set('Cache-Control','no-store');
  let list=null;
  if(casesSkinImageCache.at>Date.now()-6*60*60*1000&&Object.keys(casesSkinImageCache.images).length){
    const images={...casesSkinImageCache.images};
    for(const skin of Object.values(CASE_CATALOG.skins||{})){const local=path.join(CASE_SKIN_IMAGE_DIR,`${skin.id}.png`);if(fs.existsSync(local))images[skin.name]=`/assets/skins/${skin.id}.png`;}
    return res.json({images,rarities:casesSkinImageCache.rarities||{}});
  }
  const sources=[
    'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json',
    'https://cdn.jsdelivr.net/gh/ByMykel/CSGO-API@main/public/api/en/skins.json',
    'https://bymykel.github.io/CSGO-API/api/en/skins.json'
  ];
  for(const url of sources){try{const response=await fetch(url,{signal:AbortSignal.timeout(18000)});if(response.ok){list=await response.json();if(Array.isArray(list)&&list.length)break;}}catch(err){console.warn('CS2 skin catalog source failed:',url,err.message)}}
  const wanted=new Map(Object.values(CASE_CATALOG.skins||{}).map(s=>[s.name,s]));
  const images={},rarities={};
  for(const item of list||[]){const skin=wanted.get(item?.name);if(!skin)continue;if(item.rarity?.name)rarities[item.name]=item.rarity.name;if(typeof item.image==='string'&&/^https:\/\//.test(item.image)){const local=path.join(CASE_SKIN_IMAGE_DIR,`${skin.id}.png`);images[item.name]=fs.existsSync(local)?`/assets/skins/${skin.id}.png`:item.image;}}
  if(Object.keys(images).length){casesSkinImageCache={at:Date.now(),images,rarities};cacheCaseSkinImages(list).catch(err=>console.warn('CS2 image cache task failed:',err.message));}
  return res.json({images,rarities});
});
app.post('/api/cases/upgrader',caseUser,(req,res)=>{
  const ids=Array.isArray(req.body?.sourceIds)?[...new Set(req.body.sourceIds.map(Number))]:[];
  const targetId=String(req.body?.targetSkinId||'');
  const balanceAmount=Math.round(Number(req.body?.balanceAmount||0)*100)/100;
  const requestedMultiplier=Number(req.body?.multiplier||0);
  const target=CASE_CATALOG.skins[targetId];
  if(ids.length>5||ids.some(n=>!Number.isSafeInteger(n)||n<1)||!Number.isFinite(balanceAmount)||balanceAmount<0||balanceAmount>100000)
    return res.status(400).json({error:'Проверь выбранные скины и сумму баланса'});
  if(!ids.length&&balanceAmount<=0)return res.status(400).json({error:'Выбери скины или добавь баланс'});
  if(!target||Number(target.price)<0.2||Number(target.price)>50)return res.status(400).json({error:'Целевой скин недоступен: максимум $50'});
  db.serialize(()=>{
    db.run('BEGIN IMMEDIATE',err=>{
      if(err)return res.status(500).json({error:'Не удалось начать апгрейд'});
      const rollback=(status,message)=>db.run('ROLLBACK',()=>res.status(status).json({error:message}));
      const finishItems=(items)=>{
        if(!items||items.length!==ids.length)return rollback(404,'Один из выбранных предметов не найден');
        if(items.some(x=>x.withdrawal_pending))return rollback(409,'Нельзя улучшать предмет с активной заявкой на вывод');
        db.get('SELECT balance FROM game_balance WHERE user_id=?',[req.session.userId],(be,balRow)=>{
          if(be)return rollback(500,'Не удалось проверить баланс');
          const currentBalance=Number(balRow?.balance||0);
          if(balanceAmount>currentBalance)return rollback(400,'На балансе недостаточно средств');
          const itemStake=items.reduce((a,x)=>a+Number(x.price||0),0);
          const stake=Number((itemStake+balanceAmount).toFixed(2));
          if(!Number.isFinite(requestedMultiplier)||requestedMultiplier<1.1||requestedMultiplier>20)return rollback(400,'Выбери множитель от x1.1 до x20');
          const expectedTarget=stake*requestedMultiplier;
          if(Math.abs(Number(target.price)-expectedTarget)>Math.max(0.15,expectedTarget*0.12))return rollback(400,`Для x${requestedMultiplier} выбери предмет около ${expectedTarget.toFixed(2)} USDT`);
          if(Number(target.price)<=stake)return rollback(400,'Выбери скин дороже общей суммы ставки');
          const chance=Number((stake/Number(target.price)*100).toFixed(4));
          if(chance<0.01)return rollback(400,'Шанс ниже минимального порога 0.01%');
          const roll=crypto.randomInt(0,1000000)/10000,won=roll<chance;
          const removeItems=idx=>{
            if(idx>=ids.length){
              const commitResult=inventoryId=>{
                db.run('COMMIT',commitErr=>commitErr?res.status(500).json({error:'Не удалось завершить апгрейд'}):res.json({ok:true,won,chance,roll,stake,balanceUsed:balanceAmount,balanceLeft:Number((currentBalance-balanceAmount).toFixed(2)),target:{id:target.id,name:target.name,price:target.price},...(inventoryId?{inventoryId}:{})}));
              };
              if(won)db.run('INSERT INTO case_inventory(user_id,case_id,skin_id,skin_name,price) VALUES(?,?,?,?,?)',[req.session.userId,'upgrader',target.id,target.name,target.price],function(insertErr){if(insertErr)return rollback(500,'Не удалось сохранить выигранный скин');commitResult(this.lastID)});
              else commitResult(null);
              return;
            }
            const itemId=ids[idx];
            db.run('DELETE FROM case_inventory WHERE id=? AND user_id=?',[itemId,req.session.userId],function(delErr){
              if(delErr||this.changes!==1)return rollback(409,'Предмет уже использован или изменился');
              removeItems(idx+1);
            });
          };
          const spendBalance=()=>{
            if(balanceAmount<=0)return removeItems(0);
            db.run('UPDATE game_balance SET balance=balance-? WHERE user_id=? AND balance>=?',[balanceAmount,req.session.userId,balanceAmount],function(updateErr){
              if(updateErr||this.changes!==1)return rollback(409,'Баланс изменился. Обнови страницу и попробуй снова');
              removeItems(0);
            });
          };
          spendBalance();
        });
      };
      if(!ids.length)return finishItems([]);
      const marks=ids.map(()=>'?').join(',');
      db.all(`SELECT i.*,EXISTS(SELECT 1 FROM case_skin_withdrawals w WHERE w.inventory_id=i.id AND w.status='pending') AS withdrawal_pending FROM case_inventory i WHERE i.user_id=? AND i.id IN (${marks})`,[req.session.userId,...ids],(e,items)=>e?rollback(500,'Ошибка базы данных'):finishItems(items));
    });
  });
});
app.post('/api/cases/inventory/:id/sell',caseUser,(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Некорректный предмет'});
  db.get(`SELECT i.*,EXISTS(SELECT 1 FROM case_skin_withdrawals w WHERE w.inventory_id=i.id AND w.status='pending') AS withdrawal_pending FROM case_inventory i WHERE i.id=? AND i.user_id=?`,[id,req.session.userId],(e,item)=>{
    if(e)return res.status(500).json({error:'Ошибка базы данных'});if(!item)return res.status(404).json({error:'Предмет не найден'});if(item.withdrawal_pending)return res.status(409).json({error:'Предмет уже зарезервирован для вывода'});
    const credit=Number(Number(item.price).toFixed(2));
    db.serialize(()=>{db.run('BEGIN IMMEDIATE');db.run('DELETE FROM case_inventory WHERE id=? AND user_id=?',[id,req.session.userId],function(e2){if(e2||this.changes!==1){db.run('ROLLBACK');return res.status(409).json({error:'Предмет уже обработан'});}db.run('INSERT OR IGNORE INTO game_balance(user_id,balance) VALUES(?,0)',[req.session.userId],e3=>{if(e3){db.run('ROLLBACK');return res.status(500).json({error:'Ошибка баланса'});}db.run('UPDATE game_balance SET balance=balance+? WHERE user_id=?',[credit,req.session.userId],e4=>{if(e4){db.run('ROLLBACK');return res.status(500).json({error:'Не удалось начислить баланс'});}db.run('COMMIT',e5=>e5?res.status(500).json({error:'Ошибка сохранения'}):db.get('SELECT balance FROM game_balance WHERE user_id=?',[req.session.userId],(e6,b)=>res.json({ok:true,credited:credit,balance:Number(b?.balance||0)})));});});});});
  });
});
app.post('/api/cases/inventory/:id/withdraw',caseUser,(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Некорректный предмет'});
  db.get('SELECT steam_trade_url FROM users WHERE id=?',[req.session.userId],(e,u)=>{
    if(e)return res.status(500).json({error:'Ошибка базы данных'});if(!u?.steam_trade_url)return res.status(400).json({error:'Сначала добавь Steam Trade URL в профиле'});
    db.get('SELECT * FROM case_inventory WHERE id=? AND user_id=?',[id,req.session.userId],(e2,item)=>{
      if(e2)return res.status(500).json({error:'Ошибка базы данных'});if(!item)return res.status(404).json({error:'Предмет не найден'});
      const expiresAt = new Date(Date.now()+45*60*1000).toISOString();
      db.run('INSERT INTO case_skin_withdrawals(user_id,nickname,inventory_id,skin_id,skin_name,price,steam_trade_url,expires_at) VALUES(?,?,?,?,?,?,?,?)',[req.session.userId,req.session.nickname,id,item.skin_id,item.skin_name,item.price,u.steam_trade_url,expiresAt],function(e3){
        if(e3){if(String(e3.message).includes('UNIQUE'))return res.status(409).json({error:'Для этого предмета уже есть заявка'});return res.status(500).json({error:'Не удалось создать заявку'});}
        const wid=this.lastID;notifyAdmin({operation:'case_skin_withdraw',nickname:req.session.nickname,skin_name:item.skin_name,price:item.price,steam_trade_url:u.steam_trade_url,id:wid}).catch(()=>{});res.json({ok:true,id:wid,expiresAt,message:'Заявка создана. Ожидай обработки до 45 минут.'});
      });
    });
  });
});
app.post('/api/cases/promo-preview',caseUser,(req,res)=>{
  const code=String(req.body?.code||'').trim().slice(0,40); if(!code)return res.status(400).json({error:'Введи промокод'});
  db.get('SELECT * FROM promos WHERE code=? COLLATE NOCASE AND active=1',[code],(e,promo)=>{
    if(e)return res.status(500).json({error:'Ошибка базы данных'}); if(!promo)return res.status(404).json({error:'Промокод не найден или отключён'});
    if(promo.reward_type!=='deposit_bonus')return res.status(400).json({error:'Этот промокод не даёт бонус к пополнению'});
    if(Number(promo.activation_limit)>0&&Number(promo.activation_count)>=Number(promo.activation_limit))return res.status(400).json({error:'Лимит активаций промокода исчерпан'});
    db.get('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?',[promo.id,req.session.userId],(e2,used)=>e2?res.status(500).json({error:'Ошибка базы данных'}):used?res.status(409).json({error:'Ты уже использовал этот промокод'}):res.json({ok:true,code:promo.code,percent:Math.min(100,Math.max(0,Number(promo.reward_value)||0))}));
  });
});
app.post('/api/cases/deposit',caseUser,(req,res)=>{
  const amount=Number(req.body?.amount),tokenAmount=Number(req.body?.tokenAmount||0),unitRate=Number(req.body?.unitRate||1),coin=String(req.body?.coin||'').toUpperCase(),network=String(req.body?.network||'').toUpperCase(),tx=String(req.body?.tx||'').trim().slice(0,180),code=String(req.body?.code||'').trim().slice(0,40);
  if(!Number.isFinite(amount)||amount<1||amount>10000||!Number.isFinite(tokenAmount)||tokenAmount<=0||!Number.isFinite(unitRate)||unitRate<=0)return res.status(400).json({error:'Проверь сумму и курс перевода'});
  const wallet=coin==='TON'?CASE_WALLETS.GRAM?.[network]:CASE_WALLETS[coin]?.[network];if(!wallet)return res.status(400).json({error:'Недопустимая валютная сеть'});if(!tx)return res.status(400).json({error:'Укажи хэш транзакции после отправки'});
  const create=(promo=null)=>{const percent=promo?Math.min(100,Math.max(0,Number(promo.reward_value)||0)):0;const bonus=Number((amount*percent/100).toFixed(2));db.run('INSERT INTO case_deposits(user_id,nickname,amount,token_amount,unit_rate,coin,network,wallet,tx_hash,promo_id,promo_code,promo_percent,bonus_amount,credited_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[req.session.userId,req.session.nickname,amount,tokenAmount,unitRate,coin,network,wallet,tx||null,promo?.id||null,promo?.code||null,percent,bonus,Number((amount+bonus).toFixed(2))],function(e){if(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Этот хэш транзакции уже отправляли'});return res.status(500).json({error:'Не удалось создать заявку'});}notifyAdmin({operation:'case_deposit',nickname:req.session.nickname,amount,tokenAmount,coin,network,wallet,tx_hash:tx,promoPercent:percent,bonusAmount:bonus,id:this.lastID}).catch(()=>{});res.json({ok:true,id:this.lastID,credited:amount+bonus});});};
  if(!code)return create();
  db.get('SELECT * FROM promos WHERE code=? COLLATE NOCASE AND active=1',[code],(e,promo)=>{if(e)return res.status(500).json({error:'Ошибка базы данных'});if(!promo)return res.status(404).json({error:'Промокод не найден'});if(promo.reward_type!=='deposit_bonus')return res.status(400).json({error:'Промокод не подходит для пополнения'});if(Number(promo.activation_limit)>0&&Number(promo.activation_count)>=Number(promo.activation_limit))return res.status(400).json({error:'Лимит промокода исчерпан'});db.get('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?',[promo.id,req.session.userId],(e2,used)=>{if(e2)return res.status(500).json({error:'Ошибка базы данных'});if(used)return res.status(409).json({error:'Ты уже использовал этот промокод'});db.get("SELECT id FROM case_deposits WHERE promo_id=? AND user_id=? AND status='pending'",[promo.id,req.session.userId],(e3,pending)=>pending?res.status(409).json({error:'У тебя уже есть пополнение с этим промокодом на проверке'}):create(promo));});});
});
app.post('/api/cases/withdraw',caseUser,(req,res)=>{
  const amount=Number(req.body?.amount),phone=String(req.body?.phone||'').trim().slice(0,80),bank=String(req.body?.bank||'').trim().slice(0,80),type=String(req.body?.type||'phone');
  if(!Number.isFinite(amount)||amount<10||amount>10000)return res.status(400).json({error:'Минимальная сумма вывода — $10'});if(!phone||!bank)return res.status(400).json({error:'Заполни реквизиты и банк'});if(!['phone','card'].includes(type))return res.status(400).json({error:'Недопустимый способ вывода'});
  getCaseBalance(req.session.userId,(e,row)=>{if(e)return res.status(500).json({error:'Ошибка баланса'});if(Number(row?.balance||0)<amount)return res.status(400).json({error:'Недостаточно средств'});db.serialize(()=>{db.run('BEGIN IMMEDIATE');db.run('UPDATE game_balance SET balance=balance-? WHERE user_id=? AND balance>=?',[amount,req.session.userId,amount],function(e2){if(e2||this.changes!==1){db.run('ROLLBACK');return res.status(400).json({error:'Недостаточно средств'});}db.run('INSERT INTO case_withdrawals(user_id,nickname,amount,payout_type,phone,bank) VALUES(?,?,?,?,?,?)',[req.session.userId,req.session.nickname,amount,type,phone,bank],function(e3){if(e3){db.run('ROLLBACK');return res.status(500).json({error:'Не удалось создать заявку'});}const id=this.lastID;db.run('COMMIT',e4=>{if(e4)return res.status(500).json({error:'Ошибка сохранения заявки'});notifyAdmin({operation:'case_withdraw',nickname:req.session.nickname,amount,phone,bank,id}).catch(()=>{});db.get('SELECT balance FROM game_balance WHERE user_id=?',[req.session.userId],(e5,b)=>res.json({ok:true,id,balance:Number(b?.balance||0)}));});});});});});
});
app.post('/api/cases/case-promo-preview',caseUser,(req,res)=>{
  const code=String(req.body?.code||'').trim();const caseId=String(req.body?.caseId||'');if(!code)return res.status(400).json({error:'Введи промокод'});
  db.get('SELECT * FROM case_promos WHERE code=? COLLATE NOCASE AND active=1',[code],(e,p)=>{if(e)return res.status(500).json({error:'Ошибка базы'});if(!p)return res.status(404).json({error:'Промокод не найден'});if(p.case_id!=='*'&&p.case_id!==caseId)return res.status(400).json({error:'Промокод не подходит для этого кейса'});if(Number(p.activation_limit)>0&&Number(p.activation_count)>=Number(p.activation_limit))return res.status(400).json({error:'Лимит промокода исчерпан'});db.get('SELECT id FROM case_promo_redemptions WHERE promo_id=? AND user_id=?',[p.id,req.session.userId],(e2,u)=>e2?res.status(500).json({error:'Ошибка базы'}):u?res.status(409).json({error:'Ты уже использовал этот промокод'}):res.json({ok:true,code:p.code,promoType:p.promo_type||'discount',percent:p.promo_type==='free' ? 0 : Math.min(90,Math.max(0,Number(p.discount_percent)||0)),caseId:p.case_id,freeOpenings:p.promo_type==='free'?1:0}));});
});
app.post('/api/cases/open',caseUser,(req,res)=>{
  const caseId=String(req.body?.caseId||'');const c=CASE_CATALOG.cases.find(x=>x.id===caseId);if(!c)return res.status(404).json({error:'Кейс не найден'});
  const count=Math.max(1,Math.min(5,Math.floor(Number(req.body?.count)||1)));
  const options=c.items.map(id=>CASE_CATALOG.skins[id]).filter(x=>x&&Number(x.price)>=0.2&&Number(x.price)<=50);if(options.length<15)return res.status(500).json({error:'Каталог кейса повреждён'});
  const choose=()=>{const chanceMap=c.chances||{};const explicit=Object.keys(chanceMap).length>0;const weights=options.map(x=>explicit?Math.max(0,Math.round(Number(chanceMap[x.id]||0)*10000)):Math.max(1,Math.floor(1000000000000/Math.pow(Math.max(.2,x.price),2.5))));const total=weights.reduce((a,b)=>a+b,0);if(!total)throw new Error('Шансы кейса не настроены');let roll=crypto.randomInt(total),chosen=options[0];for(let i=0;i<options.length;i++){roll-=weights[i];if(roll<0){chosen=options[i];break;}}return chosen;};
  const proceed=(promo=null)=>{
    const isFree=promo?.promo_type==='free';const freeCount=isFree?1:0;const discount=isFree?0:Math.min(90,Math.max(0,Number(promo?.discount_percent)||0));const charge=Number((c.price*(1-discount/100)*(count-freeCount)).toFixed(2));
    let chosen=[];try{for(let i=0;i<count;i++)chosen.push(choose())}catch(err){return res.status(500).json({error:err.message});}
    getCaseBalance(req.session.userId,(e,row)=>{if(e)return res.status(500).json({error:'Ошибка баланса'});if(Number(row?.balance||0)<charge)return res.status(400).json({error:'Недостаточно средств для открытия выбранного количества кейсов'});
      db.serialize(()=>{db.run('BEGIN IMMEDIATE');db.run('UPDATE game_balance SET balance=balance-? WHERE user_id=? AND balance>=?',[charge,req.session.userId,charge],function(e2){if(e2||this.changes!==1){db.run('ROLLBACK');return res.status(400).json({error:'Недостаточно средств'});}
        const saved=[];let i=0;const saveNext=()=>{if(i>=chosen.length){const finish=()=>db.run('COMMIT',e5=>{if(e5)return res.status(500).json({error:'Ошибка завершения открытия'});db.get('SELECT balance FROM game_balance WHERE user_id=?',[req.session.userId],(e6,b)=>res.json({ok:true,balance:Number(b?.balance||0),items:saved,item:saved[0]?.item,inventoryIds:saved.map(x=>x.inventoryId),inventoryId:saved[0]?.inventoryId,charged:charge,discount,freeCount,basePrice:c.price,count}));});if(promo){db.run('INSERT INTO case_promo_redemptions(promo_id,user_id) VALUES(?,?)',[promo.id,req.session.userId],e3=>{if(e3){db.run('ROLLBACK');return res.status(409).json({error:'Промокод уже использован'});}db.run('UPDATE case_promos SET activation_count=activation_count+1 WHERE id=?',[promo.id],e4=>e4?(db.run('ROLLBACK'),res.status(500).json({error:'Не удалось учесть промокод'})):finish());});}else finish();return;}
          const item=chosen[i++];db.run('INSERT INTO case_openings(user_id,case_id,case_name,cost,skin_id,skin_name,skin_price) VALUES(?,?,?,?,?,?,?)',[req.session.userId,c.id,c.name,Number((c.price*(1-discount/100)*(i-1<freeCount?0:1)).toFixed(2)),item.id,item.name,item.price],function(e3){if(e3){db.run('ROLLBACK');return res.status(500).json({error:'Не удалось сохранить открытие'});}db.run('INSERT INTO case_inventory(user_id,case_id,skin_id,skin_name,price) VALUES(?,?,?,?,?)',[req.session.userId,c.id,item.id,item.name,item.price],function(e4){if(e4){db.run('ROLLBACK');return res.status(500).json({error:'Не удалось сохранить предмет'});}saved.push({item,inventoryId:this.lastID});saveNext();});});};saveNext();
      });});
    });
  };
  const code=String(req.body?.promoCode||'').trim();if(!code)return proceed();db.get('SELECT * FROM case_promos WHERE code=? COLLATE NOCASE AND active=1',[code],(e,promo)=>{if(e)return res.status(500).json({error:'Ошибка базы'});if(!promo)return res.status(400).json({error:'Промокод не найден'});if(promo.case_id!=='*'&&promo.case_id!==caseId)return res.status(400).json({error:'Промокод не подходит для этого кейса'});if(Number(promo.activation_limit)>0&&Number(promo.activation_count)>=Number(promo.activation_limit))return res.status(400).json({error:'Лимит промокода исчерпан'});db.get('SELECT id FROM case_promo_redemptions WHERE promo_id=? AND user_id=?',[promo.id,req.session.userId],(e2,used)=>e2?res.status(500).json({error:'Ошибка базы'}):used?res.status(409).json({error:'Ты уже использовал этот промокод'}):proceed(promo));});
});
app.get('/api/admin/cases/promos',adminOnly,(req,res)=>db.all('SELECT * FROM case_promos ORDER BY id DESC',[],(e,rows)=>e?res.status(500).json({error:'Ошибка загрузки промокодов'}):res.json(rows||[])));
app.post('/api/admin/cases/promos',adminOnly,(req,res)=>{const code=String(req.body?.code||'').trim().toUpperCase(),caseId=String(req.body?.caseId||'*'),type=req.body?.promoType==='free'?'free':'discount',discount=Number(req.body?.discount),limit=Math.max(0,Math.floor(Number(req.body?.limit)||0));if(!/^[A-Z0-9_-]{3,32}$/.test(code))return res.status(400).json({error:'Код: 3–32 символа, латиница/цифры'});if(type==='discount'&&(!Number.isFinite(discount)||discount<=0||discount>90))return res.status(400).json({error:'Скидка должна быть от 1 до 90%'});if(caseId!=='*'&&!CASE_CATALOG.cases.some(c=>c.id===caseId))return res.status(400).json({error:'Кейс не найден'});db.run('INSERT INTO case_promos(code,case_id,discount_percent,promo_type,activation_limit) VALUES(?,?,?,?,?)',[code,caseId,type==='free'?0:discount,type,limit],function(e){if(e)return res.status(409).json({error:'Такой промокод уже существует'});res.json({ok:true,id:this.lastID});});});
app.delete('/api/admin/cases/promos/:id',adminOnly,(req,res)=>db.run('DELETE FROM case_promos WHERE id=?',[Number(req.params.id)],function(e){if(e)return res.status(500).json({error:'Не удалось удалить промокод'});if(!this.changes)return res.status(404).json({error:'Промокод не найден'});res.json({ok:true});}));
app.get('/api/admin/cases/catalog',adminOnly,(req,res)=>{for(const c of CASE_CATALOG.cases){if(!c.chances){const vals=c.items.map(id=>{const price=Math.max(.2,Number(CASE_CATALOG.skins[id]?.price)||.2);return 1/Math.pow(price,2.5)});const sum=vals.reduce((a,b)=>a+b,0)||1;c.chances={};c.items.forEach((id,i)=>c.chances[id]=Number((vals[i]/sum*100).toFixed(4)));}}res.json(CASE_CATALOG)});
app.put('/api/admin/cases/catalog',adminOnly,(req,res)=>{
  const incoming=req.body;
  if(!incoming||!Array.isArray(incoming.cases)||!incoming.skins||typeof incoming.skins!=='object')return res.status(400).json({error:'Некорректный каталог'});
  for(const c of incoming.cases){if(!Number.isFinite(Number(c.price))||Number(c.price)<0.01||Number(c.price)>100000)return res.status(400).json({error:`Проверь цену кейса ${c.name||c.id}: допустимо $0.01–$100000`});if(!Array.isArray(c.items)||!c.items.length)return res.status(400).json({error:`В кейсе ${c.name||c.id} нет предметов`});let sum=0;for(const id of c.items){const skin=incoming.skins[id];if(!skin||!Number.isFinite(Number(skin.price))||Number(skin.price)<0.2||Number(skin.price)>50)return res.status(400).json({error:`Проверь цену предмета ${id}: допустимо $0.20–$50`});const chance=Number(c.chances?.[id]);if(!Number.isFinite(chance)||chance<0||chance>100)return res.status(400).json({error:`Некорректный шанс предмета ${skin.name||id}`});sum+=chance;}if(sum<=0)return res.status(400).json({error:`Сумма шансов в кейсе ${c.name||c.id} должна быть больше нуля`});}
  try{const json=JSON.stringify(incoming,null,2);fs.writeFileSync(CASE_CATALOG_FILE,json);fs.writeFileSync(CASE_CATALOG_PUBLIC_FILE,json);CASE_CATALOG=incoming;res.json({ok:true});}catch(e){console.error('cases catalog save:',e);res.status(500).json({error:'Не удалось сохранить каталог'});}
});
app.get('/api/admin/cases/deposits',adminOnly,(req,res)=>db.all(`SELECT d.*,u.public_id FROM case_deposits d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 200`,[],(e,rows)=>e?res.status(500).json({error:'Ошибка загрузки'}):res.json(rows||[])));
app.get('/api/admin/cases/withdrawals',adminOnly,(req,res)=>db.all(`SELECT w.*,u.public_id FROM case_withdrawals w LEFT JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200`,[],(e,rows)=>e?res.status(500).json({error:'Ошибка загрузки'}):res.json(rows||[])));
app.post('/api/admin/cases/deposits/:id/status',adminOnly,(req,res)=>{const id=Number(req.params.id),status=String(req.body?.status||'');if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Недопустимый статус'});db.get('SELECT * FROM case_deposits WHERE id=?',[id],(e,d)=>{if(e||!d)return res.status(404).json({error:'Заявка не найдена'});if(d.status!=='pending')return res.status(409).json({error:'Заявка уже обработана'});db.serialize(()=>{db.run('BEGIN IMMEDIATE');db.run("UPDATE case_deposits SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",[status,id],function(e2){if(e2||this.changes!==1){db.run('ROLLBACK');return res.status(409).json({error:'Заявка уже обработана'});}const finish=()=>db.run('COMMIT',e3=>e3?res.status(500).json({error:'Ошибка сохранения'}):res.json({ok:true}));if(status==='approved'){db.run('INSERT OR IGNORE INTO game_balance(user_id,balance) VALUES(?,0)',[d.user_id],e3=>{if(e3){db.run('ROLLBACK');return res.status(500).json({error:'Ошибка баланса'});}db.run('UPDATE game_balance SET balance=balance+? WHERE user_id=?',[d.credited_amount,d.user_id],e4=>{if(e4){db.run('ROLLBACK');return res.status(500).json({error:'Не удалось зачислить баланс'});}if(d.promo_id){db.run('INSERT OR IGNORE INTO promo_redemptions(promo_id,user_id,nickname) VALUES(?,?,?)',[d.promo_id,d.user_id,d.nickname]);db.run('UPDATE promos SET activation_count=activation_count+1 WHERE id=?',[d.promo_id]);}finish();});});}else finish();});});});});
app.post('/api/admin/cases/withdrawals/:id/status',adminOnly,(req,res)=>{const id=Number(req.params.id),status=String(req.body?.status||'');if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Недопустимый статус'});db.get('SELECT * FROM case_withdrawals WHERE id=?',[id],(e,w)=>{if(e||!w)return res.status(404).json({error:'Заявка не найдена'});if(w.status!=='pending')return res.status(409).json({error:'Заявка уже обработана'});db.serialize(()=>{db.run('BEGIN IMMEDIATE');db.run("UPDATE case_withdrawals SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",[status,id],function(e2){if(e2||this.changes!==1){db.run('ROLLBACK');return res.status(409).json({error:'Заявка уже обработана'});}if(status==='rejected')db.run('UPDATE game_balance SET balance=balance+? WHERE user_id=?',[w.amount,w.user_id],e3=>{if(e3){db.run('ROLLBACK');return res.status(500).json({error:'Не удалось вернуть средства'});}db.run('COMMIT',e4=>e4?res.status(500).json({error:'Ошибка'}):res.json({ok:true}));});else db.run('COMMIT',e3=>e3?res.status(500).json({error:'Ошибка'}):res.json({ok:true}));});});});});
app.delete('/api/admin/cases/deposits/:id',adminOnly,(req,res)=>{const id=Number(req.params.id);db.run('DELETE FROM case_deposits WHERE id=?',[id],function(e){if(e)return res.status(500).json({error:'Не удалось удалить заявку'});if(!this.changes)return res.status(404).json({error:'Заявка не найдена'});res.json({ok:true});});});
app.delete('/api/admin/cases/withdrawals/:id',adminOnly,(req,res)=>{const id=Number(req.params.id);db.get('SELECT * FROM case_withdrawals WHERE id=?',[id],(e,w)=>{if(e)return res.status(500).json({error:'Ошибка базы'});if(!w)return res.status(404).json({error:'Заявка не найдена'});db.serialize(()=>{db.run('BEGIN IMMEDIATE');const del=()=>db.run('DELETE FROM case_withdrawals WHERE id=?',[id],e2=>e2?(db.run('ROLLBACK'),res.status(500).json({error:'Не удалось удалить'})):db.run('COMMIT',e3=>e3?res.status(500).json({error:'Ошибка сохранения'}):res.json({ok:true})));if(w.status==='pending')db.run('UPDATE game_balance SET balance=balance+? WHERE user_id=?',[w.amount,w.user_id],e2=>e2?(db.run('ROLLBACK'),res.status(500).json({error:'Не удалось вернуть зарезервированные средства'})):del());else del();});});});
app.get('/api/admin/cases/skin-withdrawals',adminOnly,(req,res)=>db.all(`SELECT w.*,u.public_id FROM case_skin_withdrawals w LEFT JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200`,[],(e,rows)=>e?res.status(500).json({error:'Ошибка загрузки'}):res.json(rows||[])));
app.post('/api/admin/cases/skin-withdrawals/:id/status',adminOnly,(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||'');if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Недопустимый статус'});
  db.get('SELECT * FROM case_skin_withdrawals WHERE id=?',[id],(e,w)=>{if(e||!w)return res.status(404).json({error:'Заявка не найдена'});if(w.status!=='pending')return res.status(409).json({error:'Заявка уже обработана'});
    db.serialize(()=>{db.run('BEGIN IMMEDIATE');db.run("UPDATE case_skin_withdrawals SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",[status,id],function(e2){if(e2||this.changes!==1){db.run('ROLLBACK');return res.status(409).json({error:'Заявка уже обработана'});}const finish=()=>db.run('COMMIT',e3=>e3?res.status(500).json({error:'Ошибка сохранения'}):res.json({ok:true}));if(status==='approved')db.run('DELETE FROM case_inventory WHERE id=? AND user_id=?',[w.inventory_id,w.user_id],e3=>e3?(db.run('ROLLBACK'),res.status(500).json({error:'Не удалось списать предмет'})):finish());else finish();});});
  });
});
app.delete('/api/admin/cases/skin-withdrawals/:id',adminOnly,(req,res)=>{const id=Number(req.params.id);db.run('DELETE FROM case_skin_withdrawals WHERE id=?',[id],function(e){if(e)return res.status(500).json({error:'Не удалось удалить заявку'});if(!this.changes)return res.status(404).json({error:'Заявка не найдена'});res.json({ok:true});});});
app.get('/api/cases/config',(req,res)=>db.get('SELECT value FROM settings WHERE key=?',['usdt_rate'],(e,row)=>e?res.status(500).json({error:'Ошибка курса'}):res.json({rubPerUsd:Number(row?.value)||82.829,rateSource:Number(row?.value)>0?'admin':'market-snapshot'})));
app.get('/cases/profile', (req,res)=>res.sendFile(path.join(__dirname,'public','cases-profile.html')));
app.get('/cases/upgrader', (req,res)=>res.sendFile(path.join(__dirname,'public','cases-upgrader.html')));
app.get('/cases/:caseId', (req,res)=>{if(!CASE_CATALOG.cases.some(c=>c.id===String(req.params.caseId)))return res.status(404).send('Кейс не найден');res.sendFile(path.join(__dirname,'public','case-open.html'));});
app.get('/cases', (req,res)=>res.sendFile(path.join(__dirname,'public','cases.html')));
app.get('/games', (req,res)=>res.redirect(302,'/cases'));
app.get('/admin/cases',(req,res)=>res.sendFile(path.join(__dirname,'public','admin-cases.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// API 404 — только после всех API-маршрутов, в том числе BLUP Cases.
app.use('/api', (req, res) => res.status(404).json({ error: `API-маршрут не найден: ${req.method} ${req.originalUrl}` }));

db.ready.then(() => app.listen(PORT, () => console.log(`BLUP запущен на порту ${PORT}`))).catch(err => { console.error('Ошибка:', err); process.exit(1); });
