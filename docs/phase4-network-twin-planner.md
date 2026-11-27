# Network Digital Twin and Expansion Planner

The **Network Planner** console page combines the known tenant router/access-point chain with a
planning scenario. It is available to tenant admins and technicians.

## Digital twin

- Uses the existing `parent_router_id` relationships to render a tenant topology.
- Shows current live/offline state and branch client counts.
- Cycles and orphaned parents are handled safely as the existing chain helper prevents duplicate visits.
- It does not perform active discovery, port scans, or RF measurements.

## Expansion scenarios

The planner accepts:

- Additional active customers.
- Additional network nodes.
- An assumed customer capacity per node.

It calculates projected utilization and remaining capacity. The result is a planning estimate only:
it does not model link backhaul, spectrum, airtime, line-of-sight, geographic coverage, or real packet
throughputs. Validate with field measurements before deploying equipment.
