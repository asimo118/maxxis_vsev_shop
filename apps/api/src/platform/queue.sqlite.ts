import type { Clock } from "./clock";
import type { Logger } from "./logger";
import type { JobHandler, JobOptions, QueueDriver, QueueName } from "./queue";
import { nowIso, type SqliteDb } from "./sqlite";

interface JobRow {
  id: number;
  queue: QueueName;
  name: string;
  data: string;
  job_key: string | null;
  attempts_left: number;
  run_at: string;
}

const BACKOFF_BASE_MS = 30_000;
const KEEP_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Durable queue on the application's own SQLite file — the default when no Redis is configured.
 * Jobs (including reminders scheduled 14 days ahead) survive restarts and deploys.
 *
 * Delivery is at-least-once: a job interrupted by a crash is re-run on the next boot, so handlers
 * must be idempotent (they are: ledger unique keys, notification dedupe keys, CAS transitions).
 * `jobId` dedupes for as long as the row is kept (30 days after it finishes).
 * Single process only — the same constraint SQLite already puts on the API.
 */
export class SqliteQueueDriver implements QueueDriver {
  private readonly handlers = new Map<QueueName, JobHandler>();
  private readonly running = new Set<Promise<void>>();
  private readonly timers: NodeJS.Timeout[] = [];
  private pumping: Promise<number> | null = null;
  private closed = false;

  private readonly insert;
  private readonly due;
  private readonly claim;
  private readonly finish;
  private readonly retry;
  private readonly fail;
  private readonly cancelStmt;
  private readonly pending;
  private readonly prune;

  constructor(
    private readonly db: SqliteDb,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly pollMs = 5_000
  ) {
    this.insert = db.prepare<[QueueName, string, string, string | null, string, number, string, string]>(
      `INSERT INTO jobs (queue, name, data, job_key, status, run_at, attempts_left, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT (job_key) DO NOTHING`
    );
    this.due = db.prepare<[string, number], JobRow>(
      `SELECT id, queue, name, data, job_key, attempts_left, run_at FROM jobs
       WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT ?`
    );
    this.claim = db.prepare<[string, number]>(
      "UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'"
    );
    this.finish = db.prepare<[string, number]>("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?");
    this.retry = db.prepare<[string, number, string, string, number]>(
      `UPDATE jobs SET status = 'pending', run_at = ?, attempts_left = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    );
    this.fail = db.prepare<[string, string, number]>(
      "UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?"
    );
    this.cancelStmt = db.prepare<[string]>("DELETE FROM jobs WHERE job_key = ? AND status = 'pending'");
    this.pending = db.prepare<[], { queue: QueueName; job_key: string | null; run_at: string }>(
      "SELECT queue, job_key, run_at FROM jobs WHERE status = 'pending' ORDER BY run_at, id"
    );
    this.prune = db.prepare<[string]>("DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?");

    // A job that was 'running' when the previous process died never finished — run it again.
    const recovered = db
      .prepare<[string]>("UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'running'")
      .run(nowIso()).changes;
    if (recovered > 0) logger.warn({ recovered }, "re-queued jobs interrupted by the previous shutdown");
  }

  process<T>(queue: QueueName, handler: JobHandler<T>): void {
    this.handlers.set(queue, handler as JobHandler);
  }

  /** Start the background poller (server only; tests drive it with runDue()/drain()). */
  start(): void {
    const poll = setInterval(() => void this.runDue(), this.pollMs);
    poll.unref();
    const housekeeping = setInterval(() => {
      const cutoff = new Date(this.clock.now().getTime() - KEEP_FINISHED_MS).toISOString();
      this.prune.run(cutoff);
    }, 60 * 60 * 1000);
    housekeeping.unref();
    this.timers.push(poll, housekeeping);
    void this.runDue();
  }

  async enqueue<T>(queue: QueueName, name: string, data: T, opts: JobOptions = {}): Promise<void> {
    const now = this.clock.now().getTime();
    const runAt = new Date(now + Math.max(0, opts.delayMs ?? 0)).toISOString();
    const key = opts.jobId ? `${queue}/${opts.jobId}` : null;
    const stamp = nowIso();
    this.insert.run(queue, name, JSON.stringify(data), key, runAt, opts.attempts ?? 3, stamp, stamp);
    if (!opts.delayMs) setImmediate(() => void this.runDue());
  }

  async cancel(queue: QueueName, jobId: string): Promise<void> {
    this.cancelStmt.run(`${queue}/${jobId}`);
  }

  /**
   * Repeating jobs (e.g. the nightly overdue sweep) are re-registered on every boot, so they are
   * timers rather than rows; their handlers are idempotent sweeps.
   */
  async schedule(queue: QueueName, _schedulerId: string, everyMs: number, name: string, data: unknown): Promise<void> {
    const timer = setInterval(() => {
      void this.enqueue(queue, name, data);
    }, everyMs);
    timer.unref();
    this.timers.push(timer);
  }

  /** Runs every job that is due now (looping until none are left). Returns how many ran. */
  runDue(): Promise<number> {
    if (this.closed) return Promise.resolve(0);
    this.pumping ??= this.pump().finally(() => {
      this.pumping = null;
    });
    return this.pumping;
  }

  /** Test helper: delayed jobs still waiting. */
  pendingDelayed(): { queue: QueueName; jobId: string; runAt: Date }[] {
    return this.pending.all().map((r) => ({
      queue: r.queue,
      jobId: r.job_key ? r.job_key.slice(r.job_key.indexOf("/") + 1) : "",
      runAt: new Date(r.run_at)
    }));
  }

  /** Wait until nothing that is due remains and nothing is running. */
  async drain(): Promise<void> {
    for (;;) {
      await this.runDue();
      if (this.running.size > 0) await Promise.allSettled([...this.running]);
      const now = this.clock.now().toISOString();
      if (this.running.size === 0 && this.due.all(now, 1).length === 0) return;
    }
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
    await this.drain();
    this.closed = true;
  }

  private async pump(): Promise<number> {
    let count = 0;
    for (;;) {
      const batch = this.due.all(this.clock.now().toISOString(), 50);
      if (batch.length === 0) return count;
      for (const job of batch) {
        if (this.claim.run(nowIso(), job.id).changes !== 1) continue;
        count += 1;
        const run = this.execute(job).finally(() => this.running.delete(run));
        this.running.add(run);
        await run; // jobs run one at a time — SQLite has one writer anyway
      }
    }
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.queue);
    if (!handler) {
      this.fail.run("no handler registered", nowIso(), job.id);
      this.logger.warn({ queue: job.queue, name: job.name }, "no handler registered for queue; job failed");
      return;
    }
    try {
      await handler({ name: job.name, data: JSON.parse(job.data) as unknown });
      this.finish.run(nowIso(), job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const left = job.attempts_left - 1;
      if (left > 0) {
        const delay = BACKOFF_BASE_MS * 2 ** Math.max(0, 2 - left);
        const runAt = new Date(this.clock.now().getTime() + delay).toISOString();
        this.retry.run(runAt, left, message, nowIso(), job.id);
        this.logger.warn({ err, queue: job.queue, name: job.name, attemptsLeft: left }, "job failed; will retry");
      } else {
        this.fail.run(message, nowIso(), job.id);
        this.logger.error({ err, queue: job.queue, name: job.name }, "job exhausted retries");
      }
    }
  }
}
