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

if (!process.env.BLUP_ADMIN_PASSWORD) console.warn('Админ-вход отключён: задайте BLUP_ADMIN_PASSWORD.');
app.set('trust proxy', 1);
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

// ==========================================
// ОТСЛЕЖИВАНИЕ ОНЛАЙНА
// ==========================================
const onlineUsers = new Map();

app.use((req, res, next) => {
  if (req.path.startsWith('/api/online') || req.path.match(/\.(css|js|png|jpg|svg|ico|woff|woff2)$/)) {
    return next();
  }
  const identifier = req.session?.userId ? `user_${req.session.userId}` : `ip_${ipOf(req)}`;
  onlineUsers.set(identifier, Date.now());
  next();
});

app.get('/api/online', (req, res) => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  let count = 0;

  onlineUsers.forEach((lastSeen, id) => {
    if (now - lastSeen < fiveMinutes) {
      count++;
    } else {
      onlineUsers.delete(id);
    }
  });

  res.json({ online: count > 0 ? count : 1 });
});
// ==========================================

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
  if (user) db.run('UPDATE users SET last_ip=?,last_seen=CURRENT_TIMESTAMP WHERE id=?', [ip, user.id]);
}
function sendBlocked(res) { return res.status(403).json({ error: 'Аккаунт заблокирован. Обратитесь в поддержку.' }); }

app.use('/api', (req, res, next) => {
  const ip = ipOf(req);
  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (err, ban) => {
    if (err) return res.status(500).json({ error: 'Ошибка проверки доступа: ' + err.message });
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

app.get('/api/status', (req, res) => getSetting('stopped', '0', (e, stopped) => res.json({ stopped: stopped === '1' && req.session.isAdmin !== true })));
app.get('/api/config', (req, res) => {
  db.all('SELECT key,value FROM settings WHERE key IN (\'usdt_rate\',\'gram_rate\',\'reserve_total\',\'reserve_available\',\'banks\')', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка настроек' });
    const s = Object.fromEntries(rows.map(x => [x.key, x.value]));
    let banks = []; try { banks = JSON.parse(s.banks || '[]'); } catch {}
    res.json({ usdtRate: Number(s.usdt_rate || 0), gramRate: Number(s.gram_rate || 0), reserveTotal: Number(s.reserve_total || 0), reserveAvailable: Number(s.reserve_available || 0), banks, wallets: BLUP_WALLETS });
  });
});

app.get('/api/auth/telegram/config', (req, res) => {
  const token = process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
  if (!token) return res.status(503).json({ error: 'Telegram-вход не настроен' });
  const botId = token.split(':')[0];
  if (!botId || isNaN(botId)) return res.status(503).json({ error: 'Некорректный токен бота' });
  res.json({ botId });
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

app.post('/api/auth/telegram', (req, res) => {
  const ip = ipOf(req);
  const data = req.body || {};
  const botToken = process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
  if (!botToken) return res.status(503).json({ error: 'Telegram-вход не настроен на сервере' });
  if (!data.id || !data.auth_date || !data.hash) return res.status(400).json({ error: 'Некорректные данные Telegram' });
  if (rateLimit(`tg:${ip}`, 20)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
  if (Math.floor(Date.now()/1000) - Number(data.auth_date) > 300) {
    return res.status(400).json({ error: 'Подпись Telegram устарела. Попробуйте снова.' });
  }
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const checkString = Object.keys(data).filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== data.hash) return res.status(403).json({ error: 'Подпись Telegram неверна' });

  db.get('SELECT ip FROM ip_bans WHERE ip=?', [ip], (e, ban) => {
    if (e) return res.status(500).json({ error: 'Ошибка БД' });
    if (ban) return sendBlocked(res);

    const finishLogin = user => {
      if (!user || user.is_banned) return sendBlocked(res);
      req.session.regenerate(regErr => {
        if (regErr) return res.status(500).json({ error: 'Не удалось создать сессию' });
        req.session.userId = user.id;
        req.session.nickname = user.nickname;
        req.session.sessionVersion = user.session_version || 0;
        logVisit(user, ip, 'login_telegram');
        
        if (user.isNew) {
          notifyNewUser({
            nickname: user.nickname,
            publicId: user.public_id,
            telegramId: data.id,
            telegramUsername: data.username || 'нет юзернейма'
          }).catch(() => {});
        }

        req.session.save(() => res.json({ ok: true, nickname: user.nickname }));
      });
    };

    db.get('SELECT * FROM users WHERE telegram_id=?', [data.id], (err, byTg) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      if (byTg) {
        db.run(`UPDATE users SET telegram_username=?, telegram_first_name=?, telegram_last_name=?, telegram_photo_url=?, last_ip=?, last_seen=CURRENT_TIMESTAMP WHERE id=?`,
          [data.username || null, data.first_name || null, data.last_name || null, data.photo_url || null, ip, byTg.id]);
        return finishLogin(byTg);
      }
      const baseNick = (data.username || `tg_${data.id}`).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20) || `tg_${data.id}`;
      const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
      let publicId;
      const pickId = cb => { const n = Math.floor(Math.random()*99999)+1;
        db.get('SELECT id FROM users WHERE public_id=?',[n],(e,row)=>row?pickId(cb):cb(n)); };
      pickId(pid => {
        publicId = pid;
        const tryInsert = (nick, cb) => {
          db.run(`INSERT INTO users(nickname,password_hash,last_ip,last_seen,public_id,telegram_id,telegram_username,telegram_first_name,telegram_last_name,telegram_photo_url)
                  VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?)`,
            [nick, randomHash, ip, pid, data.id, data.username||null, data.first_name||null, data.last_name||null, data.photo_url||null],
            function(insErr) {
              if (insErr) return cb(insErr);
              cb(null, { id: this.lastID, nickname: nick, session_version: 0, is_banned: 0 });
            });
        };
        tryInsert(baseNick, (err1, user1) => {
          if (!err1) { 
            user1.isNew = true; 
            user1.public_id = pid; 
            return finishLogin(user1); 
          }
          tryInsert(`${baseNick}_${data.id}`.slice(0,24), (err2, user2) => {
            if (err2) return res.status(500).json({ error: 'Не удалось создать аккаунт' });
            user2.isNew = true;
            user2.public_id = pid;
            finishLogin(user2);
          });
        });
      });
    });
  });
});

app.post('/api/auth/link-telegram', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт' });
  const data = req.body || {};
  const botToken = process.env.REGISTER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '8759385015:AAGQ1j6EOD26qGZQ3nzlrX7n9pzcP_MnUsI';
  if (!botToken) return res.status(503).json({ error: 'Telegram-вход не настроен на сервере' });
  if (!data.id || !data.auth_date || !data.hash) return res.status(400).json({ error: 'Некорректные данные Telegram' });
  if (Math.floor(Date.now()/1000) - Number(data.auth_date) > 300) {
    return res.status(400).json({ error: 'Подпись Telegram устарела. Попробуйте снова.' });
  }
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const checkString = Object.keys(data).filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== data.hash) return res.status(403).json({ error: 'Подпись Telegram неверна' });

  db.get('SELECT id, nickname FROM users WHERE telegram_id=? AND id!=?', [data.id, req.session.userId], (err, existing) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    if (existing) return res.status(409).json({ error: 'Этот Telegram уже привязан к другому аккаунту' });

    db.run(`UPDATE users SET telegram_id=?, telegram_username=?, telegram_first_name=?, telegram_last_name=?, telegram_photo_url=? WHERE id=?`,
      [data.id, data.username || null, data.first_name || null, data.last_name || null, data.photo_url || null, req.session.userId], function(updErr) {
        if (updErr) return res.status(500).json({ error: 'Не удалось привязать Telegram' });
        
        db.get('SELECT public_id, nickname FROM users WHERE id=?', [req.session.userId], (e, user) => {
          notifyNewUser({
            nickname: user.nickname,
            publicId: user.public_id,
            telegramId: data.id,
            telegramUsername: data.username || 'нет юзернейма'
          }).catch(() => {});
          res.json({ ok: true });
        });
      });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('blup.sid'); res.json({ ok: true }); }));
app.get('/api/me', (req, res) => res.json({ nickname: req.session.nickname || null }));

app.get('/api/history', (req, res) => {
  const query = req.session.userId
    ? ["SELECT id,nickname,coin,network,operation_type,status,amount,created_at FROM sales WHERE user_id=? AND operation_type='sell' ORDER BY id DESC LIMIT 100", [req.session.userId]]
    : ["SELECT id,nickname,coin,network,operation_type,status,amount,created_at FROM sales WHERE user_id IS NULL AND operation_type='sell' ORDER BY id DESC LIMIT 50", []];
  db.all(query[0], query[1], (err, rows) => err ? res.status(500).json({ error: 'Не удалось загрузить историю' }) : res.json(rows || []));
});

// ==========================================
// ИГРЫ / GAMES
// ==========================================
app.get('/api/games/balance', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт' });
  db.get('SELECT balance FROM game_balance WHERE user_id=?', [req.session.userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    if (!row) {
      db.run('INSERT INTO game_balance(user_id, balance) VALUES(?, 100)', [req.session.userId]); // Бонус 100 при первом входе
      return res.json({ balance: 100 });
    }
    res.json({ balance: row.balance });
  });
});

app.post('/api/games/deposit', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт' });
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) return res.status(400).json({ error: 'Сумма от 1 до 1000' });
  db.run('INSERT INTO game_balance(user_id, balance) VALUES(?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance', [req.session.userId, amount], err => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    res.json({ ok: true });
  });
});

app.post('/api/games/bet', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт' });
  const { game, amount, multiplier } = req.body || {};
  const bet = Number(amount);
  const mult = Number(multiplier);
  const gameType = String(game);
  
  if (!Number.isFinite(bet) || bet <= 0 || !['x50', 'x100'].includes(gameType) || ![2,3,5,10,15,20,50,100].includes(mult)) {
    return res.status(400).json({ error: 'Некорректные данные ставки' });
  }

  db.get('SELECT balance FROM game_balance WHERE user_id=?', [req.session.userId], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'Ошибка БД' });
    if (row.balance < bet) return res.status(400).json({ error: 'Недостаточно средств' });

    // Логика выигрыша (рандом). Для демо: чем выше множитель, тем меньше шанс.
    const winChance = 100 / mult; 
    const isWin = Math.random() * 100 < winChance;
    const winAmount = isWin ? bet * mult : 0;
    const newBalance = row.balance - bet + winAmount;

    db.run('UPDATE game_balance SET balance=? WHERE user_id=?', [newBalance, req.session.userId]);
    db.run('INSERT INTO game_bets(user_id, game, amount, multiplier, win_amount) VALUES(?,?,?,?,?)', 
      [req.session.userId, gameType, bet, mult, winAmount], (insErr) => {
      if (insErr) return res.status(500).json({ error: 'Ошибка записи ставки' });
      res.json({ ok: true, win: isWin, winAmount, newBalance });
    });
  });
});

app.post('/api/games/promo', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Войдите в аккаунт' });
  const code = String(req.body?.code || '').trim().toUpperCase();
  
  db.get('SELECT id, reward_type, reward_value, activation_limit, activation_count FROM promos WHERE code=? COLLATE NOCASE AND active=1', [code], (e, promo) => {
    if (e || !promo) return res.status(404).json({ error: 'Промокод не найден или неактивен' });
    if (promo.reward_type !== 'games_deposit_25') return res.status(400).json({ error: 'Этот промокод не для игр' });
    if (promo.activation_limit > 0 && promo.activation_count >= promo.activation_limit) return res.status(409).json({ error: 'Лимит активаций исчерпан' });

    db.get('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?', [promo.id, req.session.userId], (err, redeemed) => {
      if (redeemed) return res.status(409).json({ error: 'Ты уже активировал этот промокод' });
      
      // Выдаем бонус
      db.run('INSERT INTO promo_redemptions(promo_id,user_id,public_id,nickname) VALUES(?,?,?,?)', [promo.id, req.session.userId, req.session.publicId || 0, req.session.nickname], (re) => {
        if (re) return res.status(500).json({ error: 'Ошибка активации' });
        db.run('UPDATE promos SET activation_count=activation_count+1 WHERE id=?', [promo.id]);
        db.run('INSERT INTO game_balance(user_id, balance) VALUES(?, 25) ON CONFLICT(user_id) DO UPDATE SET balance = balance + 25', [req.session.userId]);
        res.json({ ok: true, bonus: 25 });
      });
    });
  });
});

app.get('/api/profile', (req,res) => {
  if(!req.session.userId) return res.status(401).json({error:'Войдите в аккаунт'});
  db.get(`SELECT u.nickname,u.public_id,u.created_at,u.telegram_id,u.telegram_username,u.telegram_first_name,u.telegram_last_name,u.telegram_photo_url,
            COALESCE(SUM(CASE WHEN s.operation_type='sell' AND s.status='completed' THEN s.amount ELSE 0 END),0) sold_usd,
            COALESCE((SELECT percent FROM user_discounts WHERE user_id=u.id AND active=1),0) discount_percent
          FROM users u LEFT JOIN sales s ON s.user_id=u.id WHERE u.id=? GROUP BY u.id`,
    [req.session.userId], (e,row) => {
      if (e) return res.status(500).json({error:'Ошибка профиля'});
      db.all('SELECT id,percent,created_at FROM user_coupons WHERE user_id=? AND used_at IS NULL ORDER BY id ASC',
        [req.session.userId], (e2, coupons) => {
          if (e2) return res.status(500).json({error:'Ошибка купонов'});
          res.json({ ...row, coupons: coupons || [], is_telegram: !!row.telegram_id });
        });
    });
});

app.post('/api/sell',(req,res)=>{
 if(!req.session.userId)return res.status(401).json({error:'Войдите в аккаунт'});
 getSetting('stopped','0',(me,stopped)=>{if(stopped==='1'&&req.session.isAdmin!==true)return res.status(403).json({error:'Приём заявок временно приостановлен.'});
 const coin=String(req.body?.coin||'').toUpperCase(), network=String(req.body?.network||''), amount=Number(req.body?.amount), comment=String(req.body?.comment||'').slice(0,500), tg=String(req.body?.telegramUsername||'').trim().replace(/^@/, ''), payoutType=String(req.body?.payoutType||'phone'), payout=String(req.body?.payoutValue||'').trim(), bank=String(req.body?.bank||'').trim();
 if(!['USDT','GRAM'].includes(coin)||!(coin==='GRAM'?network==='TON':['BEP20','TRC20','ERC20','TON','SPL'].includes(network))||!BLUP_WALLETS[coin]?.[network]||!Number.isFinite(amount)||amount<=0||amount>200||!/^([A-Za-z0-9_]{5,32})$/.test(tg)||!['phone','card'].includes(payoutType)||!payout||payout.length>100||!bank)return res.status(400).json({error:'Проверьте монету, сеть, сумму (до 200 USD), Telegram и банковские реквизиты.'});
 db.get('SELECT value FROM settings WHERE key=?',['usdt_rate'],(rateErr,usdtRow)=>{db.get('SELECT value FROM settings WHERE key=?',['gram_rate'],(gramErr,gramRow)=>{const rate=Number(coin==='USDT'?usdtRow?.value:gramRow?.value)||0;if(rate<=0)return res.status(400).json({error:'Курс для этой криптовалюты ещё не установлен администратором'});
   db.get('SELECT percent FROM user_discounts WHERE user_id=? AND active=1',[req.session.userId],(de,discountRow)=>{
     const manualPercent=[1,3].includes(Number(discountRow?.percent))?Number(discountRow.percent):0;
     db.get('SELECT id,percent FROM user_coupons WHERE user_id=? AND used_at IS NULL AND percent IN (1,3) ORDER BY id ASC LIMIT 1',[req.session.userId],(ce,coupon)=>{
       const couponPercent=coupon?Number(coupon.percent):0;
       const chosenPercent=Math.max(manualPercent,couponPercent);
       const discountApplied=!!req.body?.applyDiscount&&chosenPercent>0;
       const payoutRub=Number((amount*rate*(discountApplied?1+chosenPercent/100:1)).toFixed(2));
       db.run(`INSERT INTO sales(user_id,nickname,coin,network,destination_wallet,operation_type,amount,memo,comment,phone,bank,payout_type,payout_rub,status) VALUES(?,?,?,?,?,'sell',?,?,?,?,?,?,?, 'pending')`,[req.session.userId,req.session.nickname,coin,network,BLUP_WALLETS[coin][network],amount,'',comment,payout,bank,payoutType,payoutRub],function(e){
         if(e)return res.status(500).json({error:'Не удалось создать заявку'});
         const saleId=this.lastID;
         if(discountApplied&&coupon&&couponPercent>=manualPercent){
           db.run('UPDATE user_coupons SET used_at=CURRENT_TIMESTAMP, used_sale_id=? WHERE id=? AND used_at IS NULL',[saleId,coupon.id]);
         }
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
app.get('/api/promos',(req,res)=>db.all('SELECT code,description,reward_type,reward_value FROM promos WHERE active=1 ORDER BY id DESC',(e,rows)=>e?res.status(500).json({error:'Ошибка'}):res.json(rows)));
app.post('/api/promos/apply',(req,res)=>{
 if(!req.session.userId)return res.status(401).json({error:'Войдите в аккаунт'});
 const code=String(req.body?.code||'').trim();
 db.get('SELECT id,code,description,reward_type,reward_value,activation_limit,activation_count FROM promos WHERE code=? COLLATE NOCASE AND active=1',[code],(e,promo)=>{
  if(e||!promo)return res.status(404).json({error:'Промокод не найден или неактивен'});
  if(promo.activation_limit>0&&promo.activation_count>=promo.activation_limit)return res.status(409).json({error:'Лимит активаций промокода исчерпан'});
  db.get('SELECT id,public_id,nickname FROM users WHERE id=?',[req.session.userId],(ue,user)=>{
   if(ue||!user)return res.status(400).json({error:'Пользователь не найден'});
   db.run('INSERT INTO promo_redemptions(promo_id,user_id,public_id,nickname) VALUES(?,?,?,?)',[promo.id,user.id,user.public_id,user.nickname],function(re){
    if(re)return res.status(409).json({error:re.message.includes('UNIQUE')?'Ты уже активировал этот промокод':'Не удалось активировать промокод'});
    db.run('UPDATE promos SET activation_count=activation_count+1 WHERE id=?',[promo.id]);
    if(promo.reward_type==='percent'&&[1,3].includes(Number(promo.reward_value))){
      db.run('INSERT INTO user_coupons(user_id,promo_id,percent,source) VALUES(?,?,?,?)',[user.id,promo.id,Number(promo.reward_value),'promo'],ce=>{
        if(ce)return res.status(500).json({error:'Не удалось выдать купон'});
        notifyAdmin({operation:'promo',nickname:user.nickname,publicId:user.public_id,promoCode:promo.code}).catch(()=>{});
        res.json({ok:true,promo:{code:promo.code,description:promo.description,reward_type:promo.reward_type,reward_value:promo.reward_value}});
      });
    } else {
      notifyAdmin({operation:'promo',nickname:user.nickname,publicId:user.public_id,promoCode:promo.code}).catch(()=>{});
      res.json({ok:true,promo:{code:promo.code,description:promo.description,reward_type:promo.reward_type,reward_value:promo.reward_value}});
    }
   });
  });
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
app.post('/api/admin/maintenance', adminOnly, (req, res) => setSetting('stopped', req.body?.stopped ? '1' : '0', err => err ? res.status(500).json({ error: 'Не удалось изменить режим техработ' }) : res.json({ ok: true, stopped: !!req.body?.stopped })));
app.get('/api/admin/me', (req, res) => res.json({ isAdmin: req.session.isAdmin === true }));
app.get('/api/admin/overview', adminOnly, (req, res) => {
  db.get('SELECT COUNT(*) AS users, SUM(CASE WHEN is_banned=1 THEN 1 ELSE 0 END) AS banned FROM users', [], (e, stats) => {
    if (e) return res.status(500).json({ error: 'Ошибка БД' });
    db.get("SELECT COUNT(*) AS pending FROM sales WHERE status='pending' AND operation_type='sell'", [], (e2, pending) => {
      db.all('SELECT id,nickname,created_at,last_ip,last_seen,is_banned,ban_reason FROM users ORDER BY id DESC LIMIT 300', [], (e3, users) => {
        db.all("SELECT id,user_id,nickname,coin,network,operation_type,amount,payout_rub,status,created_at,wallet,destination_wallet,phone,bank,memo,payout_type,comment,parent_sale_id FROM sales WHERE operation_type='sell' ORDER BY id DESC LIMIT 300", [], (e4, sales) => {
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

app.delete('/api/admin/users/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Некорректный ID' });
  db.run('DELETE FROM users WHERE id=?', [id], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка удаления' });
    if (!this.changes) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ ok: true });
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

app.delete('/api/admin/visits', adminOnly, (req, res) => {
  db.run('DELETE FROM visits', function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка очистки' });
    res.json({ ok: true, deleted: this.changes });
  });
});

app.delete('/api/admin/sales', adminOnly, (req, res) => {
  db.run("DELETE FROM sales WHERE operation_type='sell' AND status IN ('completed','rejected')", function(err) {
    if (err) return res.status(500).json({ error: 'Не удалось очистить историю заявок' });
    res.json({ ok: true, deleted: this.changes });
  });
});

app.post('/api/admin/sales/:id/status', adminOnly, (req, res) => {
  const id = Number(req.params.id), status = String(req.body?.status || '');
  if (!Number.isInteger(id) || id < 1 || !['pending','processing','completed','rejected'].includes(status)) return res.status(400).json({ error: 'Некорректные данные' });
  db.run("UPDATE sales SET status=? WHERE id=? AND operation_type='sell'", [status, id], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка обновления' });
    if (!this.changes) return res.status(404).json({ error: 'Продажа не найдена' });
    res.json({ ok: true });
  });
});
app.post('/api/admin/promos',adminOnly,(req,res)=>{
 const code=String(req.body?.code||'').trim().toUpperCase(),type=String(req.body?.rewardType||''),value=Number(req.body?.rewardValue||0),description=String(req.body?.description||'').slice(0,200),limit=Math.max(0,Math.floor(Number(req.body?.activationLimit||0)));
 const allowed={sell_discount_1:['percent',1,'Скидка 1% на продажу'],sell_discount_3:['percent',3,'Скидка 3% на продажу'],deposit_150:['deposit_kb',150,'Депозит 150р на кб'],deposit_300:['deposit_jab',300,'Депозит 300р на жабу']};
 const preset=allowed[type];if(!/^[A-Z0-9_-]{3,24}$/.test(code)||!preset||!Number.isFinite(limit)||limit>1000000)return res.status(400).json({error:'Проверьте данные промокода'});
 db.run('INSERT INTO promos(code,reward_type,reward_value,description,activation_limit) VALUES(?,?,?,?,?)',[code,preset[0],preset[1],description||preset[2],limit],e=>e?res.status(409).json({error:'Такой промокод уже существует'}):res.json({ok:true}));
});
app.get('/api/admin/promos',adminOnly,(req,res)=>db.all(`SELECT p.*, (SELECT GROUP_CONCAT(COALESCE(r.public_id,r.user_id)||':'||r.nickname, char(10)) FROM promo_redemptions r WHERE r.promo_id=p.id) AS activators FROM promos p ORDER BY p.id DESC`,(e,rows)=>e?res.status(500).json({error:'Ошибка'}):res.json(rows)));
app.post('/api/admin/promos/:id/toggle',adminOnly,(req,res)=>db.run('UPDATE promos SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?',[Number(req.params.id)],function(e){e?res.status(500).json({error:'Ошибка'}):res.json({ok:true});}));
app.post('/api/admin/users/:id/discount',adminOnly,(req,res)=>{const id=Number(req.params.id),percent=Number(req.body?.percent);if(!Number.isInteger(id)||id<1||![0,1,3].includes(percent))return res.status(400).json({error:'Укажите ID и скидку 1%, 3% или 0%'});if(percent===0)return db.run('DELETE FROM user_discounts WHERE user_id=?',[id],e=>e?res.status(500).json({error:'Ошибка БД'}):res.json({ok:true}));db.run('INSERT INTO user_discounts(user_id,percent,source,active) VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET percent=excluded.percent,source=excluded.source,active=1',[id,percent,'admin'],e=>e?res.status(500).json({error:'Ошибка БД'}):res.json({ok:true}));});
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.ready.then(() => app.listen(PORT, () => console.log(`BLUP запущен на порту ${PORT}`))).catch(err => { console.error('Ошибка подготовки БД:', err); process.exit(1); });
