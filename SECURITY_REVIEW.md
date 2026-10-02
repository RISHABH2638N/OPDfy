# Security re-audit — 2 October 2026

Current release: OPDfy Clinic Edition with verified health conditions.
Comparison baseline: `OPDfy_Clinic_Edition_Security_Audited_Final.zip` (30 September 2026). Current working input includes the landing medical accents, notification navigation, floating assistant, verified conditions, and the successful single-server integration-test lifecycle patch.

This is a source review plus automated regression/dependency checks. It is not a live production penetration test, certification, or guarantee against data leaks. No production credentials, MongoDB data, patient records, mail recipients, or running deployment were used.

## Current fixes

| Assessment | Finding | Resolution |
| --- | --- | --- |
| High registry advisory; application exploitability not demonstrated | Client lockfile used Axios 1.19.0, reported vulnerable by npm | Lockfile updated to Axios 1.20.0 within the existing package range; API/session tests and client build pass. Several listed issues concern Node adapters not used by this browser client; registry severity is not a proven OPDfy attack. |
| Medium availability | Both background incident-alert callers discarded an async promise. Alert-state database writes can reject outside the mail-error handler, producing an unhandled rejection during a database outage. | Shared `queueSecurityAlert` handles rejection and emits only a safe diagnostic. Both manual incident creation and automatic detection use it. The explicit awaited retry endpoint still reports failure. Test forces MongoNotConnectedError and verifies no private error message is logged. |
| Medium integrity hardening | A condition patch derived from a loaded snapshot used a client revision directly in the atomic filter. A guessed newer revision could target a newer record while the calculated patch still described the older snapshot. | Require the client revision to equal the loaded snapshot before writing; retain the atomic revision filter to reject changes after the read. Patient selection and clinician review are covered. No unauthenticated or cross-patient exploit was observed. |
| Low audit coverage | Successful condition-review/EHR and aggregate condition-insight GETs were absent from the existing sensitive-access audit matcher. | Include these paths in the existing logger. Log identity/tenant/route only, with object IDs normalized and query values/condition contents excluded. Failed and anonymous reads produce no success event. |

## Review coverage

Reviewed shared authentication and revocation, clinic execution context and scoped model hooks, global membership provenance, role gates, called-patient EHR/history/review access, owner-filtered appointment/referral/consent paths, QR/payment checks, OTP protections, public/private websocket rooms and logout races, public queue redaction, exports and CSV formula escaping, condition consent and small-group suppression, privacy closure/export behavior, input/operator guards, safe errors/logs, production HTTPS/CSP configuration, image validation, external AI consent boundaries, backup-worker launch/error boundaries, and dependency lockfiles.

Existing behavior remains: patients cannot self-confirm conditions; only their assigned doctor with a called non-archived token can review; analytics require current consent and confirmed entries; groups below five (including zero) are withheld. This suppression is not mathematical anonymity: comparing exact counts across overlapping periods and external information can still allow inference. Existing operational exports intentionally retain their original authorized identity fields; only condition exports are aggregate.

## Verification performed in this re-audit

| Check | Result |
| --- | --- |
| Client clean install from updated lockfile | PASS (`npm ci --ignore-scripts`) |
| Client privacy/session/localization suite | 34 passed, 0 failed |
| Client appearance + health-condition checks | 6 passed, 0 failed |
| Client production build | PASS using reserved HTTPS example URLs for compilation only; existing large-bundle warning remains |
| Server default suite | 146 passed, 0 failed (includes three new re-audit regression cases) |
| Server privacy suites | 44 passed, 0 failed |
| Server HTTP/realtime audit suite | 18 passed, 0 failed |
| Server syntax/import validation | PASS — 194 source files and 739 imports |
| Final client/server registry audits | 0 reported advisories in each lockfile on 2 October 2026 |
| Credential-pattern scan | No actual secret identified; two known placeholder/fixture Mongo URIs reviewed |
| Production assets | CSP present, no sourcemaps, production console logging stripped |
| New disposable MongoDB integration run | BLOCKED — mongod exited 100 before test bodies; this environment has previously diagnosed `open: Operation not permitted` |
| User's Windows run before these final hardening edits | User supplied logs show conditions 5/5 and full integration 23/23; separate from current verification |
| Live hosting/Atlas/SMTP/Gemini/load/backup restore and browser interaction | NOT RUN |

Total current passing cases: 248 (40 client + 208 server). The extra focused 8-case rerun overlaps the above totals and is not counted twice. Database integration is not claimed as passed for this final source. Server dependencies reused the previously installed exact lockfile versions; the server lockfile was unchanged.

## Upgrade and local run

Keep your private environment files and real database. No reseed, deletion, migration, new dependency category, API contract change, or UI modification is required by this audit. Use the supplied lockfile (Axios 1.20.0); this incorporates the equivalent dependency correction rather than restoring the old vulnerable lockfile.

From the extracted OPDfy folder, run in two PowerShell terminals:

```powershell
# Server terminal
cd server
npm ci
npm run dev
```

```powershell
# Client terminal
cd client
npm ci
npm run dev
```

Local client configuration remains:

```dotenv
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
VITE_CLINIC_SLUG=demo-clinic
```

Server CLIENT_URL must include http://localhost:5173 in local development. Real MongoDB must support transactions for appointment/check-in/consultation workflows. Production client builds still require your actual HTTPS VITE_API_URL and VITE_SOCKET_URL; do not deploy example.invalid build URLs. Production server starts with `npm start` after the existing DEPLOYMENT.md configuration.

Before deployment, rerun on your machine:

```powershell
# In server
npm test
npm run test:privacy
npm run test:audit
npm run test:integration
npm run source:check
```

```powershell
# In client
npm run test:privacy
node --test test/appearance.test.mjs test/healthConditions.test.mjs
# With actual HTTPS production URLs configured:
npm run build
```

## Limits still requiring operational verification

No MFA was added. Session storage remains readable by same-origin scripts. Audit writes are best effort; a database outage can prevent persistence even though requests or background failure handlers are safe. Mail delivery failures remain visible; handling the rejection does not configure SMTP. Real frontend response headers, TLS, proxy trust, database network/permissions, backup encryption/storage, restore drills, edge/socket connection limits and external AI disclosure/medical safety require deployment review. No live access or production scan was authorized or performed.

Upstream references consulted: https://github.com/axios/axios/releases/tag/v1.20.0 and https://github.com/axios/axios/security/advisories/GHSA-vh66-26gq-q6x8. Detailed local checks and scope are specific to this source, not conclusions from upstream advisories.

---

# Historical reviews (retained; results below are not this re-audit)

# Security review and release evidence

Review date: 5 September 2026. Source: OPDfy Day 20.3, updated to 2.1.0. Scope: supplied frontend/backend source, dependency lockfiles, tenant/auth/payment/QR/realtime paths and deployment configuration. No production credentials or live patient data were used.

## Verification results

| Check | Result | Limits |
| --- | --- | --- |
| Clean dependency install, both packages | PASS | `npm ci --ignore-scripts`; installation lifecycle scripts intentionally disabled during verification |
| Backend security regression suite | PASS — 76 tests, 0 failures | Real HTTP/Socket.IO and Mongoose hooks with controlled model responses; not real database end-to-end tests |
| Node syntax checks | PASS — 76 JavaScript files | Server source, scripts and test files |
| Production frontend build | PASS | Built with reserved example HTTPS backend URLs; actual deployment URLs must be configured and rebuilt |
| Server npm audit | 0 known vulnerabilities | Registry audit snapshot of the lockfile; not a guarantee about application behavior |
| Client npm audit | 0 known vulnerabilities | Same scope and limitation |
| Disposable MongoDB integration suite | BLOCKED | MongoDB process exited with code 100; runtime reported `open: Operation not permitted`. Startup failed before the 10 test cases could run. No database test is claimed as passed. |
| Browser/mobile interaction and visual QA | NOT RUN | Responsive rules and accessibility improvements were implemented; actual browser behavior needs staging verification |
| Real SMTP, Gemini, hosting, load and backup tests | NOT RUN | Require configured services and a staging deployment |

## Defects addressed

Priorities below are source-review assessments, not externally certified CVSS scores.

| Priority | Finding | Change |
| --- | --- | --- |
| High | Tenant context could be lost when a Mongoose thenable escaped AsyncLocalStorage | Await database work inside the tenant context; regression test exercises actual query middleware |
| High | Tenant ownership updates and unscoped database operations could undermine isolation | Immutable tenant IDs, scoped queries/distinct, guarded inserts/updates; unsafe bulk/count and cross-collection aggregate paths rejected |
| High | Some patient sessions did not check revocation | Validate tokenVersion, algorithm, expiry and identity consistently |
| High | Websocket credentials, expired sessions and clinic access required stronger checks | Authenticate against current accounts, exact Origin validation, subscription checks, periodic revalidation, expiry timers and immediate logout disconnect |
| High | Consultation completion broadcast queue data globally | Emit only to tenant-scoped rooms and the matching patient |
| High | QR verification/check-in lacked consistent staff authorization/collector identity | Require reception/admin for reception scanner routes and pass the authenticated collector; patient self-check-in retains its own guarded flow |
| High | Missing/malformed payment values could silently resolve as full payment | Require explicit valid amounts, retain fee/discount rules, reject unverified positive-fee collection |
| High | OTP verification and replay races | Keyed HMAC hashing, timing-safe comparison, bounded atomic attempts and single-use atomic consumption |
| High | Concurrent visit writes could leave partial or duplicate state | Unique active-visit constraints, optimistic concurrency and transactions for appointment/reservation check-in and consultation completion; real DB behavior still needs the blocked integration tests |
| Medium | Doctor object access and consultation history identity inconsistencies | Enforce assignment for ETA and use the verified doctor ID for history |
| Medium | Malformed input, operator injection and Express 4 rejected promises | Request shape/depth/size guards, Mongo key rejection, wrapped async routes and generic internal errors |
| Medium | Formula injection in CSV exports | Quote cells and neutralize spreadsheet formula prefixes |
| Medium | Long-lived browser storage and clinic/socket transitions | Per-tab sessionStorage, legacy local token cleanup, explicit production clinic selection, logout/401 cleanup |
| Medium | Public settings could expose private billing configuration | Whitelist public settings fields |
| Medium | Weak bootstrap defaults and permissive production setup | Remove default passwords, block production demo seed/bootstrap, validate independent secrets and exact HTTPS origins |
| Medium | AI credentials in URLs and unbounded outbound duration | API key header, encoded model path, 12-second timeout, bounded output and generic upstream error responses |
| Medium | SMTP and external image handling | TLS/timeouts, disable attachment URL/file access, escape notification HTML, HTTPS asset allowlist and image signature checks |
| Medium | Dependency advisory and broken lockfiles | Repair lockfiles; resolve qs to patched 6.16.x while retaining Express 4; both audits clean |
| Low | Duplicate/dropped operational realtime updates and scanner bursts | Union room broadcast, recognize billing/settings changes, debounce repeated QR scans |
| Low | Malformed CSS and production bundle configuration | Correct CSS escapes; split QR scanner/vendor chunks; generated CSP and static-host headers |

## Regression coverage

The 76 passing tests cover malformed/deep/operator/prototype inputs, JSON errors, CORS, cache/security headers, JWT expiry/algorithm/revocation, clinic and role gates, QR authorization and missed status, private-setting redaction, doctor assignment, payment validation and fee precedence, CSV escaping, image validation, websocket authentication/origin/expiry/logout/reauthentication, tenant query scoping and ownership protection, the appointment partial slot index, production secret rejection and Express async error handling.

The separate database suite includes actual tenant isolation, slot reuse and visit uniqueness, paid/idempotent/concurrent check-in, transaction rollback, self-payment protection, missed QR, concurrent OTP replay and revoked patient access. These tests are supplied but could not execute because their disposable MongoDB process could not start.

## Remaining deployment requirements

- Follow DEPLOYMENT.md for backup, database preflight/migration and staging acceptance. New indexes can reveal pre-existing duplicate records; those must be reviewed before deployment.
- Runtime/browser execution may reveal defects that static review and controlled tests cannot detect. This release is not a claim of zero bugs, a complete penetration test, or a compliance certification.
- Single backend instance is the supported deployment shape in this release. Horizontal scaling needs a shared Socket.IO adapter and coordination for scheduled jobs.
- SessionStorage is accessible to same-origin JavaScript; CSP and React escaping reduce exposure but do not make an XSS vulnerability harmless. Inline styles remain allowed for existing UI compatibility.
- Configure host TLS, exact proxy trust, database access restrictions, secret rotation, backup/restore and operational monitoring. Dependency audits do not validate these controls.
- External AI remains an optional routing aid. Its clinical output and emergency phrase detection have not been clinically validated; neither replaces clinician assessment.

## References

- OWASP object-level authorization: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- Express production security: https://expressjs.com/en/advanced/best-practice-security/
- qs advisories: https://github.com/advisories/GHSA-4mjr-xmp4-gh2g and https://github.com/advisories/GHSA-x5fp-wj9c-mxmx
- Mongoose transactions: https://mongoosejs.com/docs/transactions.html
- MongoDB driver transactions: https://www.mongodb.com/docs/drivers/node/current/crud/transactions/
- Gemini API authentication: https://ai.google.dev/api

Machine-readable dependency audit snapshots and security regression output are included in `reports/`.


## Condition feature review — 1 October 2026

This update is not a new end-to-end penetration test or a security certification.

- Patient writes identify the patient from `protectPatient`, not a submitted patient ID. Identity-review guards remain active.
- Doctor reads/writes require the doctor's own assigned, non-archived, actively called token in the selected tenant and department. Reviewed condition codes and decisions are validated server-side.
- Condition/profile changes use a single document update guarded by a condition revision. A stale write fails rather than silently overwriting a newer patient submission or doctor review.
- Tenant filters are explicit on patient/token reads and writes and on the aggregate pipeline; the existing tenant-scoped model plugin remains in place.
- New condition reports require clinic Admin authentication, doctor-confirmed entries and current optional analytics permission. Closed-account/contact-disabled profiles are excluded. Permission defaults to false and cannot be set by a doctor's review request.
- Reports have aggregate counts only; groups below five, including zero, are withheld. Suppression reduces disclosure but is not a guarantee of mathematical anonymity, especially when an authorized operator combines repeated reports with external information. Existing operational exports retain their previous identity fields; the new condition report does not include them.
- New API responses and condition CSV use `Cache-Control: no-store`. Condition data is not included in cached session summaries or sent by this feature to external AI services. Personal-data exports include the new clinic record fields. Account closure withdraws their analytics permission.
- No new dependencies, environment names, database indexes, token formats or Socket.IO contracts were added.

Verification: client 40 tests and production build passed; server 143 unit/API, 44 privacy and 18 audit tests passed; source checks passed. New API tests use mocked model boundaries. Actual database integration was attempted but MongoDB exited at startup with `Operation not permitted` in this environment; browser visual/interaction checks were unavailable. Those checks remain deployment gates. The update does not claim complete live deployment or security verification.


### Test setup correction — 2 October 2026

The supplied Windows log reports 23 successful integration assertions followed by a failed condition test file due to pending MongoDB work after teardown. The condition test now awaits automatic model collection/index initialization after importing the application. This is a test-only lifecycle change. Syntax and source checks were performed; an actual corrected database run could not execute here because MongoDB startup is restricted. Production security guards and client HTTPS build validation remain unchanged.
