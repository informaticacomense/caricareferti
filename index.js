import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;

const app = express();
app.use(express.json());

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

// AVVIO SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
