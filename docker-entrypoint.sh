#!/bin/sh
set -e

echo "Waiting for Postgres..."
until node -e "
const postgres = require('/migrate/node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 2, connect_timeout: 3 });
sql\`SELECT 1\`.then(() => { return sql.end(); }).catch(e => { process.exit(1); });
" 2>/dev/null; do
  echo "  db not ready, retrying in 2s..."
  sleep 2
done
echo "  db ready"

if [ "${RUN_DB_MIGRATE:-false}" = "true" ]; then
  echo "Running db:migrate..."
  (cd /migrate && ./node_modules/.bin/tsx scripts/migrate.ts) || echo "  db:migrate failed (continuing)"
elif [ "${RUN_DB_PUSH:-true}" = "true" ]; then
  echo "Running drizzle-kit push..."
  (cd /migrate && ./node_modules/.bin/drizzle-kit push --force) || echo "  drizzle-kit push failed (continuing)"
fi

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "Running seed..."
  (cd /migrate && ./node_modules/.bin/tsx ./scripts/seed.ts) || echo "  seed failed (continuing)"
fi

echo "Starting app..."
exec "$@"
