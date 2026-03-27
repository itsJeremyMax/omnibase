# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in omnibase, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **dev@jeremymax.com** with:

- A description of the vulnerability
- Steps to reproduce
- Any relevant logs or screenshots

You should receive a response within 48 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

Security issues we are particularly interested in:

- SQL injection bypasses in the query analyzer or permission enforcer
- Unauthorized access to database connections
- Credential exposure through logs, errors, or the MCP protocol
- Sidecar binary supply chain issues (compromised downloads)

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| < 0.1.0 | No        |
