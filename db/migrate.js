'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7712, 2026)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const files = fs.readdirSync(path.join(__dirname,'migrations')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort();
    for (const name of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
      if (done.rowCount) continue;
      const sql = fs.readFileSync(path.join(__dirname,'migrations',name),'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
      console.log('Applied database migration:',name);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {migrate};
