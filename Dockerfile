FROM node:25-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git python3 make g++ cmake \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm typescript tsc-alias

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/bot/package.json ./apps/bot/

RUN pnpm install --frozen-lockfile

COPY apps/bot ./apps/bot

RUN cd /app/apps/bot && tsc && tsc-alias

FROM node:25-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/apps/bot/dist ./dist
COPY --from=builder /app/apps/bot/package.json ./
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "dist/main.js"]