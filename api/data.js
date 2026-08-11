const { neon } = require('@neondatabase/serverless');

// Keep this different from your broadcast-equipment-system DATA_KEY even if
// both apps share the same Neon database.
const DATA_KEY = process.env.DATA_KEY || 'fictional-railway-system';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.NEON_DATABASE_URL;

function getSql() {
  if (!DATABASE_URL) {
    throw new Error('Neon Postgres is not connected. DATABASE_URL is missing.');
  }
  return neon(DATABASE_URL);
}

async function ensureTable(sql) {
  await sql`
    create table if not exists app_data (
      key text primary key,
      value jsonb not null,
      client_updated_at timestamptz,
      updated_at timestamptz not null default now()
    )
  `;

  // Safe migration when app_data was originally created by another app.
  await sql`
    alter table app_data
    add column if not exists client_updated_at timestamptz
  `;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const sql = getSql();
    await ensureTable(sql);

    if (req.method === 'GET') {
      const rows = await sql`
        select value, client_updated_at, updated_at
        from app_data
        where key = ${DATA_KEY}
        limit 1
      `;

      if (!rows.length) {
        return res.status(200).json({
          ok: true,
          exists: false,
          data: null,
          updatedAt: null
        });
      }

      const row = rows[0];
      return res.status(200).json({
        ok: true,
        exists: true,
        data: row.value,
        updatedAt: row.client_updated_at || row.updated_at
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const value = body.data && typeof body.data === 'object' ? body.data : body;
      const savedAt = body.savedAt && !Number.isNaN(Date.parse(body.savedAt))
        ? body.savedAt
        : new Date().toISOString();

      await sql`
        insert into app_data (key, value, client_updated_at, updated_at)
        values (${DATA_KEY}, ${JSON.stringify(value)}::jsonb, ${savedAt}::timestamptz, now())
        on conflict (key)
        do update set
          value = excluded.value,
          client_updated_at = excluded.client_updated_at,
          updated_at = now()
      `;

      return res.status(200).json({ ok: true, updatedAt: savedAt });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: 'Data API error',
      message: error.message
    });
  }
};
