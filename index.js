/* =========================
   IMPORT
========================= */
import express from 'express';
import pkg from 'pg';
import multer from 'multer';
import fs from 'fs';
import bcrypt from 'bcrypt';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;

/* =========================
   APP
========================= */
const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   STATIC
========================= */
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));
app.use('/uploads', express.static('uploads'));

/* =========================
   DATABASE
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   UPLOAD CONFIG
========================= */
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });

/* =========================
   AUTH UTILS
========================= */
function requireRole(role) {
  return (req, res, next) => {
    if (req.headers.role !== role) {
      return res.status(403).json({ message: 'Permesso negato' });
    }
    next();
  };
}

/* =========================
   BASE
========================= */
app.get('/', (req, res) => res.send('Backend attivo'));

app.get('/health', async (req, res) => {
  const r = await pool.query('SELECT now()');
  res.json({ ok: true, time: r.rows[0].now });
});

/* =========================
   AUTH
========================= */
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e password obbligatorie' });
  }

  const r = await pool.query(
    'SELECT id,email,password_hash,role,province FROM users WHERE email=$1',
    [email]
  );

  if (!r.rows.length) {
    return res.status(401).json({ message: 'Credenziali non valide' });
  }

  const user = r.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);

  if (!ok) {
    return res.status(401).json({ message: 'Credenziali non valide' });
  }

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    province: user.province
  });
});

/* =========================
   RESET PASSWORD
========================= */
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json({ message: 'Dati mancanti' });
  }

  const hash = await bcrypt.hash(newPassword.trim(), 10);

  await pool.query(
    'UPDATE users SET password_hash=$1 WHERE email=$2',
    [hash, email]
  );

  res.json({ message: 'Password aggiornata' });
});

/* =========================
   SUPERADMIN
========================= */
app.post(
  '/admin/create-comitato',
  requireRole('superadmin'),
  async (req, res) => {
    const { email, password, province } = req.body;

    if (!email || !password || !province) {
      return res.status(400).json({ message: 'Campi mancanti' });
    }

    const hash = await bcrypt.hash(password.trim(), 10);

    const r = await pool.query(
      `
      INSERT INTO users (email,password_hash,role,province)
      VALUES ($1,$2,'comitato',$3)
      RETURNING id,email,role,province
      `,
      [email, hash, province]
    );

    res.status(201).json({
      message: 'Comitato creato correttamente',
      comitato: r.rows[0]
    });
  }
);

/* =========================
   SEASONS
========================= */
app.get('/seasons', async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM seasons ORDER BY id DESC'
  );
  res.json(r.rows);
});

app.post('/seasons', requireRole('comitato'), async (req, res) => {
  if (!req.body.name) {
    return res.status(400).json({ message: 'Nome stagione obbligatorio' });
  }

  const r = await pool.query(
    'INSERT INTO seasons (name) VALUES ($1) RETURNING *',
    [req.body.name.trim()]
  );

  res.status(201).json({
    message: 'Stagione creata',
    season: r.rows[0]
  });
});

/* =========================
   CATEGORIES
========================= */
app.get('/categories', async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM categories WHERE season_id=$1',
    [req.query.seasonId]
  );
  res.json(r.rows);
});

app.post('/categories', requireRole('comitato'), async (req, res) => {
  const { season_id, name } = req.body;

  if (!season_id || !name) {
    return res.status(400).json({ message: 'Dati mancanti' });
  }

  const r = await pool.query(
    'INSERT INTO categories (season_id,name) VALUES ($1,$2) RETURNING *',
    [season_id, name]
  );

  res.status(201).json(r.rows[0]);
});

/* =========================
   PHASES
========================= */
app.get('/phases', async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM phases WHERE category_id=$1',
    [req.query.categoryId]
  );
  res.json(r.rows);
});

app.post('/phases', requireRole('comitato'), async (req, res) => {
  const { category_id, name } = req.body;

  if (!category_id || !name) {
    return res.status(400).json({ message: 'Dati mancanti' });
  }

  const r = await pool.query(
    'INSERT INTO phases (category_id,name) VALUES ($1,$2) RETURNING *',
    [category_id, name]
  );

  res.status(201).json(r.rows[0]);
});

/* =========================
   GROUPS
========================= */
app.get('/groups', async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM groups WHERE phase_id=$1',
    [req.query.phaseId]
  );
  res.json(r.rows);
});

app.post('/groups', requireRole('comitato'), async (req, res) => {
  const { phase_id, name } = req.body;

  if (!phase_id || !name) {
    return res.status(400).json({ message: 'Dati mancanti' });
  }

  const r = await pool.query(
    'INSERT INTO groups (phase_id,name) VALUES ($1,$2) RETURNING *',
    [phase_id, name]
  );

  res.status(201).json(r.rows[0]);
});

/* =========================
   MATCHES
========================= */
app.get('/matches', async (req, res) => {
  const r = await pool.query('SELECT * FROM matches ORDER BY match_date');
  res.json(r.rows);
});

app.post(
  '/matches/import/:groupId',
  requireRole('comitato'),
  upload.single('file'),
  async (req, res) => {
    const workbook = xlsx.readFile(req.file.path);
    const rows = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]]
    );

    let count = 0;

    for (const r of rows) {
      await pool.query(
        `
        INSERT INTO matches
        (group_id,numero_gara,team_a,team_b,match_date,match_time,location,score_a,score_b,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          req.params.groupId,
          r.numero_gara,
          r.team_a,
          r.team_b,
          r.match_date,
          r.match_time,
          r.location,
          r.score_a || null,
          r.score_b || null,
          r.status || 'da_giocare'
        ]
      );
      count++;
    }

    res.json({ message: 'Import completato', imported: count });
  }
);

/* =========================
   REPORTS
========================= */
app.post('/reports', async (req, res) => {
  const { match_id, referee_name, notes } = req.body;

  if (!match_id || !referee_name) {
    return res.status(400).json({ message: 'Dati mancanti' });
  }

  const r = await pool.query(
    `
    INSERT INTO reports (match_id,referee_name,notes)
    VALUES ($1,$2,$3)
    RETURNING *
    `,
    [match_id, referee_name, notes || null]
  );

  res.status(201).json(r.rows[0]);
});

app.post(
  '/reports/:id/upload',
  upload.single('pdf'),
  async (req, res) => {
    await pool.query(
      'UPDATE reports SET pdf_path=$1 WHERE id=$2',
      [req.file.path, req.params.id]
    );

    res.json({ message: 'PDF caricato', path: req.file.path });
  }
);

app.get('/reports', async (req, res) => {
  const r = await pool.query('SELECT * FROM reports');
  res.json(
    r.rows.map(row => ({
      ...row,
      pdf_url: row.pdf_path
        ? `${req.protocol}://${req.get('host')}/${row.pdf_path}`
        : null
    }))
  );
});

/* =========================
   SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log('Server avviato sulla porta', PORT)
);
