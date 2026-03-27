# Stage 1: Build Go sidecar
FROM golang:1.26-alpine AS sidecar-builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /build
COPY sidecar/go.mod sidecar/go.sum ./
RUN go mod download
COPY sidecar/*.go ./
RUN CGO_ENABLED=1 go build -o omnibase-sidecar .

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
COPY --from=sidecar-builder /build/omnibase-sidecar ./sidecar/omnibase-sidecar
COPY --from=ts-builder /build/dist/ ./dist/
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

ENTRYPOINT ["node", "dist/src/index.js"]
