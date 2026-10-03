OPDfy

Real-time OPD queue, clinic operations and patient-care coordination platform







OPDfy is a bilingual, multi-clinic healthcare operations platform that connects patients, doctors, reception teams, clinic administrators and platform administrators in one coordinated workflow. It brings token booking, live queues, appointments, consultations, prescriptions, referrals, follow-ups and privacy operations into a single responsive web application.

Project status: Active development / deployment candidate. The repository includes automated security and regression checks, but this is not a claim of legal, medical or security certification. Every production deployment must be independently configured, reviewed and tested.

Why OPDfy?

Small and growing clinics often coordinate patient arrivals, queues, appointments and follow-ups through registers, calls and disconnected messages. OPDfy provides a shared digital workflow while keeping every clinic's operational and clinical data tenant-scoped.

Product highlights

Multi-tenant clinic workspaces with role-based access

Patient email OTP sign-in and staff password recovery using registered email

Live token and queue updates through authenticated Socket.IO sessions

Walk-in registration, appointments, QR-assisted workflows and waiting-lounge display

Doctor profiles with qualification/designation, rating and verified-review count

Consultation notes, clinical history, prescriptions and treatment consent

Same-clinic department referrals and doctor-to-doctor care hand-off

Follow-up reminders before and after the scheduled date

Hindi and English interfaces with dark/light themes

Responsive layouts designed for patient mobile usage and staff desktops

Clinic onboarding, approval, suspension and subscription controls

Privacy requests, identity review, correction workflows and retention registry

Incident response, notification evidence and operational-readiness workflows

Encrypted backups and isolated restore-drill support

User portals

Portal

Main capabilities

Patient

Email OTP login, clinic discovery, doctor rating and qualification, token/appointment booking, live queue, health profile, prescriptions, referrals, follow-ups, notifications, treatment consent and privacy requests

Doctor

Live queue, patient context, consultation documentation, prescription creation, follow-up planning and department referral

Reception

Patient registration, walk-in tokens, appointment handling, queue interventions, payment status and prescription handover

Clinic Admin

Staff and department management, clinic configuration, operational overview, identity review and clinic-scoped privacy workflows

Platform Admin

Clinic approval/suspension, subscriptions, platform branding, privacy governance, incident response, operational evidence, monitoring and backup/recovery controls

Waiting Lounge

Public queue display with real-time and voice-assisted calling updates

System architecture

flowchart TD
    A[React + Vite client] -->|HTTPS REST API| B[Express application]
    A <-->|Authenticated Socket.IO| C[Realtime gateway]
    B --> D[(MongoDB replica set)]
    C --> D
    B --> E[SMTP email provider]
    B --> F[Backup and restore storage]
    B -. Optional .-> G[Gemini integration]

All tenant-owned operations are expected to be scoped by the authenticated clinic and role. MongoDB transactions are used by workflows that must update multiple records atomically.

Technology stack

Frontend

React 18

Vite 6

React Router

Axios

Socket.IO Client

Lucide React

QR code generation and scanning

Custom responsive CSS, dark mode and bilingual UI

Backend

Node.js 22.16+

Express 4

MongoDB and Mongoose

Socket.IO

JWT and bcrypt

Nodemailer / SMTP

Helmet, CORS and rate limiting

AWS S3-compatible backup storage support

Repository structure

OPDfy/
├── client/                 # React/Vite web application
│   ├── src/                # Pages, components, hooks, contexts and styles
│   ├── public/             # Public frontend assets
│   └── .env.example        # Frontend environment template
├── server/                 # Express, Socket.IO and MongoDB backend
│   ├── src/
│   │   ├── models/         # Mongoose data models
│   │   ├── routes/         # REST API routes
│   │   ├── middleware/     # Authentication, authorization and validation
│   │   └── services/       # Email, privacy, monitoring and backup services
│   ├── scripts/            # Migration, SMTP and operational scripts
│   ├── tests/              # Backend regression and security tests
│   └── .env.example        # Backend environment template
├── DEPLOYMENT.md           # Production deployment guidance
└── SECURITY_REVIEW.md      # Security scope, findings and limitations

Prerequisites

Node.js 22.16 or newer

npm

MongoDB Atlas or another replica-set deployment

SMTP account for OTP and operational emails

Two terminals for local frontend and backend development

Standalone MongoDB is not recommended because onboarding and visit workflows rely on transaction support.

Local installation

1. Clone the repository

git clone <your-repository-url>
cd <your-repository-folder>

2. Configure and start the backend

cd server
npm ci

Copy server/.env.example to server/.env, then configure at least:

PORT=5000
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>/<database>
JWT_SECRET=<long-random-secret>
QR_JWT_SECRET=<different-long-random-secret>
DISPLAY_KEY_ENCRYPTION_SECRET=<different-long-random-secret>
CLIENT_URL=http://localhost:5173

SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_USER=<smtp-user>
SMTP_PASS=<smtp-password>
OTP_FROM_EMAIL=<verified-sender-email>
OTP_FROM_NAME=OPDfy

Never commit .env, database credentials, SMTP credentials or backup encryption keys.

Check the database before starting:

npm run db:check

Only after reviewing the output and taking a database backup, apply a required migration:

npm run db:migrate

Start the API:

npm run dev

Expected local backend URL: http://localhost:5000

3. Configure and start the frontend

Open another terminal:

cd client
npm ci

Copy client/.env.example to client/.env:

VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
VITE_CLINIC_SLUG=

Start the client:

npm run dev

Open http://localhost:5173.

Test on a phone over local Wi-Fi

Run Vite on all local interfaces:

npm run dev -- --host 0.0.0.0

Set the frontend API and socket URLs to your computer's LAN IP, for example http://192.168.1.10:5000/api and http://192.168.1.10:5000. Keep the phone and computer on the same network and allow the required ports through the local firewall.

Application routes

Route

Purpose

/patient-login

Global patient sign-in

/patient/clinics

Patient clinic selection

/login

Clinic staff sign-in

/clinic/register

New clinic registration

/platform/login

Platform administrator sign-in

/waiting-lounge

Waiting-lounge display entry

Protected dashboard routes redirect unauthenticated users to the appropriate sign-in screen.

Initial accounts and development seeding

Platform administrator credentials are configured through protected server environment variables. Use strong, unique credentials and enable the additional approval controls required by your deployment.

Optional development-only demo accounts can be created from server/:

$env:SEED_ADMIN_PASSWORD="Use-A-Unique-Password"
$env:SEED_DOCTOR_PASSWORD="Use-A-Different-Password"
npm run seed

Passwords must be at least 12 characters and no more than 72 UTF-8 bytes. Demo seeding is blocked in production and no default password is published.

Useful scripts

Client

Command

Purpose

npm run dev

Start the Vite development server

npm run build

Create the production build

npm run preview

Preview the production build locally

npm run test:privacy

Run the client routing, localization and privacy regression tests

npm audit --omit=dev

Audit production dependencies

Server

Command

Purpose

npm run dev

Start with Nodemon

npm start

Start in production mode

npm test

Run backend regression tests

npm run test:audit

Run focused security-audit tests

npm run test:integration

Run disposable-database integration tests

npm run db:check

Report data/index migration requirements without changing data

npm run db:migrate

Apply the reviewed database migration

npm run smtp:check

Verify SMTP connectivity and sender configuration

npm audit --omit=dev

Audit production dependencies

Verification snapshot

The latest packaged source was checked with:

Client regression tests: 33/33 passed

Client production build: passed

Server regression tests: 127/127 passed

Focused server security-audit tests: 17/17 passed

Server source/import check: 179 files and 700 imports checked

Client and server production dependency audit: 0 known vulnerabilities reported at test time

These results describe one source snapshot and one test environment. They do not replace deployment-specific penetration testing, access review, dependency monitoring, privacy assessment, backup drills or medical workflow validation.

Security and privacy design

The project includes safeguards such as:

Role-based authorization and clinic/tenant scoping

Short-lived authentication flows and token revocation controls

Password hashing and OTP verification

Request validation, rate limiting and protected error responses

Helmet security headers and explicit CORS configuration

Authenticated and tenant-scoped real-time channels

Atomic/transactional handling for sensitive queue and appointment updates

Privacy consent, request, correction and identity-review records

Incident evidence preservation and notification tracking

Encrypted backup creation and isolated restore drills

Activity and security event records for privileged operations

Before production use, review SECURITY_REVIEW.md and DEPLOYMENT.md. Configure HTTPS, trusted origins, strong secrets, least-privilege database access, verified SMTP senders, monitoring alerts and tested restore procedures.

Production deployment

The intended split deployment is:

Component

Recommended service

Configuration

Frontend

Vercel

Root client, build npm run build, output dist

Backend

Render or equivalent Node host

Root server, build npm ci --omit=dev, start npm start

Database

MongoDB Atlas

Replica set with network and least-privilege user restrictions

Backend first

Deploy the server directory.

Configure all production environment variables.

Set NODE_ENV=production and the exact HTTPS frontend URL in CLIENT_URL.

Confirm the readiness endpoint at /health/ready.

External uptime monitors can use `GET https://<your-backend-host>/api/health`. This public endpoint needs no clinic header or login and returns HTTP 200 while the backend process is responding. Use `/health/ready` when you also need MongoDB readiness (HTTP 503 while disconnected).

Frontend second

Set Vercel production environment variables to the real backend origin:

VITE_API_URL=https://<your-backend-domain>/api
VITE_SOCKET_URL=https://<your-backend-domain>

Then build and deploy the client directory. Placeholder domains such as api.example.com must never be used for a real deployment.

Backup and disaster recovery

Backup code alone is not disaster recovery. A production operator must:

Configure the backup destination and encryption secrets.

Enable the reviewed backup schedule.

Monitor successful and failed backup notifications.

Run restore drills only against a separately configured disposable database.

Record evidence, verify collection counts and remove drill data when finished.

Keep production restore unavailable from the browser UI.

Never point the disposable restore URI at the production database.

Responsible operation

OPDfy processes healthcare and identity-related information. A clinic or operator deploying it remains responsible for:

Confirming the applicable legal and regulatory obligations

Publishing accurate privacy notices and terms

Collecting valid consent where required

Training staff and reviewing access permissions

Establishing retention, correction and breach-response procedures

Verifying clinical workflows with qualified healthcare professionals

Maintaining secure infrastructure, backups and incident contacts

The software should support clinical operations; it must not be presented as a substitute for medical judgment or emergency services.

Support

For project support or deployment questions:

Rishabh Mishra
Email: rishabhmishra263800@gmail.com

Please do not include patient records, passwords, OTPs, database URIs or other sensitive information in support messages.

License

No open-source license is included in this repository. Unless a separate written licence states otherwise, the source code is proprietary and all rights are reserved by the project owner.

Built with care for faster clinic operations and a clearer patient journey.


## Verified health conditions update — 1 October 2026

### Where to use it

- **Patient:** select a clinic, then Sidebar → Health Conditions. Choose “I have known health conditions”, add one or more conditions from the dropdown, and save. “No known conditions” and “Prefer not to say” are separate declarations, not diagnoses. Conditions are initially patient-reported / pending review.
- **Doctor:** call the registered patient, then Sidebar → Patient EHR. The “Review Health Conditions” card supports Confirm, Edit & Confirm, and Not confirmed. Review is available only for your assigned, actively called patient in your clinic. The reviewer, timestamp and source token are saved.
- **Clinic Admin:** Clinic Settings → Data Export → Confirmed Condition Insights. Choose the existing from/to dates and a condition filter. Download the CSV, which opens in Excel. Refresh after a clinical review or consent change.

The catalog contains diabetes, hypertension, heart disease, stroke history, chronic kidney disease, asthma, COPD/chronic breathing conditions, cancer, thyroid disorder, chronic liver disease and other chronic conditions.

### Data and privacy rules

- Structured conditions and doctor verification remain tenant-owned. Existing medical-history text and the global reusable profile continue to work; neither is automatically treated as a verified diagnosis.
- Changing the selected condition list resets its reviews to pending. Resaving the same selection or changing analytics permission preserves existing reviews. Revision checks reject simultaneous/stale edits with HTTP 409.
- Aggregate reporting requires both doctor confirmation **and** the patient's optional analytics permission. The default is no permission. Withdrawing permission removes the contribution from newly generated reports; previously downloaded files cannot be recalled.
- Reports contain condition labels and distinct patient counts only, without names, contact details, patient IDs, reviewer IDs or individual clinical rows. Groups of 0–4 have the same withheld-count representation. A multi-condition patient may appear in multiple groups; group counts must not be added as a unique-patient total.
- Dates select the latest condition review timestamp in UTC. This is a current profile snapshot, not a historical diagnosis register or a measure of population disease prevalence.
- No locality/address is collected by this update, so area-wise disease analysis is not provided. Reports do not authorize AI model training. The new records are not added to the existing external AI prompt.
- The patient's existing verified personal-data export includes their clinic condition profile. Account closure also withdraws condition analytics permission while retaining clinical records under the existing retention workflow.

### Run locally

Keep your existing server/client `.env` configuration. No database deletion, reseeding, migration or new dependency is required. Restart the server and client after replacing the source.

Server, from the project root in one terminal:

```bash
cd server
npm ci
npm run dev
```

Client, in a second terminal from the project root:

```bash
cd client
npm ci
npm run dev
```

For a production client build, the existing Vite guard still requires your real HTTPS backend configuration:

```dotenv
VITE_API_URL=https://YOUR-BACKEND/api
VITE_SOCKET_URL=https://YOUR-BACKEND
```

Then run `npm run build` in `client`. Verification here used non-routable HTTPS placeholders only to check compilation, not a deployed backend.

### Verification results

| Check | Result |
|---|---|
| Client privacy/session/localization suite | 34 passed |
| Client appearance + new condition UI/auth/localization checks | 6 passed |
| Client production build | Passed; existing large-chunk warning remains |
| Server default unit/API suite, including 5 new condition checks | 143 passed |
| Server privacy suites | 44 passed |
| Server HTTP/realtime audit suite | 18 passed |
| Source/import check | Passed |
| Disposable MongoDB integration suites | Attempted; blocked at database startup by environment `Operation not permitted` (exit 100); not verified |
| Browser viewport/interaction checks | Not completed: browser runtime unavailable and browser download failed |

The new condition API tests use mocked model boundaries. They check authentication, assigned-doctor access, pending/confirmed transitions, revision conflicts, report filters and suppressed exports. The separate disposable-database test file covers actual persistence, clinic isolation, simultaneous saves, consent withdrawal and personal export, but its assertions could not execute in this environment.

To run the database gate on a machine that can start MongoDB Memory Server, use `npm run test:integration` in `server`. It creates a disposable replica set and never uses your `MONGO_URI`. New client checks can be repeated with `node --test test/healthConditions.test.mjs` in `client`.

### Changed files

- `client/src/App.jsx`
- `client/src/locales/en-hi.json`
- `client/src/HealthConditions.jsx` (new)
- `client/src/health-conditions.css` (new)
- `client/test/healthConditions.test.mjs` (new)
- `server/src/models/Patient.js`
- `server/src/routes/patientRoutes.js`
- `server/src/routes/tokenRoutes.js`
- `server/src/routes/adminRoutes.js`
- `server/src/routes/healthConditionHandlers.js` (new)
- `server/src/services/healthConditions.js` (new)
- `server/src/services/privacyExportService.js`
- `server/src/services/privacyClosureService.js`
- `server/test/healthConditions.test.js` (new)
- `server/test/integration/healthConditions.test.js` (new)
- `README.md`
- `SECURITY_REVIEW.md`

Existing landing page, floating chatbot, notification navigation, role workspaces, business APIs and Socket.IO event names are preserved. Styling additions are scoped to the new condition panels, with small-screen wrapping, keyboard/native controls, existing design tokens and English/Hindi labels.


### Integration-test initialization correction — 2 October 2026

The Windows run supplied by the operator passed all 23 database assertions, including the five new condition tests, but failed the health-condition test file with post-teardown `MongoNotConnectedError` activity attributed to its `before` hook. This is still a failed suite, not a fully green integration result.

The condition test now imports all application models and awaits their `model.init()` promises before inserting fixtures or serving requests. Previously, automatic collection/index initialization from late model imports could remain pending when the suite disconnected. This correction changes test setup only; it does not alter production application behaviour.

Repeat in `server`:

```bash
node --test test/integration/healthConditions.test.js
npm run test:integration
```

Expected: the standalone file has 5 passing tests, and the combined integration run has 23 passing tests, with no post-test asynchronous error. The corrected database run remains unverified here because the disposable MongoDB binary cannot start in this environment.

If the client build reports “Set VITE_API_URL and VITE_SOCKET_URL to your HTTPS backend before building”, configure `client/.env.production` with the actual deployed HTTPS backend API and Socket.IO origins. A localhost/HTTP development configuration does not meet the production guard. `npm run dev` remains the command for normal local testing. Do not replace real deployment settings with dummy URLs for release.


## Security re-audit — 2 October 2026

The health-condition edition has been reviewed again with focused security checks. The client lockfile now resolves Axios 1.20.0. Background incident-alert failures are caught safely, condition writes bind to the loaded revision, and condition/EHR reads use existing sensitive-access logging. UI, endpoints and database records are preserved. No reseed or migration is required.

Current results: client 40 passed, server 208 passed; production client build passes; both registry audits report zero advisories. A new local Mongo integration attempt is blocked by this execution environment. Rerun `npm run test:integration` locally before deploying the final fixes. See SECURITY_REVIEW.md for scope, commands and limitations; CHANGED_FILES_SINCE_LAST_SECURITY_AUDIT.md lists the exact comparison with the previous audited ZIP. Preserve private `.env` files and use actual HTTPS production backend URLs when building.
