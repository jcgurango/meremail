# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache libstdc++

# Copy built application
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./

# Copy CLI tools and their dependencies
COPY --from=builder /app/server/cli ./server/cli
COPY --from=builder /app/server/services ./server/services
COPY --from=builder /app/server/db ./server/db
COPY --from=builder /app/server/config.ts ./server/config.ts
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/node_modules ./node_modules

# Create data directories
RUN mkdir -p /app/data/attachments /app/data/uploads /app/data/backups

# Environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/meremail.db
ENV ATTACHMENTS_PATH=/app/data/attachments
ENV UPLOADS_PATH=/app/data/uploads

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Run migrations then start the application
CMD ["sh", "-c", "yarn db:migrate && node .output/server/index.mjs"]
