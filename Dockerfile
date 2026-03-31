# Stage 1: Build Go sidecar and driver plugins
FROM golang:1.26-alpine AS sidecar-builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /build
COPY sidecar/go.mod sidecar/go.sum ./
RUN go mod download
COPY sidecar/ ./
RUN mkdir -p bin && \
    CGO_ENABLED=1 go build -ldflags="-s -w" -o bin/omnibase-sidecar . && \
    for driver in sqlite3 postgres mysql sqlserver; do \
      CGO_ENABLED=1 go build -ldflags="-s -w" -o bin/driver-${driver}-linux-amd64 ./drivers/${driver}/; \
    done && \
    cp drivers.json bin/

# Stage 2: Build TypeScript
FROM node:22-alpine AS ts-builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm exec tsc

# Stage 3: Runtime
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Copy built artifacts
COPY --from=sidecar-builder /build/bin/ ./sidecar/bin/
COPY --from=ts-builder /build/dist/ ./dist/
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

ENV OMNIBASE_DRIVERS_PATH=/app/sidecar/bin

ENTRYPOINT ["node", "dist/src/index.js"]
