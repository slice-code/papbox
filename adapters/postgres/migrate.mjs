import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('papbox:migrations', 0))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../../migrations/', import.meta.url);
    for (const version of (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
      const sql = await readFile(new URL(version, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const result = await client.query('SELECT checksum FROM schema_migrations WHERE version=$1', [version]);
      if (result.rowCount) { if (result.rows[0].checksum !== checksum) throw Error(`Migration checksum mismatch: ${version}`); continue; }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)', [version, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
