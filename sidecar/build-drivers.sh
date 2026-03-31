#!/usr/bin/env bash
# sidecar/build-drivers.sh
# Build all driver plugin binaries.
# Usage: ./build-drivers.sh [output-dir]
#   output-dir defaults to ./bin/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${1:-$SCRIPT_DIR/bin}"
GOOS="${GOOS:-$(go env GOOS)}"
GOARCH="${GOARCH:-$(go env GOARCH)}"
PLATFORM="${GOOS}-${GOARCH}"

mkdir -p "$OUTPUT_DIR"

# All driver packages to build. Each entry is: <package-dir>:<binary-name>
DRIVERS=(
  "postgres:driver-postgres"
  "mysql:driver-mysql"
  "sqlite3:driver-sqlite3"
  "sqlserver:driver-sqlserver"
  "clickhouse:driver-clickhouse"
  "duckdb:driver-duckdb"
  "pgx:driver-pgx"
  "cassandra:driver-cassandra"
  "snowflake:driver-snowflake"
  "bigquery:driver-bigquery"
  "trino:driver-trino"
  "presto:driver-presto"
  "vertica:driver-vertica"
  "hive:driver-hive"
  "exasol:driver-exasol"
  "firebird:driver-firebird"
  "cosmos:driver-cosmos"
  "dynamodb:driver-dynamodb"
  "spanner:driver-spanner"
  "databricks:driver-databricks"
  "databend:driver-databend"
  "athena:driver-athena"
  "couchbase:driver-couchbase"
  "flightsql:driver-flightsql"
  "h2:driver-h2"
  "ignite:driver-ignite"
  "impala:driver-impala"
  "maxcompute:driver-maxcompute"
  "netezza:driver-netezza"
  "voltdb:driver-voltdb"
  "ydb:driver-ydb"
  "avatica:driver-avatica"
  "chai:driver-chai"
  "csvq:driver-csvq"
  "moderncsqlite:driver-moderncsqlite"
  "mymysql:driver-mymysql"
  "ql:driver-ql"
  "ramsql:driver-ramsql"
  "sapase:driver-sapase"
  "saphana:driver-saphana"
  "ots:driver-ots"
  "oracle:driver-oracle"
  "odbc:driver-odbc"
  "adodb:driver-adodb"
  "godror:driver-godror"
)

echo "Building drivers for ${PLATFORM}..."

built=0
failed=0

for entry in "${DRIVERS[@]}"; do
  pkg="${entry%%:*}"
  binary="${entry##*:}"
  out_name="${binary}-${PLATFORM}"

  # Check if the driver main.go exists
  if [ ! -f "$SCRIPT_DIR/drivers/$pkg/main.go" ]; then
    continue
  fi

  printf "  %-30s" "$binary"
  if GOOS="$GOOS" GOARCH="$GOARCH" go build -ldflags="-s -w" -o "$OUTPUT_DIR/$out_name" "$SCRIPT_DIR/drivers/$pkg/" 2>/dev/null; then
    echo "ok"
    ((built++))
  else
    echo "FAILED"
    ((failed++))
  fi
done

echo ""
echo "Built: $built  Failed: $failed  Output: $OUTPUT_DIR"
