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


app.get('/', async (req, res) => {
  try {
    await pool.query('select 1');
    res.send('Backend attivo e DB collegato');
  } catch (error) {
    console.error('ERRORE CONNESSIONE DB:', error.message);
    res.status(500).send('Errore DB');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
