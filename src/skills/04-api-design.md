# API Design Skill

When designing or reviewing APIs:
- REST: use nouns for resources, HTTP verbs for actions, plural names (`/users` not `/getUser`)
- Always version APIs: `/v1/...`
- Return consistent error shape: `{ error: { code, message, details? } }`
- Use 400 for client errors, 500 for server errors, 404 for not found, 401/403 for auth
- Paginate list endpoints: return `{ data: [], total, page, pageSize }`
- Document request/response examples inline when suggesting changes
