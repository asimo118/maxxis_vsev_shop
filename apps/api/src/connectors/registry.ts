import type { ConnectorName, ConnectorStatusDto } from "@vsev/shared";
import type { Clock } from "../platform/clock";
import { errors } from "../platform/errors";
import type { Logger } from "../platform/logger";
import type { QueueDriver } from "../platform/queue";
import { ConnectorError } from "./http-json";

type Counts = { upserted: number; deactivated: number };

export interface ConnectorRegistration {
  name: ConnectorName;
  label: string;
  mode: "local" | "http";
  endpointHost: string | null;
  /** Present for master-data feeds in http mode: fetch upstream and mirror it locally. */
  sync?: () => Promise<Counts>;
}

/**
 * Knows every connector, runs feed syncs (on a schedule and on demand) and remembers each one's last
 * outcome for the admin console. A failed sync leaves the last good local copy untouched.
 */
export class ConnectorRegistry {
  private readonly entries = new Map<ConnectorName, ConnectorRegistration>();
  private readonly status = new Map<ConnectorName, Pick<ConnectorStatusDto, "lastRunAt" | "lastResult" | "lastMessage" | "lastCounts">>();

  constructor(private readonly deps: { clock: Clock; logger: Logger }) {}

  register(entry: ConnectorRegistration): void {
    this.entries.set(entry.name, entry);
  }

  /** Mark a request/response connector's last call (commerce has no sync). */
  recordCall(name: ConnectorName, result: "ok" | "error", message: string | null): void {
    this.status.set(name, { lastRunAt: this.deps.clock.now().toISOString(), lastResult: result, lastMessage: message, lastCounts: null });
  }

  list(): ConnectorStatusDto[] {
    return [...this.entries.values()].map((e) => ({
      name: e.name,
      label: e.label,
      mode: e.mode,
      endpointHost: e.endpointHost,
      syncable: e.sync !== undefined,
      lastRunAt: null,
      lastResult: null,
      lastMessage: null,
      lastCounts: null,
      ...this.status.get(e.name)
    }));
  }

  get(name: string): ConnectorStatusDto {
    const found = this.list().find((c) => c.name === name);
    if (!found) throw errors.notFound("找不到這個連接器。");
    return found;
  }

  async syncNow(name: string): Promise<ConnectorStatusDto> {
    const entry = this.entries.get(name as ConnectorName);
    if (!entry) throw errors.notFound("找不到這個連接器。");
    if (!entry.sync) throw errors.conflict("這個連接器不需要同步（資料在本系統管理，或為即時呼叫）。");
    const startedAt = this.deps.clock.now().toISOString();
    try {
      const counts = await entry.sync();
      this.status.set(entry.name, { lastRunAt: startedAt, lastResult: "ok", lastMessage: null, lastCounts: counts });
      this.deps.logger.info({ connector: entry.name, ...counts }, "connector sync ok");
    } catch (err) {
      const message = err instanceof ConnectorError ? err.reason : err instanceof Error ? err.message : String(err);
      this.status.set(entry.name, { lastRunAt: startedAt, lastResult: "error", lastMessage: message, lastCounts: null });
      this.deps.logger.error({ connector: entry.name, err: message }, "connector sync failed; keeping last good data");
    }
    return this.get(entry.name);
  }

  /** Sync every feed now (server boot, before seeding). Failures are recorded, never thrown. */
  async syncAll(): Promise<ConnectorStatusDto[]> {
    const results: ConnectorStatusDto[] = [];
    for (const entry of this.entries.values()) if (entry.sync) results.push(await this.syncNow(entry.name));
    return results;
  }

  /** Re-sync every feed every `everyMs`, through the queue so it never blocks a request. */
  async schedule(queue: QueueDriver, everyMs: number): Promise<void> {
    queue.process<{ name: ConnectorName }>("connectors", async (job) => {
      await this.syncNow(job.data.name);
    });
    for (const entry of this.entries.values()) {
      if (entry.sync) await queue.schedule("connectors", `sync-${entry.name}`, everyMs, "sync", { name: entry.name });
    }
  }
}
