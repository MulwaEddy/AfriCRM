# ==============================================================================
# AfriCRM — Production Multi-Stage Dockerfile (v1.0.0-PROD)
# Mobile-First Sales CRM for African SMEs
# ==============================================================================

# Stage 1: Build & Dependencies
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Security: Non-root user
USER node

# Copy dependencies and application source
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/auth/me || exit 1

CMD ["node", "server.js"]
