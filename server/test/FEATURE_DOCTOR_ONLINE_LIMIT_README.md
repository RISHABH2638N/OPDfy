# OPDfy Clinic Edition — Doctor-specific online reservation capacity

Source: `OPDfy(4).zip`, modified in-place in this deliverable. Backend and frontend retain the existing application structure.

## What is implemented

- Clinic administrator can set 0–10,000 online token reservations/day per doctor from **Admin Dashboard → Doctor Schedule & Room Management → Daily Online Token Reservation Limit**.
- Settings are stored on the doctor (tenant-scoped `User`), not in a global Render env variable. Existing doctors with no override use the previous env setting or a fallback of **70**.
- **Zero** disables new online reservations for this doctor. No numeric cap was introduced for reception walk-in token issuance. Clinic hours, medical workflow, existing queue and authorization checks continue to apply.
- `reserved` and `checked_in` online reservations count against the doctor's daily online limit. `cancelled` and `expired` reservations do not.
- Lowering today's limit below current bookings preserves **all** existing reservations and prevents further online bookings until used capacity is below the new limit. Increasing the limit allows more online bookings.
- Transactional concurrency control: each online booking transaction updates the doctor's `reservationCapacityRevision` before counting used places and writing the new reservation, serializing conflicting writers on the same doctor record. Limit changes write the same record. Requires **MongoDB replica set transactions** (already required by the original project). This may increase write latency on large simultaneous bursts; correctness before speed.
- Shared service affects patient portal + AI reservation flow. Walk-in routes were not modified.

## API

- `GET /api/admin/online-reservation-usage` — today (clinic timezone), per-doctor booked count and effective online limit.
- `PATCH /api/admin/users/:id/online-reservation-limit` — JSON `{"onlineReservationLimit":30}`. Admin session and tenant context required. Whole integer 0–10000.

## Installation

1. Back up the current project and use a separate git branch, preferably `doctor-online-capacity`.
2. The ZIP contains complete application source under `OPDfy/`, **excluding `.git`, private `.env` credentials and dependencies**. Unpack into a project copy or copy only the changed files listed below over your existing repository. Do not overwrite your live `.env`.
3. From `OPDfy/server`: `npm ci`, then `npm test` and `npm run source:check`.
4. From `OPDfy/client`: `npm ci`, then `npm run build`.
5. Deploy **staging first**; ensure MongoDB transactions and existing indexes work correctly before production deployment.
6. No MongoDB data reset or manual migration is required. Existing doctor records fall back to the previous default limit.

## Staging verification checklist (important)

- Admin sets doctor limit 50; create 40 test reservations. Lower limit to 30: display shows 40/30, original 40 remain and new requests get HTTP 409.
- Raise limit to 41: allow exactly one additional online reservation. Cancel an active unconfirmed reservation through the normal API: one online place is freed if below configured cap.
- For a clean doctor/day, set online limit 5 and send 10 **different patients** concurrently: expect exactly five 201 and five 409, no more than five `reserved`/`checked_in` records for that doctor/day. Repeat across different clinics to confirm tenant isolation.
- After lowering/raising/cancelling, verify reception still issues ordinary walk-in tokens while clinic operations allow arrivals. Existing reservations are not changed.
- Check clinic timezone and midnight date rollover, and verify patient portal + AI reservations both observe doctor-specific limits.
- In a large burst, database write contention can increase request latency. Monitor errors and transaction retries; avoid interpreting expected capacity 409 as server failure.

## Automated verification performed here

- Backend JavaScript syntax checks: passed.
- Frontend source syntax check: passed (TypeScript transpilation).
- Local import resolution check: passed.
- Unit tests of fallback/per-doctor/zero/invalid limits: 3 passed.
- **Not executed here:** full frontend Vite production build, MongoDB transaction integration test, end-to-end live staging tests (requires installed dependencies and MongoDB). Run those before deploying to real clinics.

## Files changed / added

- client/src/App.jsx (modified)
- client/src/locales/en-hi.json (modified)
- client/src/styles.css (modified)
- server/src/models/User.js (modified)
- server/src/routes/adminRoutes.js (modified)
- server/src/services/queueReservationService.js (modified)
- server/src/utils/onlineReservationPolicy.js (new)
- server/test/onlineReservationPolicy.test.js (new)
