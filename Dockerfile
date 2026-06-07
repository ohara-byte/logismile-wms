# =====================================================================
# LogiSmile WMS 本番イメージ（Xserver VPS / Caddy リバプロ配下）
#   - コンテナ内部は 3000 番で待受 → compose 側で 127.0.0.1:3001 に公開
#   - Prisma は schema.prisma の binaryTargets に debian-openssl-3.0.x が必要
#   - node:20-bookworm-slim = Debian 12 / OpenSSL 3.x
# =====================================================================

# ---- deps: 依存インストール（キャッシュ層） -------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# Prisma エンジンは libssl/openssl を要求する
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: Prisma generate + next build -------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Linux 向けクエリエンジンを含む Prisma Client を生成
RUN npx prisma generate
# 本番ビルド（next.config.js の cpus:1 はWindows対策。Linuxでも無害）
RUN npm run build

# ---- runner: 実行（next start + 起動時マイグレーション） -----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# 起動時の prisma migrate deploy / Prisma エンジンに openssl が必要
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# 実行に必要なものだけ builder からコピー
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
# 起動時に未適用マイグレーションを適用してから Next を起動。
#   -H 0.0.0.0 はコンテナ内バインド（ホスト公開は compose 側で 127.0.0.1:3001 に限定）
CMD ["sh", "-c", "npx prisma migrate deploy && node_modules/.bin/next start -p 3000 -H 0.0.0.0"]
