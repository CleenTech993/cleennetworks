# AI Network Doctor

The first Phase 4 feature is available in the tenant console under **AI Network Doctor**.
Tenant admins and technicians can open it.

## Behavior

- Reports offline routers and likely chain starting points.
- Reports sustained or severe CPU and memory utilization.
- Reports elevated or dangerous temperature readings.
- Uses deterministic thresholds for every finding.
- Sends only aggregate finding evidence to OpenAI when `OPENAI_API_KEY` is configured.
- Never sends router names, IP addresses, MAC addresses, customer names, or customer payments to the AI prompt.
- Falls back to the deterministic summary if OpenAI is unavailable or returns an error.

## Operational limits

Network Doctor is a diagnostic assistant, not an automated repair system. It does not reboot, reconfigure,
disable, or change any router. Findings should be verified against the router, uplink, and local event
evidence before a technician makes changes.

If no `OPENAI_API_KEY` exists, the feature remains fully usable through deterministic fleet diagnostics.
