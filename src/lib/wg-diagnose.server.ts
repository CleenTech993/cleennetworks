import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const RUN_ID = "X-Lovable-AIG-Run-ID";

const SYSTEM = `You are a senior network engineer specialising in MikroTik RouterOS v7 and WireGuard management tunnels for ISP/hotspot deployments.
The router connects to a central platform WireGuard server. Diagnose the tunnel using the status output and logs provided.
Respond in Markdown with these sections:
## Diagnosis — the most likely root cause(s), ranked, citing evidence from the input.
## Troubleshooting steps — numbered, concrete steps including exact RouterOS commands in code blocks (/interface wireguard ..., /ping, /tool sniffer, /ip firewall ...).
## Verification — how to confirm the tunnel is healthy (handshake age < 3 min, rx/tx counters increasing, ping to tunnel gateway).
Common causes to consider: key mismatch, wrong endpoint host/port, UDP blocked by ISP/firewall, CGNAT without persistent-keepalive, allowed-address mismatch, duplicate tunnel IP, clock drift, MTU issues, server peer not added.
Keep it under 450 words. If the input is insufficient, say what output to collect.`;

export async function diagnoseWireguard(input: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured for this app.");
  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set(RUN_ID, runId);
      const res = await fetch(url, { ...init, headers });
      runId ??= res.headers.get(RUN_ID) ?? undefined;
      return res;
    },
  });
  let failure: unknown;
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system: SYSTEM,
    prompt: input,
    onError: ({ error }) => {
      failure = error;
    },
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  const text = await result.text;
  if (failure || !text.trim()) {
    const status = (failure as { statusCode?: number })?.statusCode;
    if (status === 429) throw new Error("AI is busy right now. Please try again in a minute.");
    if (status === 402) throw new Error("AI credits are exhausted. Add credits to continue.");
    if (status === 403) throw new Error("AI access is blocked for this workspace.");
    throw new Error("The AI could not produce a diagnosis. Please try again later.");
  }
  return text;
}
