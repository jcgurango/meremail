# Stage 1: Install dependencies (including native modules)
FROM node:22-alpine AS deps

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build the web frontend
FROM deps AS build

# Copy source code
COPY . .

# Build web frontend (includes vue-tsc type check)
RUN pnpm -F @meremail/web build

# Stage 3: Production runtime
FROM node:22-alpine AS runtime

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Copy node_modules from deps stage (includes native modules built for alpine)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules

# Copy source code (server runs TypeScript directly via tsx)
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/drizzle.config.ts ./packages/shared/
COPY packages/server/src ./packages/server/src

# Copy built web frontend
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Run entrypoint (runs migrations then starts server)
ENTRYPOINT ["./docker-entrypoint.sh"]
