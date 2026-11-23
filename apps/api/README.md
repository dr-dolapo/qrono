# @qrono/api

The Cloudflare Worker that serves the Qrono API to the web app and the mobile app.

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
| `GET /api/teams/:id/members` | Everyone on the team; Approvers/Admins also see join requests |
| `PATCH /api/teams/:id/members/:mid` | QR009: change role |
| `POST /api/teams/:id/members/:mid/approve` | QR001: let in someone who used the invite link |
| `DELETE /api/teams/:id/members/:mid` | Remove someone, decline a request, or leave |
| `GET/POST /api/teams/:id/invites`, `DELETE …/invites/:iid` | QR007: email invitations (7 days) |
| `POST /api/teams/:id/invite-link` | QR001: shareable link (30 days; joiners wait for approval) |
| `GET /api/invites/:token`, `POST /api/invites/:token/accept` | Invite landing page and joining |

| `GET/POST /api/teams/:id/events` | QR019 / QR022: list events, create a draft |
| `GET/PATCH/DELETE /api/events/:eid` | QR020: view, edit or delete a draft |
| `POST/PATCH/DELETE /api/events/:eid/stages[/:sid]` | Stages (halls) |
| `POST/PATCH/DELETE /api/events/:eid/tasks[/:tid]`, `PUT …/tasks/order` | Agenda tasks, assignees and order |
| `POST/DELETE /api/events/:eid/participants[/:pid]` | QR021: team members and guests |

| `POST /api/events/:eid/submit` | QR011: send to chosen Approvers (locks the plan) |
| `POST /api/events/:eid/withdraw` | Back to draft for changes |
| `POST /api/events/:eid/approve` | QR016–QR018: a chosen Approver approves; Admins, members and guests are emailed |
| `POST /api/events/:eid/tasks/:tid/comments`, `DELETE …/comments/:cid` | QR012–QR015: task comments (soft delete) |
| `POST /api/events/:eid/response` | QR033–QR035: confirm or decline (with a reason) |
| `GET /api/guest/:token`, `POST /api/guest/:token/response` | QR044–QR046: guest's personal link; expires when the event ends |

| `GET /api/events/:eid/live` (WebSocket) | The live room: every screen gets the full state on each change |
| `POST /api/events/:eid/live/start\|next\|end` | QR028 / QR029: Approvers and Admins run the event |

Live events (`src/live/`): the `LiveEvent` Durable Object is the event's live room. It holds the WebSockets and uses an alarm to wake exactly when something is due: going live at the start time, handing over automatically in auto mode (QR027), and ending at the end time. The state machine itself (`live/engine.ts`) is plain code over D1, so it's unit-tested without Cloudflare.

| `GET/POST /api/events/:eid/broadcasts` | QR038 / QR039 / QR042: send to everyone or chosen people (live only); see replies |
| `POST /api/events/:eid/broadcasts/:bid/respond` | QR041: Acknowledge, Snooze (back after 3 minutes) or Done |

Agenda timing (`src/events/schedule.ts`): tasks run in agenda order. A task on a stage runs after the previous task on that stage, so stages run side by side. A task for "all stages" waits for every stage to finish, so breakouts can split off and come back together. Start times are recomputed and stored after every change.

Team rules:
- Approvers and Admins can invite, approve, change roles and remove people.
- Only an Approver can make someone an Approver, or change or remove an Approver.
- A team always keeps at least one Approver.
- An email invitation can only be accepted by that email's account.

- Passwords are hashed with PBKDF2-SHA256 (100k iterations, random salt).
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on https), valid for 30 days. Only their SHA-256 hashes are stored.
- Requests that change data must come from `APP_ORIGIN` and be JSON (CSRF protection).
- Accounts must confirm their email before creating a team.
- Repeated attempts are limited (`src/auth/limits.ts`, counters in D1):
  - 5 wrong passwords for an email pause logging in to it for 15 minutes, even with the right password. A successful login clears the count, and a password reset lifts the pause.
  - 100 wrong passwords from one network address in 15 minutes pause that address, which stops attackers trying many accounts. The limit is generous because many people can share one address (mobile networks, office Wi-Fi).
  - Each address can get at most 5 reset emails an hour, each account 5 verification emails an hour, and each network address 100 sign-ups an hour.
  - The limits behave the same whether or not an account exists, so they can't be used to find accounts.

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
