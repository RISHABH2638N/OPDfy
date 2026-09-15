# Deployment and upgrade guide

## Release gate

Before live use, run the included database integration suite on a supported machine and complete the staging checklist below. The packaged build and 76 security regression tests passed; actual MongoDB transaction/index execution, browser interaction, real mobile sync, SMTP delivery and hosting configuration were not verified here.

## Existing database upgrade

1. Back up the database and confirm you can restore it. Keep the old source release for rollback.
2. Stop the old backend and its background workers during migration. Point a staging copy at a separate database first.
3. From `server`, install with `npm ci` and set the intended `MONGO_URI` in your private environment.
4. Run `npm run db:check`. It verifies replica-set support, counts conflicting active visits, detects legacy demo passwords and reports index differences without changing data. Resolve reported duplicate visits through a reviewed data correction; do not delete patient histories to silence an index error.
5. Run `npm run db:migrate` after the check passes. It invalidates pending global patient OTPs, replaces the old non-unique OTP email index and creates required indexes. It does not remove clinical records or automatically drop unrelated indexes. A failure can leave partially applied index changes; fix the reported condition and rerun before starting the new backend.
6. Start the new backend. Startup also checks/creates required indexes and will fail rather than silently ignore a conflicting definition.

Keep the appointment `slotKey` partial string index. Do not replace it with a unique index covering null/missing slots. New constraints also allow only one active token per patient, one called token per doctor, and one active appointment per patient/day within a clinic.

## Backend: Render or your Node host

Use the `server` directory as the service root. Build/install command: `npm ci --omit=dev`; start command: `npm start`; readiness path: `/health/ready`. Use one application instance initially: Mongo-backed rate limits are shared, but Socket.IO rooms and background job coordination need additional infrastructure before running multiple backend instances.

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
