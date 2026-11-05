# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy contracts first
COPY jira-contracts /jira-contracts
WORKDIR /jira-contracts
RUN npm ci && npm run build

WORKDIR /app
COPY jira-bff/package*.json ./
RUN npm ci

COPY jira-bff/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY jira-contracts /jira-contracts
COPY jira-bff/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/main"]
