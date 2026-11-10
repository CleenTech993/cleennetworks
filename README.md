# CleenNetworks

CleenNetworks is a multi-tenant ISP operations platform with a tenant console, subscriber portals,
router integrations, payments, and platform administration.

The application is being separated incrementally. The existing TanStack Start web app and its
legacy server features remain at the repository root; the first independent HTTP backend is in
`apps/api/`. See the [system overview](docs/system-overview.md) for the architecture, security
boundaries, repository map, migrations, and local development setup.

## Quick start

```powershell
npm install
npm run dev
```

To run the extracted API too, configure `apps/api/.dev.vars` from
[`apps/api/.dev.vars.example`](apps/api/.dev.vars.example), set `VITE_API_BASE_URL` in the root
`.env`, then run `npm run dev:api` in a second terminal. See the system overview for details.

## Documentation

- [System overview and setup](docs/system-overview.md)
- [Frontend/backend separation plan](docs/architecture/frontend-backend-separation.md)
- [Device management](docs/device-management.md)
- [Customer communications](docs/customer-communications.md)
- [Daraja / M-Pesa](docs/daraja.md)
- [Platform billing](docs/platform-billing.md)
- [Router troubleshooting](docs/ROUTER_TROUBLESHOOTING.md)
