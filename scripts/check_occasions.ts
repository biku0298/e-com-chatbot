import { pool } from '../lib/db';

async function check() {
  const r = await pool.query('SELECT DISTINCT occasion, count(*) FROM "Product" GROUP BY occasion');
  console.log('Occasion counts:', r.rows);
  const dresses = await pool.query('SELECT count(*) FROM "Product" WHERE type=\'dress\'');
  console.log('Total dresses:', dresses.rows[0]);
  process.exit(0);
}

check();
