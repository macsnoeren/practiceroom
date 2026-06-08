# Build the camera SPA and serve it with nginx (build context = repo root).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
RUN npm run build -w shared && npm run build -w camera

FROM nginx:1.27-alpine
COPY camera/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/camera/dist /usr/share/nginx/html
