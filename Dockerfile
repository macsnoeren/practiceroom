# API server + composite worker (one image, two commands).
# Build context is the repository root.
FROM node:22-bookworm-slim

# openssl is required by Prisma's query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all workspace dependencies (server postinstall generates the Prisma
# client; on Linux this also pulls the matching @ffmpeg-installer binary).
COPY . .
RUN npm ci
RUN npm run build -w shared && npm run build -w server

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Apply migrations to the (volume-mounted) database, then start the API.
# The worker service overrides the command (see docker-compose.yml).
CMD ["sh", "-c", "npx prisma migrate deploy --schema server/prisma/schema.prisma && node server/dist/index.js"]
