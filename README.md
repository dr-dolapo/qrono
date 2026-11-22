# Qrono

Qrono is a collaborative program manager for live, multi-actor events. It keeps the agenda in sync and the event free of dead air.

The full product spec is in [`docs/PRD.md`](docs/PRD.md).

## Repository layout

```
qrono/
├── apps/
│   ├── api/      Cloudflare Worker API, D1 database and live-event Durable Object
│   ├── web/      React + Vite web app: command centre, admin screens, guest view
│   └── mobile/   Flutter participant app for iOS and Android
└── docs/
    └── PRD.md    Product requirements
```

| Surface | Tech | Who uses it |
|---|---|---|
| Mobile app | Flutter | Participants during an event, and Approvers approving on the go |
| Web app | React + Vite, served from Cloudflare Workers | Admins and Approvers: create and edit events, manage the team, run the command centre on an HDMI screen |
| Guest view | Same web app, opened on a phone browser | Guest speakers with a personal link (no app download needed) |
| API | Cloudflare Workers + D1 + Durable Objects + Queues | Everything above |

## Getting started

Requirements: **Node 20+**, and **Flutter 3.x** for the mobile app.

```bash
npm install                 # installs api + web dependencies

# API (http://localhost:8787)
npm run db:migrate:local -w apps/api   # create the local D1 database
npm run dev:api

# Web (http://localhost:5173, proxies /api to the Worker)
npm run dev:web
```

Mobile: see [`apps/mobile/README.md`](apps/mobile/README.md).

## Checks

```bash
npm run typecheck
npm test
```
