# Contributing to Omnibase

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 10+
- [Go](https://go.dev/) 1.22+ (for building the sidecar from source)
- [Docker](https://www.docker.com/) (for integration tests against Postgres/MySQL)

## Setup

```bash
git clone https://github.com/itsJeremyMax/omnibase.git
cd omnibase
pnpm install        # installs dependencies, sets up husky hooks, downloads sidecar binary
pnpm run build      # builds TypeScript
pnpm run build:all  # builds TypeScript + Go sidecar (requires Go)
```

## Development workflow

```bash
# Run unit tests (fast, no Docker needed)
pnpm test

# Run Go sidecar tests
cd sidecar && go test ./... -v && cd ..

# Run integration tests (requires Docker)
pnpm run test:docker:up        # start Postgres + MySQL containers
pnpm run test:integration      # run cross-database tests
pnpm run test:docker:down      # tear down containers

# Format code
pnpm run format

# Type check
pnpm run lint
```

## Project structure

```
omnibase/
├── src/                    # TypeScript MCP server
│   ├── index.ts            # Entry point, tool registration, init command
│   ├── types.ts            # Shared types
│   ├── config.ts           # YAML config loading
│   ├── sql-dialect.ts      # Dialect-aware SQL generation (LIMIT vs TOP)
│   ├── sidecar-client.ts   # JSON-RPC client to Go sidecar
│   ├── connection-manager.ts
│   ├── query-analyzer.ts   # SQL classification
│   ├── permission-enforcer.ts
│   ├── output-formatter.ts
│   └── tools/              # One file per MCP tool (13 tools)
├── sidecar/                # Go sidecar (core multiplexer + driver plugins)
│   ├── main.go             # Core sidecar: routes JSON-RPC to driver subprocesses
│   ├── drivers.json        # Manifest mapping DSN schemes to driver binary names
│   ├── build-drivers.sh    # Build script for all driver plugins
│   ├── driverplugin/       # Shared package: protocol types, handlers, ConnectionManager
│   ├── driverclient/       # JSON-RPC client for driver subprocess communication
│   ├── drivermanager/      # Driver resolution, lifecycle, download, source builds
│   ├── drivers/            # One package per database driver (45 total)
│   └── bin/                # Build output (gitignored)
├── tests/                  # Unit tests (vitest)
├── tests-integration/      # Cross-database integration tests
│   ├── docker-compose.yml  # Postgres + MySQL containers
│   ├── full-flow.test.ts   # SQLite-only flow tests
│   └── cross-database.test.ts  # Same tests across SQLite/PG/MySQL
├── examples/               # Example config files per database
└── scripts/
    └── postinstall.js      # Downloads sidecar binary on install
```

## Making changes

### TypeScript (MCP server)

Source files are in `src/`. Tests mirror the source structure in `tests/`.

After making changes:
```bash
pnpm run lint       # type check
pnpm test           # run unit tests
```

### Go (sidecar)

Source files are in `sidecar/`. All files are in `package main`.

After making changes:
```bash
cd sidecar
go build -o omnibase-sidecar .    # verify it compiles
go test ./... -v                   # run Go tests
```

The sidecar binary must be rebuilt after Go changes for the TypeScript integration tests to pick up the changes.

### Adding a new MCP tool

1. Create `src/tools/your-tool.ts` with a handler function
2. Create `tests/tools/your-tool.test.ts`
3. Register the tool in `src/index.ts`
4. Add integration test coverage in `tests-integration/cross-database.test.ts`
5. Update `README.md` with tool documentation

### Adding a new database driver

The sidecar uses [usql](https://github.com/xo/usql) driver packages. To add a new driver:

1. Add the import to `sidecar/main.go`: `_ "github.com/xo/usql/drivers/yourdriver"`
2. Run `go mod tidy` to fetch dependencies
3. Test with a DSN: the driver should work automatically via `dburl.Parse`
4. If schema introspection needs special handling, add supplement functions in `schema.go`
5. If the driver uses a non-standard LIMIT syntax, update `src/sql-dialect.ts`

## Pull requests

All changes go through pull requests. Direct pushes to `main` are blocked.

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure all tests pass: `pnpm test` and `cd sidecar && go test ./...`
4. Run `pnpm run format` to format code
5. Open a PR — CI will run lint, unit tests, Go tests, and integration tests
6. All CI checks must pass before merge

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Commitlint enforces this via a husky hook.

```
feat: add new tool for X          → triggers minor version bump
fix: handle null values in schema  → triggers patch version bump
feat!: redesign config format      → triggers major version bump (when > 1.0)
docs: update README with new tool  → no version bump
test: add cross-database tests     → no version bump
chore: update dependencies         → no version bump
```

## Code style

- **TypeScript**: formatted by Prettier (runs automatically on commit via lint-staged)
- **Go**: formatted by `gofmt` (standard Go formatting)
- **Agent-facing output**: always use snake_case for JSON field names
- **Internal TypeScript**: use camelCase for variables and interfaces
- **SQL generation**: use `sql-dialect.ts` helpers for cross-database compatibility — never hardcode `LIMIT` or other dialect-specific syntax

## Security considerations

When adding features that touch query execution:

- Never pass user-controlled table/column names directly into SQL — validate against the schema cache
- Check the `DANGEROUS_FUNCTIONS`, `SENSITIVE_TABLES`, and `BLOCKED_STATEMENTS` lists in `execute-sql.ts`
- Write operations should go through permission enforcement
- Use `sql-dialect.ts` for generated queries — don't assume LIMIT works everywhere
- Test against multiple databases — security behavior can differ across engines
