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
- **Fase 3** — realtime (Socket.IO): geauthenticeerde verbindingen (cookie voor
  staff, device-token voor camera's), presence per school (live online/offline in
  het dashboard) en een besturingskanaal (start/stop-opname) met school-isolatie
  - tests. ✅
- **Fase 4** — planning: lessen (leraar + student + tijd + status), camera-selectie
  per les, lesmateriaal (link/notitie); agenda voor leraar/admin en read-only
  overzicht voor de student (alleen eigen lessen) + tests. ✅
- **Fase 5** — opnemen & uploaden: leraar start/stopt de opname (REST → WSS-commando
  naar online camera's), de camera neemt op met `MediaRecorder` en uploadt
  hervatbare chunks; de server plakt ze in volgorde tot één `.webm` per camera.
  Status `planned → recording → recorded` + tests (chunk-upload, hervatten,
  bestandsvalidatie, auth). ✅
- **Fase 6** — terugkijken: ondertekende, vervallende afspeel-URL's + streaming
  met Range-support; videospeler in dashboard en bij de student, met schakelen
  tussen camerahoeken. Een gekopieerde link werkt niet voor een niet-deelnemer en
  verloopt. + tests. ✅
- **Fase 7** — één lesvideo: per les neemt **één camera tegelijk** op (een andere
  starten stopt de vorige) → segmenten. Een aparte **worker** (`npm run worker`)
  voegt de segmenten met ffmpeg in de tijd samen tot **één video per les**. + tests
  (incl. echte ffmpeg-concat). ✅
- **Fase 8** — beveiliging & uitrol: security headers (helmet), productie-secret-
  bewaking, HTTPS-only cookies, audit-logging, en een **Docker-uitrol**
  (API + worker + twee statische SPA's met SPA-fallback). ✅

## Productie (Docker)

> Lokaal ontwikkelen blijft `npm run dev`. De Docker-stack is voor productie/uitrol.

```bash
cp .env.example .env        # zet een sterke SIGNING_SECRET en de juiste CORS_ORIGIN
docker compose up -d --build
```

- Dashboard op `http://<host>:8080`, camera-app op `http://<host>:8081`.
- Services: `server` (API), `worker` (ffmpeg-samenvoegen), `web` + `camera`
  (nginx, serveren de SPA's en proxyen `/api` + `/socket.io` naar de server).
- Data (SQLite + video's) staat in het `appdata`-volume; migraties draaien bij
  het opstarten van de server.
- **Draai dit achter HTTPS** (cookies zijn standaard `Secure`). Voor een snelle
  lokale HTTP-test: `COOKIE_SECURE=false` in `.env`.

## Beveiliging

- HTTPS/WSS in productie; httpOnly + `SameSite=lax` (+ `Secure`) sessie-cookies.
- Wachtwoorden met **argon2id**; sessies serverside; device-tokens alleen als hash.
- **Tenant-isolatie**: elke query gefilterd op de school van de gebruiker.
- Security headers via **helmet**; rate-limiting (strenger op login/koppelen).
- Ondertekende, vervallende video-URL's + per-verzoek deelnemer-check.
- De server **weigert te starten** in productie met de standaard `SIGNING_SECRET`.
- Audit-logregels (veld `audit`) voor login, account- en device-wijzigingen.

### Eén lesvideo (fase 7)

- Opname per camera: `POST /api/lessons/:id/recording/start` `{ deviceId }`
  (stopt automatisch de lopende camera), `…/stop`, `…/finish` (sluit af + zet de
  samenvoeg-taak in de wachtrij).
- **Worker** (`server/src/worker/`, los proces): pollt `CompositeVideo`-taken en
  draait ffmpeg-concat → `server/storage/composites/<lesId>.mp4`. ffmpeg via
  `@ffmpeg-installer/ffmpeg`; overschrijf met `FFMPEG_PATH` (bijv. Docker/systeem).
- Afspelen: `GET /api/lessons/:id/composite/playback-url` + `…/composite/stream`.

### Terugkijken (fase 6)

- `GET /api/recordings/:id/playback-url` — (deelnemer) korte, ondertekende URL.
- `GET /api/recordings/:id/stream?expires&sig` — streamt de video; vereist een
  geldige (niet-verlopen) handtekening én dat de ingelogde gebruiker de les mag
  zien. Ondersteunt `Range` voor zoeken. `SIGNING_SECRET` ondertekent de URL's.

### Opnemen (fase 5)

- `POST /api/lessons/:id/recording/start|stop` — (staff) start/stop; start maakt
  per online geselecteerde camera een `Recording` en commandeert die via WSS.
- `POST /api/recordings/:id/chunks?index=N` — (camera, `application/octet-stream`)
  volgende chunk; idempotent, een gat geeft 409 met de verwachte index.
- `POST /api/recordings/:id/complete` — (camera) opname afronden.
- `GET  /api/recordings/:id` — (camera) voortgang om te hervatten.

Video's worden lokaal opgeslagen onder `STORAGE_DIR` (standaard `server/storage/`).

### Lessen (fase 4)

Rol-scoping: admin beheert alle lessen in de school, een leraar alleen de eigen
lessen, een student ziet/leest alleen zijn eigen lessen.

- `GET/POST /api/lessons`, `GET/PATCH/DELETE /api/lessons/:id`
- `PUT /api/lessons/:id/devices` — camera's selecteren (alleen eigen-school-apparaten)
- `POST/DELETE /api/lessons/:id/materials[/:materialId]` — lesmateriaal

### Herhaling & vakanties

- Bij het plannen kun je een les **wekelijks herhalen** (`repeatWeeks`); elke week
  wordt een eigen les, gekoppeld als reeks (`seriesId`). `DELETE /api/lessons/:id?series=true`
  verwijdert de hele reeks.
- **Vakanties** (`/api/holidays`, beheerder): herhalende lessen slaan vakantieweken
  automatisch over. Studenten zien de vakanties bij hun planning.

### Realtime (fase 3)

WebSocket op dezelfde server (`/socket.io`). De camera-app verbindt met haar
device-token (`auth.deviceToken`), het dashboard met de sessie-cookie. Iedereen
zit in een room per school. Presence-events: `presence:snapshot`,
`device:online`, `device:offline`. Besturing: `recording:start` / `recording:stop`
(staff → alleen eigen-school-camera's), `status:update` (camera → staff als
`device:status`).
