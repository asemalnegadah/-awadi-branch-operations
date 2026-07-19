#!/usr/bin/env bash
set -euo pipefail

pg_host="${PGHOST:-localhost}"
case "${pg_host}" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "Refusing to run migration upgrade test against non-local host: ${pg_host}" >&2
    exit 1
    ;;
esac

pg_port="${PGPORT:-5432}"
pg_user="${PGUSER:-postgres}"
upgrade_db="awadi_promise_upgrade_${GITHUB_RUN_ID:-$$}_${RANDOM}"
psql_args=(--host "${pg_host}" --port "${pg_port}" --username "${pg_user}" --set ON_ERROR_STOP=1)

cleanup() {
  dropdb --if-exists --host "${pg_host}" --port "${pg_port}" --username "${pg_user}" "${upgrade_db}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

createdb --host "${pg_host}" --port "${pg_port}" --username "${pg_user}" "${upgrade_db}"

while IFS= read -r migration; do
  filename="$(basename "${migration}")"
  number="${filename%%_*}"
  if ((10#${number} <= 18)); then
    echo "Applying schema baseline ${filename}"
    psql "${psql_args[@]}" --dbname "${upgrade_db}" --file "${migration}"
  fi
done < <(find db/migrations -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort)

psql "${psql_args[@]}" --dbname "${upgrade_db}"   --file db/tests/upgrade/0018_payment_promises_backfill_seed.sql

for migration in   db/migrations/0019_payment_promises_idempotency_canonicalization.sql   db/migrations/0020_payment_promises_safe_create_payload_backfill.sql; do
  echo "Applying upgrade migration $(basename "${migration}")"
  psql "${psql_args[@]}" --dbname "${upgrade_db}" --file "${migration}"
done

psql "${psql_args[@]}" --dbname "${upgrade_db}"   --file db/tests/upgrade/0020_payment_promises_backfill_verify.sql

echo "Verified payment promise upgrade from schema 0018 through migrations 0019-0020."
