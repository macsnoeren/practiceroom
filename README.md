# PracticeRoom

Real-time webapplicatie voor muziekscholen: leraren nemen lessen op via verbonden
camera's/microfoons, studenten kijken de les later terug om effectiever te oefenen.

## Architectuur (kort)

- **Opnemen, niet live-streamen.** De camera-app neemt lokaal op (`MediaRecorder`) en
  uploadt via HTTPS. WebSockets dienen alleen voor besturing/status/presence.
- **Monorepo** met npm-workspaces:
  - `shared/` — gedeelde types en zod-schema's (één bron van waarheid voor de client⇄server-contracten).
  - `server/` — Fastify-API + (later) Socket.IO + Prisma (SQLite).
  - `web/` — React + Vite app voor admin/leraar/student (poort 5173).
  - `camera/` — React + Vite camera-app: koppelt met een code en toont camera/microfoon (poort 5174).

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

## API (fase 1)

Auth via httpOnly sessie-cookie; wachtwoorden met argon2id. Tenant-isolatie: elke
query is gefilterd op de school van de ingelogde gebruiker.

- `POST /api/auth/register-school` — maak school + eerste admin (logt direct in)
- `POST /api/auth/login` — inloggen
- `POST /api/auth/logout` — uitloggen
- `GET  /api/auth/me` — huidige gebruiker
- `POST /api/users` — (admin) leraar/student aanmaken in eigen school
- `GET  /api/users` — (admin/leraar) gebruikers van eigen school

### Apparaten (fase 2)

Beheer via gebruikerssessie; de camera-app authenticeert met een eigen
bearer-token (alleen de hash wordt opgeslagen).

- `POST /api/devices` — (admin/leraar) apparaat registreren → koppelcode
- `GET  /api/devices` — apparaten van eigen school
- `POST /api/devices/:id/pairing-code` — nieuwe koppelcode
- `POST /api/devices/:id/revoke` — koppeling intrekken
- `DELETE /api/devices/:id` — apparaat verwijderen
- `POST /api/devices/pair` — (camera-app) koppelen met code → token
- `GET  /api/devices/me` — (camera-app, bearer) eigen apparaatinfo

```bash
npm run test -w server   # integratietests: tenant-isolatie, auth, device-pairing
```

## Status

- **Fase 0** — fundament (monorepo, TS strict, lint/format, Fastify, Vite, Prisma). ✅
- **Fase 1** — school, login, rollen (admin/leraar/student), tenant-isolatie + tests. ✅
- **Fase 2** — camera-apparaten: registreren + koppelcode, camera-app met
  getUserMedia-preview, device-token-auth + tests. ✅

Volgende fases: websockets (presence/besturing), planning, opnemen/uploaden,
terugkijken, samengevoegde rastervideo, beveiliging/uitrol. Zie het projectplan.
