# tts-api-service — multi-stage build.
# The SAME image runs both the API and the worker; docker-compose overrides the
# command (node dist/index.js vs node dist/worker.js). This service NEVER loads
# the AI model — it only calls the model server over HTTP (MODEL_SERVER_URL).

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app

# OpenSSL is required by Prisma engines.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# --ignore-scripts skips the `postinstall: prisma generate` hook here — the
# schema isn't copied yet. We copy it next and generate the client explicitly.
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# --ignore-scripts: the Prisma CLI is a devDependency (omitted here), so the
# postinstall hook can't run. The generated client is copied from the build stage.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Run as non-root.
USER node

# Default command runs the API; the worker service overrides this in compose.
CMD ["node", "dist/index.js"]
