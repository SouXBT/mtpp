#!/usr/bin/env bash
# Pemeriksaan penuh: format, lint, tipe, uji unit, lalu alur + browser pada tumpukan sementara, dibanding rekaman awal.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
TMP="$(mktemp -d)"
npm run -s check || { echo "npm run check GAGAL"; exit 1; }
tests/baseline/fresh-run.sh "$TMP/now" "$TMP/log" || { echo "Alur GAGAL, log di $TMP/log"; exit 1; }
node tests/baseline/compare.mjs tests/baseline/expected "$TMP/now" || { echo "Beda dari rekaman, keluaran di $TMP/now"; exit 1; }
rm -rf "$TMP"; echo "SEMUA LULUS"
