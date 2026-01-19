# Meeting Decisions and Follow-Ups

Email-first meeting outcomes. Zoom and Google Meet recordings in, decisions and action items out.

## What this does
- Connect Google Calendar and Zoom
- Detect meetings and recordings
- Transcribe audio
- Extract decisions, action items, and follow-up drafts
- Email a single artifact per meeting

## Quickstart
1) Copy env and fill values

```
copy .env.example .env
```

2) Start Postgres + Redis (optional, local dev)

```
docker compose up -d
```

3) Install deps and run migrations

```
npm install
npm run migrate
```

4) Run API + worker

```
npm run dev
npm run worker
```

Optional helper scripts (PowerShell):

```
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
```

## OAuth setup
- Google OAuth scopes: Calendar Readonly, Drive Readonly, User Info
- Zoom OAuth scopes: recording:read, user:read
- Zoom webhook: recording.completed to `/webhooks/zoom`

## Important notes
- Meet recordings are discovered via Google Drive search. A scheduled job is recommended.
- `POST /api/meet/sync` requires `x-internal-key` if `INTERNAL_API_KEY` is set.
- The API sends emails only to the connected user. Follow-ups are drafts, not auto-sent.
- Manual uploads are available at `/upload` and do not require Zoom/Meet.

## Local webhook tunneling (Zoom)
Zoom webhooks require a public URL. You can use ngrok for local dev:

```
powershell -ExecutionPolicy Bypass -File scripts/ngrok.ps1 -Port 3000
```

Update `BASE_URL` to the ngrok URL and set the Zoom webhook to:
`https://<ngrok-subdomain>.ngrok.io/webhooks/zoom`

## Scripts
- `npm run dev` API
- `npm run worker` background jobs
- `npm run migrate` create tables
