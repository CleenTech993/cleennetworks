import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Filter,
  Download,
  ShieldCheck,
  Router as RouterIcon,
  Network,
  Ticket,
  Key,
  Settings,
  User,
  Clock,
  Eye,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/dashboard-shell";

export interface AuditLogRecord {
  id: string;
  created_at: string;
  tenant_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
}

export function AuditLogViewer({
  tenantId,
  isSuperAdmin = false,
}: {
  tenantId?: string | null;
  isSuperAdmin?: boolean;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["audit-logs", tenantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);

      if (tenantId && !isSuperAdmin) {
        q = q.eq("tenant_id", tenantId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditLogRecord[];
    },
    refetchInterval: 5_000,
  });

  // Realtime subscription for instant audit updates
  useEffect(() => {
    const channelName = tenantId ? `audit-${tenantId}` : "audit-all";
    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_logs",
          ...(tenantId && !isSuperAdmin ? { filter: `tenant_id=eq.${tenantId}` } : {}),
        },
        () => void qc.invalidateQueries({ queryKey: ["audit-logs"] }),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tenantId, isSuperAdmin, qc]);

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter((log) => {
      if (resourceFilter !== "all" && log.resource_type !== resourceFilter) {
        return false;
      }
      if (search.trim()) {
        const s = search.toLowerCase();
        const matchesDesc = log.description?.toLowerCase().includes(s);
        const matchesEmail = log.actor_email?.toLowerCase().includes(s);
        const matchesAction = log.action?.toLowerCase().includes(s);
        const matchesResource = log.resource_id?.toLowerCase().includes(s);
        if (!matchesDesc && !matchesEmail && !matchesAction && !matchesResource) {
          return false;
        }
      }
      return true;
    });
  }, [logs, search, resourceFilter]);

  function exportCsv() {
    if (!filtered.length) return;
    const headers = ["Timestamp", "Actor Email", "Role", "Action", "Resource Type", "Resource ID", "Description"];
    const rows = filtered.map((l) => [
      new Date(l.created_at).toISOString(),
      `"${(l.actor_email ?? "system").replace(/"/g, '""')}"`,
      l.actor_role ?? "staff",
      l.action,
      l.resource_type,
      `"${(l.resource_id ?? "").replace(/"/g, '""')}"`,
      `"${l.description.replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function getActionBadge(type: string) {
    switch (type) {
      case "router":
        return (
          <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">
            <RouterIcon className="h-3 w-3" /> Router
          </Badge>
        );
      case "pppoe":
      case "pppoe_customer":
        return (
          <Badge variant="outline" className="gap-1 border-purple-500/30 text-purple-600 dark:text-purple-400">
            <Network className="h-3 w-3" /> PPPoE
          </Badge>
        );
      case "auth":
      case "mfa":
      case "security":
        return (
          <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> Security
          </Badge>
        );
      case "voucher":
        return (
          <Badge variant="outline" className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400">
            <Ticket className="h-3 w-3" /> Voucher
          </Badge>
        );
      case "settings":
        return (
          <Badge variant="outline" className="gap-1 border-zinc-500/30">
            <Settings className="h-3 w-3" /> Settings
          </Badge>
        );
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  }

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by user, action, description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>
          <Select value={resourceFilter} onValueChange={setResourceFilter}>
            <SelectTrigger className="w-[160px] text-xs">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              <SelectItem value="router">Routers</SelectItem>
              <SelectItem value="pppoe">PPPoE clients</SelectItem>
              <SelectItem value="security">Security & MFA</SelectItem>
              <SelectItem value="voucher">Vouchers</SelectItem>
              <SelectItem value="settings">Settings</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={exportCsv}
          disabled={!filtered.length}
          className="gap-1.5 text-xs self-end sm:self-auto"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {/* Logs Table */}
      {isLoading ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading audit trail…
        </div>
      ) : !filtered.length ? (
        <EmptyState
          title="No audit events found"
          description="Administrative actions, router events, and security changes will appear here automatically."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Administrator</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Action Description</th>
                <th className="px-4 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground/60" />
                      {new Date(log.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate max-w-[180px]">{log.actor_email ?? "System Automations"}</span>
                      {log.actor_role && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1 font-normal uppercase">
                          {log.actor_role.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{getActionBadge(log.resource_type)}</td>
                  <td className="px-4 py-3 text-foreground font-medium max-w-md truncate">
                    {log.description}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setSelectedLog(log)}
                      title="View metadata"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        {selectedLog && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                {getActionBadge(selectedLog.resource_type)}
                <span>Audit Event Details</span>
              </DialogTitle>
              <DialogDescription>
                {new Date(selectedLog.created_at).toLocaleString()}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
                <p>
                  <strong>Action:</strong> <code className="font-mono text-primary">{selectedLog.action}</code>
                </p>
                <p>
                  <strong>Actor:</strong> {selectedLog.actor_email ?? "System Automation"} ({selectedLog.actor_role ?? "system"})
                </p>
                {selectedLog.resource_id && (
                  <p>
                    <strong>Resource ID:</strong> <span className="font-mono">{selectedLog.resource_id}</span>
                  </p>
                )}
                <p>
                  <strong>Description:</strong> {selectedLog.description}
                </p>
              </div>

              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1 text-muted-foreground uppercase text-[10px] tracking-wider">
                    Context Metadata
                  </h4>
                  <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto max-h-48 border">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
