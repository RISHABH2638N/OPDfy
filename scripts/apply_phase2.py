"""Surgically activate OPDfy's Phase 2 feature-flagged batching in existing code.

Run from project root: python scripts/apply_phase2.py
No live API/database traffic, and does not overwrite newer local queue code.
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
service = root / "server" / "src" / "services" / "queueReservationService.js"
imports = 'import { reserveOnlineQueueInBatch } from "./onlineReservationBatchService.js";'
marker = "  // Reduce same-process write conflicts without weakening the DB guarantee."
branch = '''  // Phase 2 opt-in (staging first). Preserve the Phase 1 path as rollback.
  if (process.env.BOOKING_BATCH_ENABLED === "1") {
    return reserveOnlineQueueInBatch({
      tenantId, patient, doctor, department, urgency, patientRequestedUrgency,
      date: today, timezone: tenant?.timezone || DEFAULT_TIMEZONE, feeQuote,
      signal: arguments[0]?.signal, startedAt: reservationStartedAt,
    });
  }

'''
required = [
  "server/src/utils/keyedAsyncBatch.js",
  "server/src/utils/planOnlineReservationBatch.js",
  "server/src/services/onlineReservationBatchService.js",
]
for relative in required:
    if not (root / relative).is_file():
        sys.exit(f"ERROR: Required new module missing: {relative}. Extract the patch ZIP at your OPDfy root first.")
if not service.is_file():
    sys.exit("ERROR: Cannot find server/src/services/queueReservationService.js. Run from correct project root.")
source = service.read_text(encoding="utf-8")
if "BOOKING_BATCH_ENABLED" in source:
    if imports in source:
        print("Already installed: Phase 2 branch present. No changes made.")
        sys.exit(0)
    sys.exit("ERROR: Unrecognized Phase 2 partial integration; inspect manually.")
if source.count(marker) != 1:
    sys.exit("ERROR: Expected Phase 1 booking queue anchor not found exactly once. No files changed.")
if source.count('import { databaseTransaction } from "../utils/databaseTransaction.js";') != 1:
    sys.exit("ERROR: Unexpected service imports. No files changed.")
if 'const reservationStartedAt = performance.now();' not in source or 'const feeQuote = await quoteVisitFee(' not in source:
    sys.exit("ERROR: Phase 1 service code differs from expected. No files changed.")
source = source.replace('import { databaseTransaction } from "../utils/databaseTransaction.js";',
    'import { databaseTransaction } from "../utils/databaseTransaction.js";\n' + imports, 1)
source = source.replace(marker, branch + marker, 1)
# Service overwritten only after ALL safety checks; database is never touched.
service.write_text(source, encoding="utf-8")
print("SUCCESS: Added Phase 2 opt-in path to existing service without replacing Phase 1 queue/abort behavior.")
print("Default remains Phase 1. Set BOOKING_BATCH_ENABLED=1 on STAGING only after verification.")
