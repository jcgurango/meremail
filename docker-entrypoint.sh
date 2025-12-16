#!/bin/sh
set -e

echo "MereMail starting..."

# Ensure data directory exists
mkdir -p /app/data

# Run database migrations
echo "Running database migrations..."
pnpm db:migrate

# Start the server
echo "Starting server..."
exec pnpm start
