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

// frontend statico
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));

// upload statici
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
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.originalname.endsWith('.xlsx')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Solo PDF o Excel consentiti'));
    }
  }
});

/* =========================
   AUTH & PERMESSI
========================= */
function requireAdmin(req, res, next) {
  if (req.headers.role !== 'admin') {
    return res.status(403).json({ message: 'Permesso negato' });
  }
  next();
}

/* =========================
   ROUTE BASE
========================= */
app.get('/', (req, res) => {
  res.send('Backend attivo');
});

app.get('/health', async (req, res) => {
  const r = await pool.query('select now()');
  res.json({ status: 'ok', db_time: r.rows[0].now });
});

/* =========================
   LOGIN
========================= */
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e password obbligatorie' });
  }

  const result = await pool.query(
    'SELECT id, email, password, role FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ message: 'Credenziali non valide' });
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password);

  if (!ok) {
    return res.status(401).json({ message: 'Credenziali non valide' });
  }

  res.json({
    id: user.id,
    email: user.email,
    role: user.role
  });
});

/* =========================
   MATCHES
========================= */
app.get('/matches', async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM matches ORDER BY match_date, match_time'
  );
  res.json(r.rows);
});

app.post('/matches', requireAdmin, async (req, res) => {
  const { team_a, team_b, match_date, match_time, location } = req.body;

  if (!team_a || !team_b || !match_date || !match_time || !location) {
    return res.status(400).json({ message: 'Campi mancanti' });
  }

  const r = await pool.query(
    `
    INSERT INTO matches (team_a, team_b, match_date, match_time, location)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [team_a, team_b, match_date, match_time, location]
  );

  res.json(r.rows[0]);
});

/* =========================
   REPORTS
========================= */
app.post('/reports', async (req, res) => {
  const { match_id, referee_name, notes } = req.body;

  const r = await pool.query(
    `
    INSERT INTO reports (match_id, referee_name, notes)
    VALUES ($1,$2,$3)
    RETURNING *
    `,
    [match_id, referee_name, notes || null]
  );

  res.json(r.rows[0]);
});

app.get('/reports', async (req, res) => {
  const r = await pool.query(`
    SELECT r.*, m.team_a, m.team_b, m.match_date, m.match_time, m.location
    FROM reports r
    JOIN matches m ON m.id = r.match_id
    ORDER BY m.match_date DESC
  `);

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
   PDF UPLOAD
========================= */
app.post('/reports/:id/upload', upload.single('pdf'), async (req, res) => {
  await pool.query(
    'UPDATE reports SET pdf_path = $1 WHERE id = $2',
    [req.file.path, req.params.id]
  );

  res.json({ message: 'PDF caricato', path: req.file.path });
});

/* =========================
   EXCEL IMPORT
========================= */
app.post('/matches/import', upload.single('file'), async (req, res) => {
  const workbook = xlsx.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  let count = 0;

  for (const r of rows) {
    if (!r.team_a || !r.team_b) continue;

    await pool.query(
      `
      INSERT INTO matches (team_a, team_b, match_date, match_time, location)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [r.team_a, r.team_b, r.match_date, r.match_time, r.location]
    );

    count++;
  }

  res.json({ imported: count });
});

/* =========================
   SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server avviato sulla porta', PORT);
});
