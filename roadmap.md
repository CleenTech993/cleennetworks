# Roadmap

## Open tasks
- [x] WireGuard tunnel for platform↔MikroTik communication — done 2026-10-02: router key registration + config endpoints, .rsc provisioning section, Super Admin endpoint config + peer list on NOC page, tunnel IP on router detail. Platform WG server itself must be run by the user (host+port+pubkey entered in NOC).
- [ ] Phase 3 NOC UI: Interfaces/Internet quality/Traffic tabs on router detail page (data ingestion done, UI pending).
- [x] AI WireGuard tunnel diagnosis on router detail page (tenant pastes WG status/logs → AI Gateway diagnosis + fixes) — done 2026-10-03; gateway call verified live.
- [x] Fixed .rsc import syntax error (line 42 flood-ping do-block) — replaced with /ping loop; user must re-run provisioning command.
