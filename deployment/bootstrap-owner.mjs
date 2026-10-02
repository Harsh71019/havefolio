import process from 'node:process';
import console from 'node:console';
import pg from 'pg';
let protectedInput = '';
for await (const chunk of process.stdin) {
  protectedInput += chunk.toString();
  if (protectedInput.length > 4096) throw new Error('Invalid protected owner configuration');
}
const input = JSON.parse(protectedInput);
if (
  typeof input.email !== 'string' ||
  input.email !== input.email.trim().toLowerCase() ||
  typeof input.passwordHash !== 'string' ||
  !input.passwordHash.startsWith('$argon2id$')
)
  throw new Error('Invalid protected owner configuration');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(72808)');
  const existing = await client.query(
    'SELECT email, password_hash FROM users WHERE email IS NOT NULL',
  );
  if (existing.rowCount) {
    if (
      existing.rowCount !== 1 ||
      existing.rows[0].email !== input.email ||
      existing.rows[0].password_hash !== input.passwordHash
    )
      throw new Error('Existing owner requires operator review');
    console.log('Configured owner already exists; retained without changes.');
  } else {
    await client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
      input.email,
      input.passwordHash,
    ]);
    console.log('Configured owner created from protected Argon2id hash.');
  }
  await client.query('COMMIT');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Owner bootstrap failed; sensitive details withheld.');
  process.exitCode = 1;
} finally {
  await client.end();
}
