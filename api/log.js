// Tiger Data (Postgres hypertable): GET /api/log records one practice session and returns the total.
import pg from 'pg';
// Tiger's URL ends in ?sslmode=require; this flag makes pg encrypt without needing Tiger's CA certificate.
const pool = new pg.Pool({ connectionString: process.env.TIGER_DATA_URL + '&uselibpqcompat=true' });
export default async function handler(req, res) {
  await pool.query("create table if not exists practice_sessions (time timestamptz not null default now()) with (tsdb.hypertable, tsdb.partition_column = 'time')");
  await pool.query('insert into practice_sessions default values');
  const { rows } = await pool.query('select count(*)::int as count from practice_sessions');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows[0]));
}
