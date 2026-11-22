# @qrono/api

The Cloudflare Worker that serves the Qrono API to the web app and the Flutter app.

| Piece | Where |
|---|---|
| HTTP routes (Hono) | `src/app.ts` |
| Live event room (Durable Object, WebSockets) | `src/live-event.ts` |
| Database schema (D1) | `migrations/` (based on PRD section 10) |
| Tests | `test/` |

## Local development

```bash
npm install                       # from the repo root
npm run db:migrate:local          # create the local D1 database
npm run dev                       # http://localhost:8787/api/health
```

The live-event socket is at `ws://localhost:8787/api/events/<eventId>/live`.

## First deploy (once per Cloudflare account)

```bash
npx wrangler login
npx wrangler d1 create qrono-db   # paste the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

## Schema changes

Never edit a migration that has already been applied. Add a new file,
e.g. `migrations/0002_<what_changed>.sql`, then run the migrate command.
