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
