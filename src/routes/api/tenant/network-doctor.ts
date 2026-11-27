import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import {
  diagnoseNetwork,
  networkDoctorDeterministicSummary,
  type NetworkDoctorRouter,
} from "@/lib/network-diagnostics";

const DoctorSchema = z.object({
  tenantId: z.string().uuid(),
  findings: z
    .array(
      z.object({
        severity: z.enum(["critical", "warning", "info"]),
        category: z.enum(["availability", "capacity", "hardware", "configuration"]),
        title: z.string().max(120),
        evidence: z.string().max(500),
        recommendation: z.string().max(500),
      }),
    )
    .max(30),
});

export const Route = createFileRoute("/api/tenant/network-doctor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization");
        const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token)
          return Response.json({ error: "Sign in to use Network Doctor." }, { status: 401 });

        const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
        const claims = claimsData?.claims;
        if (claimsError || !claims?.sub) {
          return Response.json(
            { error: "Your session is invalid. Sign in again." },
            { status: 401 },
          );
        }
        if (!rateLimit(`network-doctor:${claims.sub}:${clientIp(request)}`, 12, 60_000)) {
          return tooManyRequests();
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        const parsed = DoctorSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Invalid network diagnostic data." }, { status: 400 });
        }

        const { data: roles, error: rolesError } = await supabaseAdmin
          .from("user_roles")
          .select("role,tenant_id")
          .eq("user_id", claims.sub);
        if (rolesError) {
          console.error("Network Doctor role lookup failed", rolesError);
          return Response.json({ error: "Could not verify access." }, { status: 503 });
        }
        const authorized = roles?.some(
          (role) =>
            role.role === "super_admin" ||
            ((role.role === "tenant_admin" || role.role === "technician") &&
              role.tenant_id === parsed.data.tenantId),
        );
        if (!authorized) {
          return Response.json(
            { error: "Only tenant admins and technicians can use Network Doctor." },
            { status: 403 },
          );
        }

        const { data: routers, error: routersError } = await supabaseAdmin
          .from("routers")
          .select(
            "id,name,status,last_heartbeat_at,last_seen_at,cpu_load,cpu_usage,ram_usage,total_memory_mb,free_memory_mb,temperature,uptime_seconds,parent_router_id",
          )
          .eq("tenant_id", parsed.data.tenantId);
        if (routersError) {
          console.error("Network Doctor router lookup failed", routersError);
          return Response.json({ error: "Could not load fleet diagnostics." }, { status: 503 });
        }
        const findings = diagnoseNetwork((routers ?? []) as NetworkDoctorRouter[]);
        const deterministicSummary = networkDoctorDeterministicSummary(findings);

        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) {
          return Response.json({
            summary: deterministicSummary,
            findings,
            provider: "deterministic",
          });
        }

        try {
          const model = createOpenAI({ apiKey })("gpt-4o-mini");
          const { text } = await generateText({
            model,
            prompt: [
              "Explain the following aggregate ISP fleet diagnostics to a network technician.",
              "Do not invent router names, customer names, IP addresses, or outages that are not in the evidence.",
              "Prioritize immediate safety: traffic loss, thermal risk, memory or CPU saturation.",
              "Recommend a short operational checklist, not a guaranteed diagnosis.",
              "Keep the response concise and under 180 words.",
              "Deterministic summary:",
              deterministicSummary,
              "Evidence:",
              JSON.stringify(
                findings.map(({ severity, category, title, evidence, recommendation }) => ({
                  severity,
                  category,
                  title,
                  evidence,
                  recommendation,
                })),
              ),
            ].join("\n"),
          });
          return Response.json({
            summary: text.trim(),
            findings,
            provider: "openai",
          });
        } catch (error) {
          console.error("Network Doctor AI summary unavailable", error);
          return Response.json({
            summary: deterministicSummary,
            findings,
            provider: "deterministic",
          });
        }
      },
    },
  },
});
