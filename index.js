import express from 'express';
import pkg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const { Pool } = pkg;

const app = express();
app.use(express.json());

// =======================
// DATABASE
// =======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// =======================
// CONFIG
// =======================
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_super_secret';

// =======================
// MIDDLEWARE AUTH
// =======================
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: 'Token mancante' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token non valido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token non valido o scaduto' });
  }
}

app.get('/me', requireAuth, async (req, res) => {
  res.json({
    message: 'Accesso autorizzato',
    user: req.user
  });
});


// =======================
// ROUTE TEST
// =======================
app.get('/', async (req, res) => {
  try {
    await pool.query('select 1');
    res.send('Backend attivo e DB collegato');
  } catch (error) {
    console.error('ERRORE CONNESSIONE DB:', error);
    res.status(500).send('Errore DB');
  }
});

// =======================
// LOGIN
// =======================
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e password obbligatorie' });
  }

  try {
    const result = await pool.query(
      `
      SELECT u.id, u.email, u.password_hash, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.email = $1 AND u.active = true
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenziali non valide' });
    }

    const user = result.rows[0];

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Credenziali non valide' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('ERRORE LOGIN:', error);
    res.status(500).json({ message: 'Errore server' });
  }
});

// =======================
// SERVER
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
