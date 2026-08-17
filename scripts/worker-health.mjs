import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) process.exit(1);
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  const result = await client.query(
    "SELECT \"lastSeenAt\" > NOW() - INTERVAL '45 seconds' AS healthy FROM \"WorkerHeartbeat\" WHERE name = 'primary'",
  );
  if (result.rows[0]?.healthy !== true) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
