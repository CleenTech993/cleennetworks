# Phase 5 API ecosystem

## Tenant API keys

Tenant admins can create scoped API keys at **Administration → Developer API**.

Supported scopes:

- `static_ips:read`
- `static_ips:write`
- `routers:read`
- `customers:read`

The browser receives the secret only once at creation. The database stores a SHA-256 hash, a short
prefix, scopes, optional expiry, and the last-used timestamp. Revoked and expired keys are rejected.

The existing `/v1/tenant/static-ips` endpoints accept either a normal Supabase user bearer session or
a tenant API key:

```http
Authorization: Bearer ng_<key>
```

API-key static-IP reads require `static_ips:read`; writes require `static_ips:write`. Key-based
requests are explicitly filtered to the key's tenant before the static-IP update is applied.

Set `SUPABASE_SERVICE_ROLE_KEY` in the API Worker environment for key validation. This secret must
remain server-only. Browser, chatbot, and customer applications must receive narrowly scoped keys
through an approved server integration rather than embedding them in public code.

## Ecosystem foundation

The Phase 5 migration also adds tenant integrations, webhook configuration, automation rules,
execution audit logs, marketplace listings, and marketplace service requests. Automation and webhook
credentials must remain server-only and should be activated only after per-provider authorization,
retry, signature, and abuse controls are implemented.
