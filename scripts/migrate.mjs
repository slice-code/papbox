import { createPool } from '../adapters/postgres/store.mjs';
import { migrate } from '../adapters/postgres/migrate.mjs';
const pool=createPool(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);
try { await migrate(pool); console.log('PostgreSQL migrations applied'); }
finally { await pool.end(); }
