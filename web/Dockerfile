# Build the dashboard SPA and serve it with nginx (build context = repo root).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
RUN npm run build -w shared && npm run build -w web

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
