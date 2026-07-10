const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'aze-ferma-secret-key-2024';

// Azerbaijan (Baku) hour = UTC + 4
const bakuHour = () => (new Date().getUTCHours() + 4) % 24;

// Auth middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token tapılmadı' });

    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Yanlış token' });
  }
};

// ========== DATABASE SETUP ==========
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        balance DECIMAL(10,2) DEFAULT 1.00,
        bonus_received BOOLEAN DEFAULT TRUE,
        ref_code VARCHAR(10) UNIQUE DEFAULT substring(md5(random()::text), 1, 6),
        referred_by INTEGER REFERENCES users(id),
        level INTEGER DEFAULT 1,
        total_deposit DECIMAL(10,2) DEFAULT 0,
        total_withdraw DECIMAL(10,2) DEFAULT 0,
        total_income DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS trees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tree_type INTEGER NOT NULL,
        planted_at TIMESTAMP DEFAULT NOW(),
        last_watered TIMESTAMP DEFAULT NOW(),
        last_harvest TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        days_remaining INTEGER DEFAULT 30
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        bank_name VARCHAR(100),
        card_holder VARCHAR(100),
        card_number VARCHAR(50),
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id),
        referred_id INTEGER REFERENCES users(id),
        deposit_amount DECIMAL(10,2) DEFAULT 0,
        cashback_earned DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS treasure_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS code_redemptions (
        id SERIAL PRIMARY KEY,
        code_id INTEGER REFERENCES treasure_codes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(code_id, user_id)
      )
    `);

    console.log('✅ Database tables created!');
  } catch (err) {
    console.error('DB Error:', err);
  }
};

// ========== AUTH ROUTES ==========

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, refCode } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Telefon və şifrə tələb olunur' });
    }

    // Phone validation: 994 + operator(50,51,55,70,77,99,10,12,40,44,60) + 7 digits
    if (!/^994(50|51|55|70|77|99|10|12|40|44|60)\d{7}$/.test(phone)) {
      return res.status(400).json({ error: 'Nömrə yanlışdır. Nümunə: 994 55 5555555' });
    }

    // Password length 6-20
    if (password.length < 6 || password.length > 20) {
      return res.status(400).json({ error: 'Şifrə ən az 6, ən çox 20 simvol olmalıdır' });
    }

    // Check if user exists
    const existing = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bu telefon nömrəsi artıq qeydiyyatdan keçib' });
    }

    const hashedPass = await bcrypt.hash(password, 10);

    // Find referrer
    let referredBy = null;
    if (refCode) {
      const refUser = await pool.query('SELECT id FROM users WHERE ref_code = $1', [refCode]);
      if (refUser.rows.length > 0) referredBy = refUser.rows[0].id;
    }

    // Create user with 1 AZN bonus
    const result = await pool.query(
      'INSERT INTO users (phone, password, balance, referred_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [phone, hashedPass, 1.00, referredBy]
    );

    const user = result.rows[0];

    // Record referral
    if (referredBy) {
      await pool.query(
        'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
        [referredBy, user.id]
      );
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        refCode: user.ref_code,
        level: user.level
      },
      message: '🎉 Qeydiyyat uğurlu! 1 AZN bonus əlavə edildi!'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Telefon və ya şifrə yanlışdır' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ error: 'Telefon və ya şifrə yanlışdır' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        refCode: user.ref_code,
        level: user.level
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Get profile
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, phone, balance, ref_code, level, total_deposit, total_withdraw, total_income FROM users WHERE id = $1',
      [req.userId]
    );

    const trees = await pool.query('SELECT * FROM trees WHERE user_id = $1 AND is_active = true', [req.userId]);
    const referrals = await pool.query('SELECT COUNT(*) FROM referrals WHERE referrer_id = $1', [req.userId]);

    res.json({
      user: result.rows[0],
      trees: trees.rows,
      referralCount: parseInt(referrals.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// ========== TREE ROUTES ==========

// Buy tree
app.post('/api/trees/buy', authMiddleware, async (req, res) => {
  try {
    const { treeType } = req.body;

    const treePrices = {
      1: { name: 'Nar ağacı', price: 10, daily: 0.8 },
      2: { name: 'Armud ağacı', price: 25, daily: 1.8 },
      3: { name: 'Mpopla ağacı', price: 100, daily: 5.5 },
      4: { name: 'Banan ağacı', price: 250, daily: 12.5 },
      5: { name: 'Ananas ağacı', price: 540, daily: 28 },
      6: { name: 'Manqo ağacı', price: 1000, daily: 50 }
    };

    const tree = treePrices[treeType];
    if (!tree) return res.status(400).json({ error: 'Yanlış ağac növü' });

    // Check balance
    const userResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.userId]);
    const balance = parseFloat(userResult.rows[0].balance);

    if (balance < tree.price) {
      return res.status(400).json({ error: 'Kifayət qədər balans yoxdur' });
    }

    // Deduct balance and create tree
    await pool.query('BEGIN');

    await pool.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [tree.price, req.userId]);

    await pool.query(
      'INSERT INTO trees (user_id, tree_type, days_remaining, last_watered) VALUES ($1, $2, $3, NULL)',
      [req.userId, treeType, 30]
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description, status) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, 'buy_tree', tree.price, tree.name + ' alındı', 'completed']
    );

    await pool.query('COMMIT');

    res.json({ success: true, message: tree.name + ' əkildi!' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Water tree
app.post('/api/trees/water/:treeId', authMiddleware, async (req, res) => {
  try {
    const { treeId } = req.params;

    const treeResult = await pool.query(
      'SELECT * FROM trees WHERE id = $1 AND user_id = $2 AND is_active = true',
      [treeId, req.userId]
    );
    if (treeResult.rows.length === 0) return res.status(400).json({ error: 'Ağac tapılmadı' });

    const tree = treeResult.rows[0];
    const lastWatered = tree.last_watered ? new Date(tree.last_watered) : null;
    const now = new Date();
    if (lastWatered && lastWatered.toDateString() === now.toDateString()) {
      return res.status(400).json({ error: 'Bu ağac bu gün artıq suvarılıb' });
    }

    await pool.query(
      'UPDATE trees SET last_watered = NOW() WHERE id = $1 AND user_id = $2',
      [treeId, req.userId]
    );

    res.json({ success: true, message: 'Ağac suvarıldı! 💧' });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Harvest tree
app.post('/api/trees/harvest/:treeId', authMiddleware, async (req, res) => {
  try {
    const { treeId } = req.params;

    const treeResult = await pool.query(
      'SELECT * FROM trees WHERE id = $1 AND user_id = $2 AND is_active = true',
      [treeId, req.userId]
    );

    if (treeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Ağac tapılmadı' });
    }

    const tree = treeResult.rows[0];
    const treePrices = {
      1: 0.8, 2: 1.8, 3: 5.5, 4: 12.5, 5: 28, 6: 50
    };

    const dailyIncome = treePrices[tree.tree_type];

    // Check if already harvested today
    const lastHarvest = tree.last_harvest ? new Date(tree.last_harvest) : null;
    const now = new Date();

    if (lastHarvest && (now - lastHarvest) < 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Bu ağac artıq yığılıb, 24 saat gözləyin' });
    }

    await pool.query('BEGIN');

    await pool.query('UPDATE users SET balance = balance + $1, total_income = total_income + $1 WHERE id = $2', [dailyIncome, req.userId]);
    await pool.query('UPDATE trees SET last_harvest = NOW() WHERE id = $1', [treeId]);
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description, status) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, 'income', dailyIncome, 'Gündəlik gəlir', 'completed']
    );

    await pool.query('COMMIT');

    res.json({ success: true, message: dailyIncome + ' AZN gəlir toplandı!', amount: dailyIncome });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server xətası' });
  }
});

// ========== DEPOSIT ROUTES ==========

app.post('/api/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount, method } = req.body;
    const hour = bakuHour();

    if (hour < 10 || hour >= 20) {
      return res.status(400).json({ error: 'Depozit saatları 10:00 - 20:00 arasındadır' });
    }

    if (!amount || amount < 10) {
      return res.status(400).json({ error: 'Minimum depozit 10 AZN-dir' });
    }

    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description, status) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, 'deposit', amount, method, 'pending']
    );

    res.json({ 
      success: true, 
      message: 'Depozit sorğusu göndərildi. Admin təsdiq edəcək.',
      telegram: '@Delmontedepozit'
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Admin approve deposit
app.post('/api/admin/approve-deposit/:txId', async (req, res) => {
  try {
    const { txId } = req.params;
    const { adminKey } = req.body;

    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Yetkisiz giriş' });
    }

    await pool.query('BEGIN');

    const tx = await pool.query('SELECT * FROM transactions WHERE id = $1', [txId]);
    if (tx.rows.length === 0) return res.status(404).json({ error: 'Əməliyyat tapılmadı' });

    const transaction = tx.rows[0];

    await pool.query('UPDATE users SET balance = balance + $1, total_deposit = total_deposit + $1 WHERE id = $2', [transaction.amount, transaction.user_id]);
    await pool.query("UPDATE transactions SET status = 'completed' WHERE id = $1", [txId]);

    // Referral cashback
    const userResult = await pool.query('SELECT referred_by FROM users WHERE id = $1', [transaction.user_id]);
    if (userResult.rows[0].referred_by) {
      const cashback = transaction.amount * 0.1;
      await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [cashback, userResult.rows[0].referred_by]);
      await pool.query(
        'INSERT INTO transactions (user_id, type, amount, description, status) VALUES ($1, $2, $3, $4, $5)',
        [userResult.rows[0].referred_by, 'referral_cashback', cashback, 'Referal cashback', 'completed']
      );
    }

    await pool.query('COMMIT');
    res.json({ success: true, message: 'Depozit təsdiq edildi' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server xətası' });
  }
});

// ========== WITHDRAW ROUTES ==========

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, bankName, cardHolder, cardNumber } = req.body;
    const hour = bakuHour();

    if (hour < 10 || hour >= 20) {
      return res.status(400).json({ error: 'Çıxarış saatları 10:00 - 20:00 arasındadır' });
    }

    if (!amount || amount < 6) {
      return res.status(400).json({ error: 'Minimum çıxarış 6 AZN-dir' });
    }

    if (amount > 2000) {
      return res.status(400).json({ error: 'Maksimum çıxarış 2000 AZN-dir' });
    }

    const userResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.userId]);
    const balance = parseFloat(userResult.rows[0].balance);

    if (amount > balance) {
      return res.status(400).json({ error: 'Kifayət qədər balans yoxdur' });
    }

    const fee = amount * 0.1;
    const netAmount = amount - fee;

    await pool.query('BEGIN');

    await pool.query('UPDATE users SET balance = balance - $1, total_withdraw = total_withdraw + $1 WHERE id = $2', [amount, req.userId]);
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, bank_name, card_holder, card_number, description, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [req.userId, 'withdraw', amount, bankName, cardHolder, cardNumber, 'Net: ' + netAmount + ' AZN (Kom: ' + fee + ' AZN)', 'pending']
    );

    await pool.query('COMMIT');

    res.json({ 
      success: true, 
      message: 'Çıxarış sorğusu göndərildi!',
      netAmount: netAmount,
      fee: fee
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server xətası' });
  }
});

// ========== HISTORY ==========

app.get('/api/transactions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// ========== REFERRAL ==========

app.get('/api/referral/stats', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(cashback_earned), 0) as total FROM referrals WHERE referrer_id = $1',
      [req.userId]
    );

    const userResult = await pool.query('SELECT ref_code FROM users WHERE id = $1', [req.userId]);

    res.json({
      refCode: userResult.rows[0].ref_code,
      referralCount: parseInt(result.rows[0].count),
      totalCashback: parseFloat(result.rows[0].total)
    });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// ========== TREASURE CODE (Xəzinə kodu) ==========

app.post('/api/treasure/redeem', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Kod daxil edin' });

    const codeResult = await pool.query(
      'SELECT * FROM treasure_codes WHERE code = $1 AND is_active = true',
      [code.trim()]
    );
    if (codeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Kod tapılmadı və ya aktiv deyil' });
    }

    const tc = codeResult.rows[0];
    if (tc.used_count >= tc.max_uses) {
      return res.status(400).json({ error: 'Bu kodun istifadə limiti bitib' });
    }

    const already = await pool.query(
      'SELECT 1 FROM code_redemptions WHERE code_id = $1 AND user_id = $2',
      [tc.id, req.userId]
    );
    if (already.rows.length > 0) {
      return res.status(400).json({ error: 'Bu kodu artıq istifadə etmisiniz' });
    }

    await pool.query('BEGIN');
    await pool.query('INSERT INTO code_redemptions (code_id, user_id) VALUES ($1, $2)', [tc.id, req.userId]);
    await pool.query('UPDATE treasure_codes SET used_count = used_count + 1 WHERE id = $1', [tc.id]);
    await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [tc.amount, req.userId]);
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description, status) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, 'treasure', tc.amount, 'Xəzinə kodu: ' + tc.code, 'completed']
    );
    await pool.query('COMMIT');

    res.json({ success: true, message: tc.amount + ' AZN hesabınıza əlavə edildi!', amount: parseFloat(tc.amount) });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Admin create treasure code
app.post('/api/admin/treasure/create', async (req, res) => {
  try {
    const { adminKey, code, amount, maxUses } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Yetkisiz giriş' });
    }
    await pool.query(
      'INSERT INTO treasure_codes (code, amount, max_uses) VALUES ($1, $2, $3)',
      [code, amount, maxUses || 1]
    );
    res.json({ success: true, message: 'Kod yaradıldı' });
  } catch (err) {
    res.status(500).json({ error: 'Kod yaradıla bilmədi (bəlkə təkrar kod?)' });
  }
});

// ========== ADMIN PANEL ==========

app.get('/api/admin/pending', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Yetkisiz giriş' });
    }

    const deposits = await pool.query("SELECT t.*, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.type = 'deposit' AND t.status = 'pending' ORDER BY t.created_at DESC");
    const withdraws = await pool.query("SELECT t.*, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.type = 'withdraw' AND t.status = 'pending' ORDER BY t.created_at DESC");

    res.json({ deposits: deposits.rows, withdraws: withdraws.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Admin approve withdraw
app.post('/api/admin/approve-withdraw/:txId', async (req, res) => {
  try {
    const { txId } = req.params;
    const { adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Yetkisiz giriş' });
    await pool.query("UPDATE transactions SET status = 'completed' WHERE id = $1 AND type = 'withdraw'", [txId]);
    res.json({ success: true, message: 'Çıxarış təsdiq edildi' });
  } catch (err) {
    res.status(500).json({ error: 'Server xətası' });
  }
});

// Admin reject transaction (refund if withdraw)
app.post('/api/admin/reject/:txId', async (req, res) => {
  try {
    const { txId } = req.params;
    const { adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Yetkisiz giriş' });
    await pool.query('BEGIN');
    const tx = await pool.query("SELECT * FROM transactions WHERE id = $1 AND status = 'pending'", [txId]);
    if (tx.rows.length === 0) { await pool.query('ROLLBACK'); return res.status(404).json({ error: 'Tapılmadı' }); }
    const t = tx.rows[0];
    if (t.type === 'withdraw') {
      await pool.query('UPDATE users SET balance = balance + $1, total_withdraw = total_withdraw - $1 WHERE id = $2', [t.amount, t.user_id]);
    }
    await pool.query("UPDATE transactions SET status = 'rejected' WHERE id = $1", [txId]);
    await pool.query('COMMIT');
    res.json({ success: true, message: 'Ləğv edildi' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server xətası' });
  }
});


// ========== START SERVER ==========
app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 AZE Ferma server running on port ${PORT}`);
});
