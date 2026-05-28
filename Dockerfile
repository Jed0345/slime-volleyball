# Slime Volleyball 2 — Fly.io relay image.
#
# Stage 1 builds the Vite bundle so the relay can also serve a live
# fallback copy of the game. Stage 2 is the slim runtime image.
# The relay listens on PORT (defaults to 8080, which is Fly's internal
# port). To deploy: `fly launch --copy-config` (first time), then
# `fly deploy` on every subsequent push.

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# --ignore-scripts skips the package.json postinstall (which runs
# `npm run build`); we run it explicitly below so failures are visible.
RUN npm install --ignore-scripts
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js ./
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server.js"]
