# OPDfy Clinic Edition — Booking performance patch (Phase 1)

## Scope

Patch built on **OPDfy_Clinic_Doctor_Wise_Online_Limit_Updated.zip**. This is a complete project snapshot; no production data/credentials are included. Code changes are server-side only. Deploy to **STAGING FIRST**, not production.

### Changes

1. **Remove the tenant-wide expiry `updateMany()` from every online booking** and receptionist reservation check-in. Today's availability/duplicate checks already filter by date, and stale-day check-in is explicitly rejected.
2. **Keep patient history accurate:** `/api/patients/me/tokens` now refreshes only that patient's old `reserved` records, instead of running a global update for every request. The lounge-access endpoint filters to the clinic-local date and no longer calls the global expiry operation.
3. **Scheduled historical expiry:** on startup (after 15 seconds) and every 10 minutes, run expiry for each active tenant under tenant scope, using that tenant's timezone. On-demand patient history also refreshes its own old records. Existing `expiredAt` behavior is retained.
4. **Indexes for the hot capacity check and expiry:** `{tenantId, doctor, reservationDate, status}` and `{tenantId, status, reservationDate}`. Existing indexes remain intact. Startup's existing `createIndexes()` loop creates the new indexes; verify logs and Atlas indexes on staging before a burst test.
5. **Same-process keyed FIFO around the original doctor-document transaction.** Each Node.js process queues writes for the same tenant/doctor/date locally to avoid local transaction stampedes. Different doctors run concurrently. The **original MongoDB transaction, doctor update, authoritative reservation count and insert remain unchanged** for correctness across multiple instances. The FIFO is *not* the authoritative distributed lock.
6. **Privacy-safe performance trace** under the existing `PERF_TRACE_CLINICS=1`: `[ClinicPerf] online_booking total=... queue_wait=... transaction=... count=... attempts=... outcome=...`. No patient tokens or patient names printed.
7. Unit tests for local FIFO ordering, parallel different keys, exception release, and async request-context preservation.

### Critical invariants preserved

- Per-doctor daily online cap, including `reserved` and `checked_in`.
- Admin lowering a cap never cancels existing bookings; further bookings pause until space exists.
- Cancellation remains through existing patient API, with no direct database deletes.
- No fixed numerical walk-in token limit introduced.
- Existing QR, check-in, fee quote, authentication and frontend are unchanged.
- Tenant-owned data stays tenant-scoped.

### Deployment / staging verification

1. Back up your code and compare changed files before merging. The archive is **not** a patch to be blindly extracted over a newer repo with unshared changes.
2. In `server`, run `npm ci`, `node --test test/keyedAsyncQueue.test.js test/onlineReservationPolicy.test.js`, and your existing server test suite.
3. Deploy this code to the STAGING backend and verify the new revision is actually live. Do not simply assume pushing main updated the staging service.
4. On staging, verify MongoDB indexes were created, doctor limit, OPD operating window, and total booked/checked-in count. Keep a Render log window open. Optionally set `PERF_TRACE_CLINICS=1` on staging during a controlled test, and disable afterward to reduce log volume.
5. Clean ALL old synthetic `reserved` test reservations through the API, including reservations created after client timeouts. Verify all patient preflights before a run.
6. Benchmark 10 -> 25 users with isolated runs and cleanup between them. Compare against baseline (10: average booking 2.814s; 25: average booking 8.818s). Only proceed to 50/75 after errors, latency, capacity and backend logs are satisfactory.
7. Independently test strict capacity: doctor limit 5 and 10 simultaneous distinct patient bookings should produce **no more than five committed active reservations**. Do not equate a 100-slot performance test with capacity correctness.
8. Also test cancellation capacity release, checked-in reservations retaining capacity, lowering/raising limit, stale history after midnight, old QR/check-in rejection, different doctors and multiple application processes.
9. Rollback by deploying the previous ZIP or Git commit if any regression occurs. Avoid direct database record edits.

### Limitations

This is a **targeted optimization, not a measured speed guarantee**. The transactional doctor row remains a shared write hotspot across app instances; high concurrency on Render/Atlas Free may still be slow. At least one full staging load run is required to prove throughput improvement. The local queue can add wait time when demand exceeds transaction throughput. Client-side timeout/idempotency recovery is not changed in Phase 1; reconcile ambiguous timeouts before retrying. A separate distributed capacity redesign may still be needed after benchmarking.

### Changed files

- `server/src/services/queueReservationService.js`
- `server/src/routes/patientRoutes.js`
- `server/src/models/QueueReservation.js`
- `server/src/index.js`
- `server/src/utils/keyedAsyncQueue.js` (new)
- `server/test/keyedAsyncQueue.test.js` (new)
