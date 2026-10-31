import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Wrench,
  Terminal,
  Calculator,
  Cpu,
  Copy,
  Check,
  Zap,
  Network,
  Radio,
  Activity,
  Layers,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/tenant/tools")({
  head: () => ({
    meta: [
      { title: "ISP Diagnostics & Tools — Tenant Console" },
      { name: "description", content: "MikroTik diagnostic generator, CIDR subnet & PPPoE pool calculator, and bandwidth planner." },
    ],
  }),
  component: TenantToolsPage,
});

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function longToIp(long: number): string {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255,
  ].join(".");
}

export function TenantToolsPage() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyText(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Command copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // --- Subnet Calculator State ---
  const [cidrInput, setCidrInput] = useState("10.10.0.0/22");
  const [poolName, setPoolName] = useState("pppoe-pool");

  const subnetInfo = useMemo(() => {
    try {
      const [ipPart, maskPart] = cidrInput.trim().split("/");
      const prefix = parseInt(maskPart, 10);
      if (isNaN(prefix) || prefix < 8 || prefix > 30) return null;

      const ipParts = ipPart.split(".");
      if (ipParts.length !== 4 || ipParts.some((p) => isNaN(Number(p)) || Number(p) < 0 || Number(p) > 255)) {
        return null;
      }

      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      const ipNum = ipToLong(ipPart);
      const netNum = (ipNum & mask) >>> 0;
      const bcastNum = (netNum | ~mask) >>> 0;
      const totalIps = Math.pow(2, 32 - prefix);
      const usableHosts = Math.max(0, totalIps - 2);

      const firstHost = longToIp(netNum + 1);
      const lastHost = longToIp(bcastNum - 1);
      const netmask = longToIp(mask);

      return {
        network: longToIp(netNum),
        netmask,
        broadcast: longToIp(bcastNum),
        firstHost,
        lastHost,
        usableHosts,
        totalIps,
        prefix,
      };
    } catch {
      return null;
    }
  }, [cidrInput]);

  // --- Bandwidth Contention Calculator State ---
  const [uplinkMbps, setUplinkMbps] = useState("500");
  const [pkgSpeedMbps, setPkgSpeedMbps] = useState("10");
  const [contentionRatio, setContentionRatio] = useState("8");

  const bandwidthPlanning = useMemo(() => {
    const uplink = parseFloat(uplinkMbps) || 0;
    const pkg = parseFloat(pkgSpeedMbps) || 1;
    const ratio = parseFloat(contentionRatio) || 1;

    const simultaneousUsersAtPeak = Math.floor(uplink / pkg);
    const maxSubscribers = Math.floor(simultaneousUsersAtPeak * ratio);
    const estimatedDataPerDayGB = ((uplink * 0.45 * 3600 * 24) / (8 * 1000)).toFixed(0);

    return {
      simultaneousUsersAtPeak,
      maxSubscribers,
      estimatedDataPerDayGB,
    };
  }, [uplinkMbps, pkgSpeedMbps, contentionRatio]);

  // --- Diagnostics Command State ---
  const [diagHost, setDiagHost] = useState("8.8.8.8");
  const [diagCount, setDiagCount] = useState("5");
  const [diagSize, setDiagSize] = useState("64");

  return (
    <div className="space-y-6">
      <PageHeader
        title="ISP Diagnostics & Network Tools"
        description="MikroTik terminal command generators, PPPoE CIDR pool calculator, and network capacity planning."
      />

      <Tabs defaultValue="subnet" className="space-y-6">
        <TabsList className="grid w-full sm:w-auto grid-cols-3 max-w-lg">
          <TabsTrigger value="subnet" className="text-xs">
            <Calculator className="h-3.5 w-3.5 mr-1.5" />
            IP Subnet & Pool
          </TabsTrigger>
          <TabsTrigger value="commands" className="text-xs">
            <Terminal className="h-3.5 w-3.5 mr-1.5" />
            MikroTik Diagnostics
          </TabsTrigger>
          <TabsTrigger value="capacity" className="text-xs">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Bandwidth Planner
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Subnet & PPPoE Pool Calculator */}
        <TabsContent value="subnet" className="space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs">
            <h3 className="font-semibold text-base mb-1">PPPoE & Hotspot CIDR IP Pool Calculator</h3>
            <p className="text-xs text-muted-foreground mb-6">
              Plan and generate ready-to-paste MikroTik IP pool and PPP profile commands for your network segments.
            </p>

            <div className="grid gap-4 sm:grid-cols-2 max-w-xl mb-6">
              <div>
                <Label className="text-xs">Network CIDR Prefix</Label>
                <Input
                  value={cidrInput}
                  onChange={(e) => setCidrInput(e.target.value)}
                  placeholder="e.g. 10.10.0.0/22"
                  className="font-mono text-sm mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Accepts prefixes from /8 to /30</p>
              </div>
              <div>
                <Label className="text-xs">MikroTik Pool Name</Label>
                <Input
                  value={poolName}
                  onChange={(e) => setPoolName(e.target.value)}
                  placeholder="pppoe-pool"
                  className="font-mono text-sm mt-1"
                />
              </div>
            </div>

            {subnetInfo ? (
              <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Usable Clients</p>
                    <p className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                      {subnetInfo.usableHosts.toLocaleString()} IPs
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Total: {subnetInfo.totalIps.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Subnet Mask</p>
                    <p className="text-sm font-bold font-mono mt-1 text-foreground">{subnetInfo.netmask}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Prefix: /{subnetInfo.prefix}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Usable Range</p>
                    <p className="text-xs font-bold font-mono mt-1 text-foreground">{subnetInfo.firstHost}</p>
                    <p className="text-xs font-mono text-muted-foreground">to {subnetInfo.lastHost}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Network & Broadcast</p>
                    <p className="text-xs font-mono mt-1 text-foreground">Net: {subnetInfo.network}</p>
                    <p className="text-xs font-mono text-muted-foreground">Bcast: {subnetInfo.broadcast}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Generated MikroTik Terminal Commands
                  </h4>

                  {/* Pool Command */}
                  <div className="rounded-lg border bg-muted/70 p-3 flex items-center justify-between gap-4 font-mono text-xs">
                    <div className="overflow-x-auto select-all">
                      {`/ip pool add name="${poolName}" ranges=${subnetInfo.firstHost}-${subnetInfo.lastHost}`}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 shrink-0 text-xs"
                      onClick={() =>
                        copyText(
                          "pool",
                          `/ip pool add name="${poolName}" ranges=${subnetInfo.firstHost}-${subnetInfo.lastHost}`
                        )
                      }
                    >
                      {copiedKey === "pool" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      Copy
                    </Button>
                  </div>

                  {/* Profile Command */}
                  <div className="rounded-lg border bg-muted/70 p-3 flex items-center justify-between gap-4 font-mono text-xs">
                    <div className="overflow-x-auto select-all">
                      {`/ppp profile add name="${poolName}-profile" local-address=${subnetInfo.network} remote-address="${poolName}" dns-server=8.8.8.8,1.1.1.1`}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 shrink-0 text-xs"
                      onClick={() =>
                        copyText(
                          "profile",
                          `/ppp profile add name="${poolName}-profile" local-address=${subnetInfo.network} remote-address="${poolName}" dns-server=8.8.8.8,1.1.1.1`
                        )
                      }
                    >
                      {copiedKey === "profile" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-destructive">Please enter a valid CIDR network (e.g. 10.10.0.0/22).</p>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: MikroTik Diagnostics Commands */}
        <TabsContent value="commands" className="space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs">
            <h3 className="font-semibold text-base mb-1">MikroTik RouterOS Diagnostic Commands</h3>
            <p className="text-xs text-muted-foreground mb-6">
              Generate targeted diagnostic commands to run directly in your MikroTik WebFig / Winbox terminal.
            </p>

            <div className="grid gap-4 sm:grid-cols-3 max-w-xl mb-6">
              <div>
                <Label className="text-xs">Target Host / IP</Label>
                <Input
                  value={diagHost}
                  onChange={(e) => setDiagHost(e.target.value)}
                  className="font-mono text-xs mt-1"
                  placeholder="8.8.8.8"
                />
              </div>
              <div>
                <Label className="text-xs">Packet Count</Label>
                <Input
                  value={diagCount}
                  onChange={(e) => setDiagCount(e.target.value)}
                  className="font-mono text-xs mt-1"
                  placeholder="5"
                />
              </div>
              <div>
                <Label className="text-xs">Packet Size (Bytes)</Label>
                <Input
                  value={diagSize}
                  onChange={(e) => setDiagSize(e.target.value)}
                  className="font-mono text-xs mt-1"
                  placeholder="64"
                />
              </div>
            </div>

            <div className="space-y-4">
              {/* Ping Command */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>1. ICMP Ping & Latency / Packet Loss Test</span>
                  <span className="text-muted-foreground">Terminal Ping</span>
                </div>
                <div className="rounded-lg border bg-muted/70 p-3 flex items-center justify-between gap-4 font-mono text-xs">
                  <div className="overflow-x-auto select-all">
                    {`/ping count=${diagCount} size=${diagSize} ${diagHost}`}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 shrink-0 text-xs"
                    onClick={() => copyText("ping", `/ping count=${diagCount} size=${diagSize} ${diagHost}`)}
                  >
                    {copiedKey === "ping" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy
                  </Button>
                </div>
              </div>

              {/* Traceroute Command */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>2. Hop-by-Hop Traceroute Diagnostic</span>
                  <span className="text-muted-foreground">Network Path</span>
                </div>
                <div className="rounded-lg border bg-muted/70 p-3 flex items-center justify-between gap-4 font-mono text-xs">
                  <div className="overflow-x-auto select-all">
                    {`/tool traceroute address=${diagHost} count=${diagCount}`}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 shrink-0 text-xs"
                    onClick={() => copyText("trace", `/tool traceroute address=${diagHost} count=${diagCount}`)}
                  >
                    {copiedKey === "trace" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy
                  </Button>
                </div>
              </div>

              {/* Flush Cache */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>3. Flush DNS Cache & Clear Stale ARP Entries</span>
                  <span className="text-muted-foreground">Resolution Reset</span>
                </div>
                <div className="rounded-lg border bg-muted/70 p-3 flex items-center justify-between gap-4 font-mono text-xs">
                  <div className="overflow-x-auto select-all">
                    {`/ip dns cache flush; :log info "NetGrid: DNS cache cleared"`}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 shrink-0 text-xs"
                    onClick={() => copyText("dns", `/ip dns cache flush; :log info "NetGrid: DNS cache cleared"`)}
                  >
                    {copiedKey === "dns" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: Bandwidth Capacity & Contention Planner */}
        <TabsContent value="capacity" className="space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs">
            <h3 className="font-semibold text-base mb-1">ISP Bandwidth & Contention Ratio Planner</h3>
            <p className="text-xs text-muted-foreground mb-6">
              Estimate your network's capacity and determine how many subscribers you can safely support on your uplink.
            </p>

            <div className="grid gap-4 sm:grid-cols-3 max-w-xl mb-6">
              <div>
                <Label className="text-xs">Total Uplink Bandwidth (Mbps)</Label>
                <Input
                  type="number"
                  value={uplinkMbps}
                  onChange={(e) => setUplinkMbps(e.target.value)}
                  className="mt-1 text-sm font-semibold"
                  placeholder="500"
                />
              </div>
              <div>
                <Label className="text-xs">Average Client Plan (Mbps)</Label>
                <Input
                  type="number"
                  value={pkgSpeedMbps}
                  onChange={(e) => setPkgSpeedMbps(e.target.value)}
                  className="mt-1 text-sm font-semibold"
                  placeholder="10"
                />
              </div>
              <div>
                <Label className="text-xs">Target Contention Ratio</Label>
                <Select value={contentionRatio} onValueChange={setContentionRatio}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="1:8" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1:1 (Dedicated / Leased Line)</SelectItem>
                    <SelectItem value="4">1:4 (Corporate / Business)</SelectItem>
                    <SelectItem value="8">1:8 (Standard Residential)</SelectItem>
                    <SelectItem value="10">1:10 (Aggressive Residential)</SelectItem>
                    <SelectItem value="15">1:15 (Budget / Light User)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground">Simultaneous 100% Saturation</p>
                <p className="text-2xl font-bold mt-1 text-foreground">
                  {bandwidthPlanning.simultaneousUsersAtPeak.toLocaleString()} Users
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Users downloading at maximum plan speed simultaneously.
                </p>
              </div>

              <div className="rounded-xl border bg-emerald-500/10 border-emerald-500/25 p-4">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Max Recommended Subscribers</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                  {bandwidthPlanning.maxSubscribers.toLocaleString()} Clients
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  At a 1:{contentionRatio} statistical multiplexing contention ratio.
                </p>
              </div>

              <div className="rounded-xl border bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground">Estimated Daily Throughput</p>
                <p className="text-2xl font-bold mt-1 text-foreground">
                  ~{bandwidthPlanning.estimatedDataPerDayGB} GB / Day
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Assuming average 45% peak-to-trough day/night duty cycle.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
