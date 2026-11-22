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

In local development, emails (verification and password-reset links) are
**printed in the `wrangler dev` console** instead of being sent. Copy the link
from there.

## Auth

| Endpoint | Story |
|---|---|
| `POST /api/auth/signup` | QR002: creates the account, signs in, emails a verification link |
| `POST /api/auth/verify-email` | QR003 |
| `POST /api/auth/resend-verification` | QR003 |
| `POST /api/auth/login` / `POST /api/auth/logout` | QR004 |
| `GET /api/auth/me` | The signed-in user and their teams |
| `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` | QR005: a reset logs out every device |
| `POST /api/teams` / `GET /api/teams` | QR006 / QR010: the creator becomes the team's Approver |

- Passwords are hashed with PBKDF2-SHA256 (100k iterations, random salt).
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on https), valid for 30 days. Only their SHA-256 hashes are stored.
- Requests that change data must come from `APP_ORIGIN` and be JSON (CSRF protection).
- Accounts must confirm their email before creating a team.

## First deploy (once per Cloudflare account)

```bash
npx wrangler login
npx wrangler d1 create qrono-db   # paste the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

For production, set these in `wrangler.jsonc` (or a production environment there):

| Variable | Production value |
|---|---|
| `APP_ORIGIN` | The web app's URL, e.g. `https://app.yourdomain.com` |
| `EMAIL_MODE` | `send` |
| `MAIL_FROM` | e.g. `Qrono <no-reply@yourdomain.com>`. The domain must be onboarded to Cloudflare Email Service (needs the Workers paid plan). |

## Schema changes

Never edit a migration that has already been applied. Add a new file,
e.g. `migrations/0002_<what_changed>.sql`, then run the migrate command.
