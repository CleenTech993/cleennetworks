// Invoke a TanStack Start file-route handler directly, the way the server would.
type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response> | Response;

export async function call(
  route: unknown,
  method: "GET" | "POST",
  opts: { url?: string; params?: Record<string, string>; body?: unknown; rawBody?: string; ip?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const handlers = (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.ip) headers["cf-connecting-ip"] = opts.ip;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(opts.url ?? "https://portal.test/x", {
    method,
    headers,
    body: method === "POST" ? (opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)) : undefined,
  });
  return handlers[method]({ request, params: opts.params ?? {} });
}
export const json = async (r: Response) => (await r.json()) as Record<string, any>;
