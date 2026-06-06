# PracticeRoom

Real-time webapplicatie voor muziekscholen: leraren nemen lessen op via verbonden
camera's/microfoons, studenten kijken de les later terug om effectiever te oefenen.

## Architectuur (kort)

- **Opnemen, niet live-streamen.** De camera-app neemt lokaal op (`MediaRecorder`) en
  uploadt via HTTPS. WebSockets dienen alleen voor besturing/status/presence.
- **Monorepo** met npm-workspaces:
  - `shared/` — gedeelde types en zod-schema's (één bron van waarheid voor de client⇄server-contracten).
  - `server/` — Fastify-API + (later) Socket.IO + Prisma (SQLite).
  - `web/` — React + Vite app voor admin/leraar/student.
  - `camera/` — (volgt in fase 2) React + Vite camera-app.

## Vereisten

- Node.js >= 20 (getest met 24).
- Geen Docker/PostgreSQL nodig: de database is SQLite (bestand `server/prisma/dev.db`).

## Aan de slag

```bash
npm install            # installeert alle workspaces + genereert de Prisma-client
npm run dev            # start server (:3000) en web (:5173) tegelijk
```

Open http://localhost:5173 — de pagina toont of de verbinding met de server werkt.

## Handige scripts

```bash
npm run typecheck      # TypeScript-controle over alle workspaces
npm run lint           # ESLint
npm run format         # Prettier (schrijft)
npm run build          # productie-build van alle workspaces
```

## Status

Fase 0 (fundament) is opgezet. Volgende fases: auth & rollen, camera-apparaten,
websockets, planning, opnemen/uploaden, terugkijken, samengevoegde rastervideo,
beveiliging/uitrol. Zie het projectplan.
