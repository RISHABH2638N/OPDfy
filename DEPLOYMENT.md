# Deployment and upgrade guide

> Current release: see [SEO_PERFORMANCE_REPORT.md](SEO_PERFORMANCE_REPORT.md) and [SEO_DEPLOYMENT_CHECKLIST.md](SEO_DEPLOYMENT_CHECKLIST.md). Production builds require the operator-verified PUBLIC_SITE_ORIGIN; earlier reports remain historical evidence.

> Current release: see [ACCESSIBILITY_REPORT.md](ACCESSIBILITY_REPORT.md) and `ACCESSIBILITY_EVIDENCE/` for accessibility corrections and the latest executed QA results. The previous QA report/evidence describes the historical baseline.

Current QA gate: run the isolated procedure in [QA_GUIDE.md](QA_GUIDE.md), and review [QA_REPORT.md](QA_REPORT.md) before staging. Test automation does not grant production approval. No runtime schema or deployment changes were introduced by this QA release.

## Current clinic security hardening release — 24 October 2026

Start with [SECURITY_HARDENING_REPORT.md](SECURITY_HARDENING_REPORT.md), especially its upgrade, MFA enrollment and rollback instructions. Deploy the matching client/server with one backend instance. Shared reservation capacity, socket admission and backup admission do not make Socket.IO broadcasts or scheduled jobs cluster-ready.

For installations already running the patient password release, this hardening update adds optional fields, system quota/admission collections and a non-unique reservation lookup index. It needs no clinical-data backfill, database reset, account reseed or generic `db:migrate` run. Startup checks/creates model indexes before listening; review index changes and resources on a staging copy first. Do not bypass index errors. The legacy migration procedure below concerns older database upgrades and invalidates pending OTPs.

To activate owner MFA, first set the new private, distinct `PLATFORM_MFA_ENCRYPTION_SECRET` (32+ random characters) and retain it securely. Keep `PLATFORM_MFA_REQUIRED=false` during initial rollout, enroll through `/platform/security`, store recovery codes and verify a second-factor login. Then set `PLATFORM_MFA_REQUIRED=true`. An enrolled account always requires MFA regardless of this flag. The flag restricts unenrolled owners to enrollment/status/logout, so confirm legitimate owners can enroll before enforcing it. Do not rotate or remove an enrolled account's encryption key without a reviewed recovery plan.

`SOCKET_MAX_CONNECTIONS_PER_IP=200`, `SOCKET_MAX_CONNECTIONS=1000` and `SOCKET_ATTEMPTS_PER_MINUTE=240` are conservative source defaults, not measured capacity. Configure exact trusted proxy hops, test clinic NAT/display traffic and monitor rejection/store-failure counts. `ONLINE_RESERVATION_LIMIT_PER_DOCTOR` now treats `0` as closed; confirm intended production settings before upgrade.

## Current patient password release

Read [PATIENT_PASSWORD_LOGIN.md](PATIENT_PASSWORD_LOGIN.md) before upgrading. Deploy the matching client and server together. This release adds unique partial indexes for patient usernames and credential grants. Startup creates them before listening; do not bypass index errors. Existing accounts and clinic memberships remain in place. Pending codes from the old OTP-login flow are intentionally incompatible; patients must request a new registration/recovery code.

## Release gate

See `SECURITY_HARDENING_REPORT.md` for this release's executed checks and remaining risks. Earlier `SECURITY_AUDIT_REPORT.md` describes its own historical snapshot. Complete the staging checklist below: actual Render/Atlas settings, SMTP delivery, external Gemini service, backup recoverability and real clinic/network workflows were not verified against a live deployment.

## Older database upgrade procedure (not required just for hardening)

1. Back up the database and confirm you can restore it. Keep the old source release for rollback.
2. Stop the old backend and its background workers during migration. Point a staging copy at a separate database first.
3. From `server`, install with `npm ci` and set the intended `MONGO_URI` in your private environment.
4. Run `npm run db:check`. It verifies replica-set support, counts conflicting active visits, detects legacy demo passwords and reports index differences without changing data. Resolve reported duplicate visits through a reviewed data correction; do not delete patient histories to silence an index error.
5. Run `npm run db:migrate` after the check passes. It invalidates pending global patient OTPs, replaces the old non-unique OTP email index and creates required indexes. It does not remove clinical records or automatically drop unrelated indexes. A failure can leave partially applied index changes; fix the reported condition and rerun before starting the new backend.
6. Start the new backend. Startup also checks/creates required indexes and will fail rather than silently ignore a conflicting definition.

Keep the appointment `slotKey` partial string index. Do not replace it with a unique index covering null/missing slots. New constraints also allow only one active token per patient, one called token per doctor, and one active appointment per patient/day within a clinic.

## Backend: Render or your Node host

Use the `server` directory as the service root. Build/install command: `npm ci --omit=dev`; start command: `npm start`; readiness path: `/health/ready`. Use one application instance initially: Mongo-backed rate limits are shared, but Socket.IO rooms and background job coordination need additional infrastructure before running multiple backend instances.

For UptimeRobot, monitor `https://YOUR-BACKEND-HOST/health/live` using an HTTP(S) monitor (GET, expected HTTP 200). `/api/health` is an existing liveness alias. Both return only `{"ok":true}`, require no authentication/clinic header, and bypass the database-backed API limiter. Keep Render's own health check path as `/health/ready`, which returns 503 when the MongoDB connection is unavailable. The real backend hostname was not supplied in this source release; replace the placeholder with the deployed service URL. External monitoring does not guarantee free-tier uptime or bypass hosting quotas. Render's free services block outbound SMTP ports 25, 465 and 587; this SMTP-based OTP implementation needs a host/plan/provider connection that permits delivery. See https://render.com/docs/free and https://render.com/docs/health-checks.

The earlier identity-review security update required no database reset or reseeding. The current password release additionally requires the new username and credential-grant indexes described above. Existing links without verified identity provenance now require the clinic's existing identity-review workflow before patient access to clinic records. Use `npm run privacy:identity-report` on a staging/backup copy to count affected links. Do not bulk-mark historical links verified or delete medical records. Fresh verified memberships continue working normally.

Set these private server variables:

| Variable | Value |
| --- | --- |
| NODE_ENV | production |
| MONGO_URI | Your production replica-set/Atlas connection string |
| CLIENT_URL | Exact frontend HTTPS origin, no trailing slash or path; comma-separated exact origins if needed |
| JWT_SECRET | Independent random secret, at least 32 characters |
| SUPER_ADMIN_JWT_SECRET | A different independent random secret |
| QR_JWT_SECRET | A different independent random secret |
| DISPLAY_KEY_ENCRYPTION_SECRET | A different independent random secret; retain securely to decrypt existing display keys |
| DEFAULT_TENANT_SLUG | Empty |
| TRUST_PROXY_HOPS | The exact trusted proxy hop count for your host; 0 for direct access |
| SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS | Your provider credentials; STARTTLS on 587 or TLS on 465 |
| OTP_FROM_EMAIL / OTP_FROM_NAME | Your verified sender identity |

Generate each secret separately with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Do not use the output as a client environment variable. Replace any credentials previously shared in chat or committed to a repository. Changing JWT/QR secrets invalidates sessions/QR codes; changing the display encryption secret needs a controlled display-key rotation.

Create the platform owner once with `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME` and a strong `SUPER_ADMIN_PASSWORD`, then `npm run superadmin:seed`. Remove the plaintext bootstrap password from the service environment afterward. This command updates an existing matching account and revokes its previous sessions. Register clinics through `/clinic/register`, then approve them in the platform console. Production demo bootstrap/seed commands are intentionally disabled.

Optional Gemini access uses `GEMINI_API_KEY` only on the server. Select a model enabled for your account with `GEMINI_MODEL`. External AI requires the patient's opt-in; requests time out after 12 seconds. Core queue operations do not need the external AI service.

## Frontend: Vercel or a static host

Use `client` as the root, `npm ci` to install, `npm run build` to build and `dist` as output. Set the build-time variables:

```dotenv
VITE_API_URL=https://YOUR-BACKEND-HOST/api
VITE_SOCKET_URL=https://YOUR-BACKEND-HOST
VITE_CLINIC_SLUG=
```

Replace the host values with your backend. A production build rejects missing or insecure HTTP URLs. Rebuild whenever the backend URL changes because it is included in the generated CSP. `client/vercel.json` contains SPA fallback and security headers; configure equivalent fallback/headers on another host. Do not put server credentials in VITE variables.

## Staging acceptance checklist

- Run `npm run test:integration` successfully on a machine that can launch MongoDB.
- Register and approve a clinic; sign in with each role. Try using clinic A credentials against clinic B and confirm access is denied.
- Receive and verify a real OTP using an authorized test account. Check SMTP sender verification and provider IP restrictions.
- Book/cancel/rebook an appointment, verify a missed QR is denied, collect an explicit fee at reception, repeat the check-in and confirm a single token/payment.
- Call/skip/complete visits; check prescription/history, reception interventions and fee hierarchy including intentional zero fees.
- Test a real phone at narrow width and a desktop: navigation, all action buttons, QR camera permission, print dialogs, TV voice announcements and live token notifications. Test network disconnect/reconnect and background/foreground transitions.
- Log out while a websocket is connected and confirm it closes. Confirm expired/suspended clinics lose access.
- Confirm HTTPS, API CORS allowlist, proxy IP/rate-limit behavior, database network access, backup/restore and monitoring on the actual hosts.

No live deployment or production data migration was performed as part of this source delivery.
