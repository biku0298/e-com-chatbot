import { pool } from '../lib/db';

async function check() {
  const r = await pool.query('SELECT name, color, occasion, type, price, "minAge", "maxAge" FROM "Product" WHERE type=\'dress\' AND gender=\'girls\'');
  console.log('Girls dresses in catalog:');
  for (const row of r.rows) {
    console.log(`- ${row.name} | color: ${row.color} | occasion: ${row.occasion} | age: ${row.minAge}-${row.maxAge} | price: ₹${row.price}`);
  }
  process.exit(0);
}

check();
