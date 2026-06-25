# Security Skill

Security checklist for any code change:
- Never log passwords, tokens, or PII
- Validate and sanitize all user inputs server-side
- Use parameterized queries — never string-concatenate SQL
- Store secrets in env vars, never in code or git
- Set auth headers, CORS, and rate limits on all public endpoints
- Prefer allowlists over blocklists
- Flag any `eval()`, `exec()`, deserialization of untrusted data, or path traversal risks
- When in doubt about a security decision, say so explicitly
