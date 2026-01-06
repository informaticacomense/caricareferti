import express from 'express';
import pkg from 'pg';
import multer from 'multer';
import path from 'path';
import fs from 'fs';


const { Pool } = pkg;

const app = express();
app.use(express.json());

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
app.post('/matches', async (req, res) => {
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



// AVVIO SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
