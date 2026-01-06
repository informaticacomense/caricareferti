import express from 'express';
import pkg from 'pg';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import xlsx from 'xlsx';


app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e password obbligatorie' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
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
  } catch (error) {
    console.error('ERRORE LOGIN:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});
function requireAdmin(req, res, next) {
  if (req.headers.role !== 'admin') {
    return res.status(403).json({ message: 'Permesso negato' });
  }
  next();
}


const { Pool } = pkg;

const app = express();
app.use(express.json());
app.use('/uploads', express.static('uploads'));


const uploadDir = './uploads';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Solo PDF consentiti'));
    } else {
      cb(null, true);
    }
  }
});


// Connessione al DB (Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ROUTE BASE (già la conosci)
app.get('/', (req, res) => {
  res.send('Backend attivo');
});

// ROUTE HEALTH (per test DB)
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('select now()');
    res.json({
      status: 'ok',
      db_time: result.rows[0].now
    });
  } catch (error) {
    console.error('ERRORE CONNESSIONE DB:', error.message);
    res.status(500).json({
      status: 'db_error'
    });
  }
});

// GET MATCHES
app.get('/matches', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM matches ORDER BY match_date, match_time'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('ERRORE GET MATCHES:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});

// POST MATCH
app.post('/matches', requireAdmin, async (req, res) => {

  const { team_a, team_b, match_date, match_time, location } = req.body;

  if (!team_a || !team_b || !match_date || !match_time || !location) {
    return res.status(400).json({ message: 'Tutti i campi sono obbligatori' });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO matches (team_a, team_b, match_date, match_time, location)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [team_a, team_b, match_date, match_time, location]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('ERRORE POST MATCH:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});

// POST REPORT
app.post('/reports', async (req, res) => {
  const { match_id, referee_name, notes } = req.body;

  if (!match_id || !referee_name) {
    return res.status(400).json({ message: 'match_id e referee_name obbligatori' });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO reports (match_id, referee_name, notes)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [match_id, referee_name, notes || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('ERRORE POST REPORT:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});

// GET REPORTS BY MATCH
app.get('/matches/:id/reports', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT r.*, m.team_a, m.team_b
      FROM reports r
      JOIN matches m ON m.id = r.match_id
      WHERE m.id = $1
      `,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('ERRORE GET REPORTS:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});

// UPLOAD PDF REFERTO
app.post('/reports/:id/upload', upload.single('pdf'), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ message: 'File PDF mancante' });
  }

  try {
    await pool.query(
      `UPDATE reports SET pdf_path = $1 WHERE id = $2`,
      [req.file.path, id]
    );

    res.json({
      message: 'PDF caricato con successo',
      path: req.file.path
    });
  } catch (error) {
    console.error('ERRORE UPLOAD PDF:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});

// GET ALL REPORTS (con link PDF)
app.get('/reports', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        r.id,
        r.match_id,
        r.referee_name,
        r.notes,
        r.pdf_path,
        m.team_a,
        m.team_b,
        m.match_date,
        m.match_time,
        m.location
      FROM reports r
      JOIN matches m ON m.id = r.match_id
      ORDER BY m.match_date DESC, m.match_time DESC
      `
    );

    // aggiungiamo il link pubblico al PDF
    const reports = result.rows.map(r => ({
      ...r,
      pdf_url: r.pdf_path
        ? `${req.protocol}://${req.get('host')}/${r.pdf_path}`
        : null
    }));

    res.json(reports);
  } catch (error) {
    console.error('ERRORE GET REPORTS:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});

// IMPORT MATCHES FROM EXCEL
app.post('/matches/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'File Excel mancante' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(sheet);

    if (!rows.length) {
      return res.status(400).json({ message: 'File Excel vuoto' });
    }

    const inserted = [];

    for (const row of rows) {
      const { team_a, team_b, match_date, match_time, location } = row;

      if (!team_a || !team_b || !match_date || !match_time || !location) {
        continue; // salta righe incomplete
      }

      const result = await pool.query(
        `
        INSERT INTO matches (team_a, team_b, match_date, match_time, location)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [team_a, team_b, match_date, match_time, location]
      );

      inserted.push(result.rows[0].id);
    }

    res.json({
      message: 'Import completato',
      matches_created: inserted.length,
      ids: inserted
    });
  } catch (error) {
    console.error('ERRORE IMPORT EXCEL:', error.message);
    res.status(500).json({ message: 'Errore server' });
  }
});


// AVVIO SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
