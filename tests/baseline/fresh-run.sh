#!/usr/bin/env bash
# Tumpukan sementara (proyek mtpp-nav, port 8081): bangun, jalankan alur, rekam, uji browser, hapus.
# Tidak pernah menyentuh database utama. Pakai: tests/baseline/fresh-run.sh <folder-keluaran> <logdir>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
OUT="$1"; LOG="$2"; mkdir -p "$LOG"
TEST_FILE=infra/compose/test.yml; FLOWS=tests/flows; E2E=tests/e2e
C="docker compose -p mtpp-nav -f docker-compose.yml -f $TEST_FILE"
fail=0
$C down -v >/dev/null 2>&1
$C up -d --build >"$LOG/build.txt" 2>&1 || { echo "BUILD GAGAL"; tail -30 "$LOG/build.txt"; exit 1; }
for i in $(seq 1 60); do curl -sf http://localhost:8081/api/auth/config >/dev/null && break; sleep 2; done
export API=http://localhost:8081/api BASE=http://localhost:8081 RUN_TAG=77777
node "$FLOWS/demo-flow.mjs" >"$LOG/demo.txt" 2>&1 || { echo "demo-flow GAGAL"; fail=1; }; tail -1 "$LOG/demo.txt"
node "$FLOWS/edge-flow.mjs" >"$LOG/edge.txt" 2>&1 || { echo "edge-flow GAGAL"; fail=1; }; grep -a 'Ringkasan' "$LOG/edge.txt"
node tests/baseline/capture.mjs "$OUT" || { echo "capture GAGAL"; fail=1; }
node "$FLOWS/validation-flow.mjs" >"$LOG/validation.txt" 2>&1 && echo "validation ok" || { echo "validation GAGAL"; grep -a "✗" "$LOG/validation.txt"; fail=1; }
# sesudah rekaman, supaya rekaman pembanding tidak berubah
node "$FLOWS/collection-flow.mjs" >"$LOG/collection.txt" 2>&1 && echo "collection ok" || { echo "collection GAGAL"; grep -a "✗" "$LOG/collection.txt"; tail -3 "$LOG/collection.txt"; fail=1; }
if [ "${SKIP_E2E:-}" != "1" ]; then
  for s in nav-audit page-audit alur-po-pelanggan alur-surat-jalan alur-berikutnya; do
    node "$E2E/$s.mjs" >"$LOG/$s.txt" 2>&1 && echo "$s ok" || { echo "$s GAGAL"; tail -5 "$LOG/$s.txt"; fail=1; }
  done
fi
$C down -v >/dev/null 2>&1
exit $fail
