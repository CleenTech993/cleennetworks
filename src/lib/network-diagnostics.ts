import { isRouterLive, ramPercent } from "@/lib/router-health";

export type NetworkDoctorFinding = {
  severity: "critical" | "warning" | "info";
  category: "availability" | "capacity" | "hardware" | "configuration";
  title: string;
  evidence: string;
  recommendation: string;
};

export type NetworkDoctorRouter = {
  id: string;
  name: string;
  status: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
  cpu_load: number | null;
  cpu_usage: number | null;
  ram_usage: number | null;
  total_memory_mb: number | null;
  free_memory_mb: number | null;
  temperature: number | null;
  uptime_seconds: number | null;
  parent_router_id: string | null;
};

export function diagnoseNetwork(
  routers: readonly NetworkDoctorRouter[],
  now = new Date(),
): NetworkDoctorFinding[] {
  const findings: NetworkDoctorFinding[] = [];
  const offline = routers.filter((router) => !isRouterLive(router, now.getTime()));
  const online = routers.filter((router) => isRouterLive(router, now.getTime()));

  if (routers.length === 0) {
    findings.push({
      severity: "info",
      category: "configuration",
      title: "No enrolled routers",
      evidence: "The tenant has no router records available for diagnosis.",
      recommendation: "Enroll the primary router, then confirm that it sends heartbeats.",
    });
  }
  if (offline.length > 0) {
    const chainRoots = offline.filter((router) => {
      if (!router.parent_router_id) return true;
      const parent = routers.find((candidate) => candidate.id === router.parent_router_id);
      return !parent || isRouterLive(parent, now.getTime());
    });
    findings.push({
      severity: "critical",
      category: "availability",
      title: `${offline.length} router${offline.length === 1 ? "" : "s"} not reporting`,
      evidence: `${offline.length} of ${routers.length} enrolled routers missed recent heartbeats; ${chainRoots.length} appear to be the possible starting point${chainRoots.length === 1 ? "" : "s"} for the affected chain.`,
      recommendation:
        "Check uplink power, carrier connectivity, DNS, and the root router first. Verify reboot and heartbeat activity before changing customer records.",
    });
  }
  for (const router of online) {
    const cpu = router.cpu_load ?? router.cpu_usage;
    if (cpu != null && cpu >= 90) {
      findings.push({
        severity: "critical",
        category: "capacity",
        title: "Router CPU saturation",
        evidence: `An online router is reporting ${Math.round(cpu)}% CPU.`,
        recommendation:
          "Check unusual traffic, active scans, queueing, PPPoE session growth, and recent configuration changes. Reboot only after a support-safe backup.",
      });
    } else if (cpu != null && cpu >= 75) {
      findings.push({
        severity: "warning",
        category: "capacity",
        title: "Elevated router CPU",
        evidence: `An online router is reporting ${Math.round(cpu)}% CPU.`,
        recommendation:
          "Monitor for sustained load and review bandwidth-heavy clients or a routing/configuration regression.",
      });
    }

    const memory = ramPercent(router);
    if (memory != null && memory >= 90) {
      findings.push({
        severity: "critical",
        category: "capacity",
        title: "Router memory saturation",
        evidence: `An online router is reporting ${memory}% memory utilization.`,
        recommendation:
          "Review active PPPoE/hotspot sessions, cache-heavy processes, and firmware stability. Back up before any reboot.",
      });
    } else if (memory != null && memory >= 85) {
      findings.push({
        severity: "warning",
        category: "capacity",
        title: "High router memory usage",
        evidence: `An online router is reporting ${memory}% memory utilization.`,
        recommendation:
          "Continue monitoring and check whether session or log growth is correlated with the increase.",
      });
    }

    if (router.temperature != null && router.temperature >= 75) {
      findings.push({
        severity: "critical",
        category: "hardware",
        title: "Router temperature risk",
        evidence: `An online router is reporting ${router.temperature}°C.`,
        recommendation:
          "Check ventilation, dust, enclosure temperature, and power stability. Avoid unsafe shutdown unless thermal damage is imminent.",
      });
    } else if (router.temperature != null && router.temperature >= 70) {
      findings.push({
        severity: "warning",
        category: "hardware",
        title: "Router temperature elevated",
        evidence: `An online router is reporting ${router.temperature}°C.`,
        recommendation:
          "Improve ventilation or move the equipment away from direct heat and confirm the sensor reading repeatedly.",
      });
    }
  }

  if (findings.length === 0 && routers.length > 0) {
    findings.push({
      severity: "info",
      category: "availability",
      title: "No immediate network risk detected",
      evidence: `${online.length} routers are reporting recently, with no critical CPU, memory, or temperature threshold exceeded.`,
      recommendation:
        "Continue routine monitoring and investigate customer-specific packet loss or authentication failures separately.",
    });
  }

  return findings;
}

export function networkDoctorDeterministicSummary(
  findings: readonly NetworkDoctorFinding[],
): string {
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const warning = findings.filter((finding) => finding.severity === "warning").length;
  if (critical > 0) {
    return `${critical} critical and ${warning} warning finding${critical + warning === 1 ? "" : "s"} require immediate technical review.`;
  }
  if (warning > 0) {
    return `${warning} warning finding${warning === 1 ? "" : "s"} should be monitored before they affect customers.`;
  }
  return "No immediate fleet-level network risk was detected.";
}
