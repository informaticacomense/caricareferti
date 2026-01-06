import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// TEST SERVER
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      db_time: result.rows[0].now
    });
  } catch (error) {
    console.error('DB ERROR:', error.message);
    res.status(500).json({ status: 'db_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
