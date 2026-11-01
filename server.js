const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { notifyAdmin } = require('./bot');
const { notifyNewUser } = require('./bot_register');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Render передаёт исходный IP через доверенный прокси.
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-this-secret-before-deployment',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function requestIp(req) {
  const raw = req.ip || req.socket.remoteAddress || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function logAuthEvent(req, nickname, eventType, success) {
  db.run(
    'INSERT INTO login_events (nickname, ip_address, event_type, success) VALUES (?, ?, ?, ?)',
    [String(nickname || '').slice(0, 80), requestIp(req), eventType, success ? 1 : 0]
  );
}

function isIpBanned(ip, callback) {
  db.get('SELECT id FROM ip_bans WHERE ip_address = ?', [ip], (err, row) => callback(Boolean(row)));
}

// Блокировка применяется к регистрации и входу; админ-панель остаётся доступна владельцу.
app.use((req, res, next) => {
  if (req.method !== 'POST' || !['/api/login', '/api/register'].includes(req.path)) return next();
  isIpBanned(requestIp(req), banned => {
    if (banned) return res.status(403).json({ error: 'Вход с этого IP-адреса заблокирован' });
    next();
  });
});

const DEFAULT_SITE_CONFIG = {
  prices: { sellUsdt: 73, sellGram: 90, withdrawUsdt: 73, withdrawGram: 90 },
  texts: {}
};
function readSiteConfig(callback) {
  db.get("SELECT value FROM settings WHERE key='site_config'", (err, row) => {
    let config = DEFAULT_SITE_CONFIG;
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        config = {
          prices: { ...DEFAULT_SITE_CONFIG.prices, ...(parsed.prices || {}) },
          texts: {}
        };
      } catch (_) {}
    }
    callback(config);
  });
}

app.get('/api/site-config', (req, res) => readSiteConfig(config => res.json(config)));

app.get('/api/status', (req, res) => {
  db.get("SELECT value FROM settings WHERE key='stopped'", (err, row) => {
    const stopped = row && row.value === '1';
    res.json({ stopped: stopped === true || (row && row.value === '1') });
  });
});

app.post('/api/register', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || !password || nickname.length < 3 || password.length < 4) {
    logAuthEvent(req, nickname, 'register', false);
    return res.status(400).json({ error: 'Ник от 3 символов, пароль от 4' });
  }
  
  db.get('SELECT id FROM users WHERE nickname = ?', [nickname], (err, row) => {
    if (row) { logAuthEvent(req, nickname, 'register', false); return res.status(400).json({ error: 'Такой ник уже занят' }); }
    
    const hash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (nickname, password_hash) VALUES (?, ?)', [nickname, hash], function(err) {
      if (err) { logAuthEvent(req, nickname, 'register', false); return res.status(500).json({ error: 'Ошибка БД' }); }
      logAuthEvent(req, nickname, 'register', true);
      
      req.session.userId = this.lastID;
      req.session.nickname = nickname;

      // --- ОТПРАВЛЯЕМ В НОВЫЙ БОТ ---
      notifyNewUser(nickname); 
      // -------------------------------

      res.json({ ok: true, nickname });
    });
  });
});
app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body || {};
  db.get('SELECT * FROM users WHERE nickname = ?', [nickname], (err, user) => {
    if (err || !user || !password || !bcrypt.compareSync(password, user.password_hash)) {
      logAuthEvent(req, nickname, 'login', false);
      return res.status(400).json({ error: 'Неверный ник или пароль' });
    }
    logAuthEvent(req, user.nickname, 'login', true);
    req.session.userId = user.id;
    req.session.nickname = user.nickname;
    res.json({ ok: true, nickname: user.nickname });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ nickname: req.session.nickname || null });
});

app.get('/api/history', (req, res) => {
  db.all("SELECT nickname, coin, network, created_at FROM sales WHERE status='sold' ORDER BY id DESC LIMIT 200", [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/sell', (req, res) => {
  db.get("SELECT value FROM settings WHERE key='stopped'", (err, row) => {
    const stopped = row && row.value === '1';
    if (stopped && req.session.isAdmin !== true) {
      return res.status(403).json({ error: 'пока что не покупаю' });
    }

    const { coin, network, wallet, phone, bank } = req.body || {};
    if (!coin || !wallet || !phone || !bank) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.run(
      'INSERT INTO sales (user_id, nickname, coin, network, wallet, phone, bank) VALUES (?,?,?,?,?,?,?)',
      [req.session.userId || null, req.session.nickname || 'гость', coin, network || '', wallet, phone, bank],
      function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка БД' });
        
        const sale = { id: this.lastID, nickname: req.session.nickname || 'гость', coin, network, wallet, phone, bank };
        notifyAdmin(sale).catch(e => console.log('Ошибка телеги:', e.message));
        res.json({ ok: true });
      }
    );
  });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ authenticated: req.session.isAdmin === true });
});

app.post('/api/admin/login', (req, res) => {
  if (ADMIN_PASSWORD && req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(403).json({ error: 'Неверный пароль' });
});

app.get('/api/admin/stopped', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'forbidden' });
  db.get("SELECT value FROM settings WHERE key='stopped'", (err, row) => {
    res.json({ stopped: row && row.value === '1' });
  });
});

app.post('/api/admin/toggle-stop', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'forbidden' });
  db.get("SELECT value FROM settings WHERE key='stopped'", (err, row) => {
    const next = (row && row.value === '1') ? '0' : '1';
    db.run("UPDATE settings SET value=? WHERE key='stopped'", [next], () => {
      res.json({ stopped: next === '1' });
    });
  });
});


app.get('/api/admin/sales', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  db.all('SELECT id, nickname, coin, network, created_at, status FROM sales ORDER BY id DESC LIMIT 300', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Не удалось загрузить историю' });
    res.json(rows || []);
  });
});


app.put('/api/admin/sales/:id/status', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  const status = String((req.body || {}).status || '');
  if (!['sold', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус транзакции' });
  }
  db.run('UPDATE sales SET status=? WHERE id=?', [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Не удалось обновить статус' });
    if (!this.changes) return res.status(404).json({ error: 'Транзакция не найдена' });
    res.json({ ok: true, status });
  });
});

app.delete('/api/admin/sales', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  db.run('DELETE FROM sales', [], function(err) {
    if (err) return res.status(500).json({ error: 'Не удалось очистить историю транзакций' });
    // Reset SQLite sequence so the next record starts a fresh sequence where supported.
    db.run("DELETE FROM sqlite_sequence WHERE name='sales'", [], () => res.json({ ok: true, deleted: this.changes }));
  });
});

app.get('/api/admin/site-config', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  readSiteConfig(config => res.json(config));
});

app.put('/api/admin/site-config', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  const body = req.body || {};
  const pricesIn = body.prices || {};
  const prices = {};
  for (const key of ['sellUsdt', 'sellGram', 'withdrawUsdt', 'withdrawGram']) {
    const value = Number(pricesIn[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1000000000) {
      return res.status(400).json({ error: 'Проверьте значения курсов: нужны числа от 0 до 1 000 000 000' });
    }
    prices[key] = value;
  }
  const texts = {};
  const config = JSON.stringify({ prices, texts });
  db.run("INSERT INTO settings (key, value) VALUES ('site_config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [config], err => {
    if (err) return res.status(500).json({ error: 'Не удалось сохранить изменения' });
    res.json({ ok: true });
  });
});

app.get('/api/admin/login-events', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  db.all('SELECT id, nickname, ip_address, event_type, success, created_at FROM login_events ORDER BY id DESC LIMIT 300', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Не удалось загрузить журнал входов' });
    res.json(rows || []);
  });
});

app.get('/api/admin/ip-bans', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  db.all('SELECT id, ip_address, reason, created_at FROM ip_bans ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Не удалось загрузить блокировки' });
    res.json(rows || []);
  });
});

app.post('/api/admin/ip-bans', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  const ip = String((req.body || {}).ip_address || '').trim();
  const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
  // Принимаем только конкретный IPv4/IPv6, не CIDR и не маски диапазонов.
  const validIp = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-fA-F:]{3,39})$/.test(ip);
  if (!validIp) return res.status(400).json({ error: 'Укажите корректный IPv4 или IPv6' });
  db.run('INSERT OR IGNORE INTO ip_bans (ip_address, reason) VALUES (?, ?)', [ip, reason], function(err) {
    if (err) return res.status(500).json({ error: 'Не удалось добавить блокировку' });
    res.json({ ok: true, added: this.changes > 0 });
  });
});

app.delete('/api/admin/ip-bans/:id', (req, res) => {
  if (req.session.isAdmin !== true) return res.status(403).json({ error: 'forbidden' });
  db.run('DELETE FROM ip_bans WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Не удалось снять блокировку' });
    res.json({ ok: true, removed: this.changes > 0 });
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

app.get('/', (req, res) => {
  db.get("SELECT value FROM settings WHERE key='stopped'", (err, row) => {
    const stopped = row && row.value === '1';
    if (stopped) {
      return res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
    }
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
});

app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));