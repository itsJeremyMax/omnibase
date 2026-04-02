# CLI Reference

## Tool Management

```bash
npx omnibase-mcp tools list       # list all custom tools
npx omnibase-mcp tools add        # interactive wizard to add a tool
npx omnibase-mcp tools remove     # interactive wizard to remove a tool
npx omnibase-mcp tools validate   # validate custom tool definitions
npx omnibase-mcp tools test       # dry-run a tool with sample arguments
```

## Status & Health

```bash
npx omnibase-mcp status           # ping all connections, show health dashboard
```

## Audit Log

```bash
npx omnibase-mcp audit tail       # live tail the query audit log
npx omnibase-mcp audit search <q> # search audit log by keyword
npx omnibase-mcp audit clear      # clear the audit log
```

## Upgrades

```bash
npx omnibase-mcp upgrade                       # upgrade to latest version
npx omnibase-mcp upgrade --dry-run              # check for updates and show changelog
npx omnibase-mcp upgrade --version 0.1.20       # switch to a specific version
npx omnibase-mcp upgrade --allow-major          # allow major version changes
```

Updates to a new major version (or downgrades across a major version boundary) require the `--allow-major` flag.

The CLI also checks for updates in the background and shows a notice after commands when a newer version is available. Set `NO_UPDATE_NOTIFIER=1` to suppress this.

## Drivers

```bash
npx omnibase-mcp drivers list              # list available drivers and install status
npx omnibase-mcp drivers install <driver>  # download a specific driver (or --all)
npx omnibase-mcp drivers build <driver>    # build a driver from source using Go (or --all)
npx omnibase-mcp drivers clean             # remove old driver versions
npx omnibase-mcp drivers path              # show driver storage location
```

## Version

```bash
npx omnibase-mcp --version        # print current version
```
