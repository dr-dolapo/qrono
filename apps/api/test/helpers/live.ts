/**
 * Stands in for the LiveEvent Durable Object in route tests: runs the same
 * commands against the same database, and remembers the alarm it would set.
 */
import { runCommand, type Delivery, type LiveCommand } from "../../src/live/commands";
import type { Env } from "../../src/env";

export function fakeLiveNamespace(getDb: () => D1Database, now: () => number = () => Date.now()) {
  const alarms = new Map<string, number | null>();
  const deliveries: Delivery[] = [];
  const ns = {
    alarms,
    deliveries,
    idFromName: (name: string) => name,
    get: (id: string) => ({
      async fetch(url: string, init?: RequestInit) {
        if (!String(url).endsWith("/command")) return new Response("WebSockets aren't simulated", { status: 501 });
        const cmd = JSON.parse(String(init!.body)) as LiveCommand;
        const result = await runCommand(getDb(), id, cmd, now());
        if (result.ok) {
          alarms.set(id, result.wakeAt);
          deliveries.push(...result.deliveries);
        }
        return Response.json(result, { status: result.status });
      },
    }),
  };
  return ns as unknown as Env["LIVE_EVENT"] & { alarms: Map<string, number | null>; deliveries: Delivery[] };
}
