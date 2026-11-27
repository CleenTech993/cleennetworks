import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { replenishVoucherInventory } from "@/lib/voucher-inventory.server";

function isAuthorized(request: Request): boolean {
  const expected = process.env["CRON_SECRET"];
  const authorization = request.headers.get("authorization") ?? "";
  if (!expected || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export const Route = createFileRoute("/api/cron/voucher-inventory")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });

        try {
          const results = await replenishVoucherInventory();
          return Response.json({
            settingsProcessed: results.length,
            vouchersCreated: results.reduce((sum, result) => sum + result.created, 0),
            results,
          });
        } catch (error) {
          console.error("Voucher inventory replenishment failed", error);
          return Response.json({ error: "Could not replenish voucher inventory" }, { status: 500 });
        }
      },
    },
  },
});
