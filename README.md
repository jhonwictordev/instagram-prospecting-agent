# Instagram Prospecting Agent

> See the [portfolio overview](docs/portfolio-overview.md) for architecture, approval flow and public demonstration boundaries.

A conservative, locally run automation for finding public business profiles, qualifying them, and preparing messages. Sending is blocked by default. This project does not solve CAPTCHAs, use stealth/proxies, or bypass Instagram limits or interventions. Review Instagram's Terms and applicable laws (including data-protection regulations) before using it.

## Safe demonstration and review interface

- Open `http://localhost:3001/review?demo=1` for a synthetic, read-only demonstration. It uses fictional profiles and never requires an Instagram account, database, API key, or browser session.
- Open `http://localhost:3001/review` for the real local review queue. Enter the worker API key, inspect each profile and exact message, and approve one item at a time.
- The same screen can activate or release the runtime emergency stop immediately. Restarting the worker is no longer required.

## Requirements

- Windows 10/11, Node.js 22.13+, and Brave installed.
- Docker Desktop with WSL 2 for PostgreSQL and n8n.
- An Instagram account accessed manually. Never put a username, password, or cookies in `.env`.

## Installation

In PowerShell:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run typecheck
npm.cmd test
docker compose up -d postgres n8n
```

Edit `.env` and make sure to replace `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, and `BROWSER_WORKER_API_KEY` (minimum 16 characters). For example, generate secrets with `[guid]::NewGuid().ToString('N')`.

### Option A — recommended on Windows

Run PostgreSQL and n8n in Docker and run browser-worker on Windows, allowing it to open the graphical Brave browser:

```powershell
docker compose up -d postgres n8n
npm.cmd -w @ipa/browser-worker run dev
Invoke-RestMethod http://localhost:3001/health
```

n8n uses `http://host.docker.internal:3001`. If Brave is not detected, configure `BRAVE_EXECUTABLE_PATH`. `BRAVE_USER_DATA_DIR` must point to a dedicated, persistent profile; do not use your main personal profile.

### Option B — worker in a container

Use this only on a Linux host with an available browser and suitable graphical configuration; the Linux container cannot open Brave installed on Windows. For compatible headless execution:

```powershell
docker compose --profile worker up -d --build
```

The Dockerfile does not install Brave. Mount or install a compatible executable and configure `BRAVE_EXECUTABLE_PATH`; for the initial graphical login, prefer Option A.

## Manual login

With the worker running:

```powershell
$headers = @{ Authorization = "Bearer $((Get-Content .env | Select-String '^BROWSER_WORKER_API_KEY=').Line.Split('=')[1])" }
Invoke-RestMethod -Method Post -Uri http://localhost:3001/session/open -Headers $headers
```

Log in manually through Brave. Then check `/session/status`. A CAPTCHA, checkpoint, unusual activity warning, or block returns `platform_intervention_required` and requires the process to stop for human action.

## n8n and workflows

Open `http://localhost:5678`, create the PostgreSQL credentials (`host=postgres`, using the database, username, and password from `.env`), and import these files in order:

1. `n8n/workflows/error-handler.json`;
2. `n8n/workflows/instagram-prospecting.json`.

Replace the credential placeholders, save the error workflow, copy its ID, and configure it as the main workflow's error workflow. Configure the placeholder Telegram credential or replace that node with email. Activate the workflow and call the webhook shown by n8n.

Safe example:

```powershell
$body = @{
  niche='real estate'; location='Maceio'; additionalTerms=@('real estate Maceio')
  message='Hello {{displayName}}, I work with solutions for {{niche}} businesses in {{location}}.'
  maximumContacts=5; minimumDelaySeconds=90; maximumDelaySeconds=240
  allowedStart='09:00'; allowedEnd='18:00'; executionMode='approval'
  excludedKeywords=@('personal','fan club'); dryRun=$true
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5678/webhook/instagram-prospecting -ContentType application/json -Body $body
```

The main workflow contains 32 nodes and implements validation, campaign and execution management, session verification, search combinations, deduplication, blocklist checks, sequential processing, classification, personalization, operating windows, randomized waits, message preparation or sending, and reporting. Instagram requests are attempted up to three times; any platform alert stops execution.

The error workflow's Telegram node is a disabled placeholder. After creating a real credential and setting the chat, enable the `Notify Telegram (placeholder)` node. PostgreSQL error logging works independently of the notification.

## Modes and interruption

- `dryRun=true`: never sends messages.
- `approval` (default): the workflow calls `/message/prepare`, records the message, and returns `status=awaiting_approval`, along with an `outreachMessageId` and an `approvalToken` for each item. Nothing is sent at this stage.
- `automatic`: simultaneously requires `AUTOMATIC_MODE_ENABLED=true`, `dryRun=false`, and no emergency stop.
- Emergency stop: initialize it with `EMERGENCY_STOP=true`, or toggle it immediately from `/review`. New sends and approvals are refused while active.

The default limits are 10 contacts, an absolute maximum of 20, and a 90–240 second interval. A database index permits only one `running` execution. URLs/usernames, campaign+prospect, and prospect+message have uniqueness constraints. The `blocklist` table is permanent.

### Explicit human approval

In Brave, review the filled-in text and the fields returned in `approvals`. To approve a specific item, call the protected local endpoint. The token must match the prepared message ID:

```powershell
$headers = @{ Authorization = "Bearer $((Get-Content .env | Select-String '^BROWSER_WORKER_API_KEY=').Line.Split('=')[1])" }
$approval = @{
  outreachMessageId = 'UUID_RETURNED_BY_THE_WORKFLOW'
  approvalToken = 'UUID_RETURNED_BY_THE_WORKFLOW'
  approved = $true
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3001/message/approve -Headers $headers -ContentType application/json -Body $approval
```

The endpoint accepts only messages previously recorded as `prepared`, honors `EMERGENCY_STOP`, checks again whether an identical message already exists in the conversation, and updates the database after sending. Do not reuse tokens or approve messages without reviewing the profile and content.

## Useful queries

```powershell
docker compose exec postgres psql -U prospecting -d instagram_prospecting -c "select * from executions order by started_at desc;"
docker compose exec postgres psql -U prospecting -d instagram_prospecting -c "select username,qualification_status,do_not_contact from prospects;"
docker compose exec postgres psql -U prospecting -d instagram_prospecting -c "insert into blocklist(username,reason) values ('profile','deletion request');"
```

## Selectors and diagnostics

All selectors are stored in `apps/browser-worker/src/instagram/selectors.ts`, with Portuguese and English alternatives. When the composer fails, the worker saves a local screenshot with the message field masked in `storage/diagnostics`; review and delete images after troubleshooting. Never send them automatically.

## Development and testing

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Tests use mocks and do not access real accounts. They cover validation and limits, deduplication, personalization, blocklists, error counting, authentication, dry-run mode, approval, and automatic-mode blocking.

## Troubleshooting

- `Brave not found`: set the absolute path in `BRAVE_EXECUTABLE_PATH`.
- `LOGIN_REQUIRED`: call `/session/open` and log in manually.
- `401 UNAUTHORIZED`: confirm that the same `BROWSER_WORKER_API_KEY` is configured in both the worker and n8n.
- n8n cannot reach the worker: keep `BROWSER_WORKER_URL=http://host.docker.internal:3001`.
- Migration was not reapplied: initialization scripts run only with a new PostgreSQL volume; apply the SQL manually to existing databases.
- Selector failed: check `storage/diagnostics`, update only `selectors.ts`, and run the tests.
- `platform_intervention_required`: stop and resolve the issue manually in the browser. Do not automate a bypass.
- n8n takes a long time to start: on computers with few CPU cores, wait for the `Activated workflow` log before calling the webhook; `/healthz` may respond shortly before the route is registered.

## Known limitations

Instagram changes its interface and selectors without notice; extraction is heuristic and does not use the official API. Follower counts, category, and location may be unavailable. The review interface controls the local REST API; it is not embedded in n8n. Runtime emergency-stop state is intentionally process-local and resets to the `.env` value after a restart. The application does not guarantee legal compliance or permission to send messages; the operator is responsible for both.
