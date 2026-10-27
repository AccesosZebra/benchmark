# Multi-stage build for React + Vite application

# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Servidor Node (SPA + API /api con Postgres)
FROM node:22-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Solo dependencias de producción (pg para el servidor)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and server
COPY --from=builder /app/dist /app/dist
COPY server /app/server

# Copy and setup entrypoint script for runtime env injection
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 80
EXPOSE 80

# Health check using curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl --fail http://localhost/health || exit 1

# Use entrypoint script to inject runtime env vars
ENTRYPOINT ["/docker-entrypoint.sh"]
