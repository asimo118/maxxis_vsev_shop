import type { Clock } from "./clock";
import type { Logger } from "./logger";

export const QUEUE_NAMES = ["notifications", "reminders", "loyalty", "maintenance", "fulfillment", "connectors"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface JobOptions {
  /** Delay before the job becomes runnable. */
  delayMs?: number;
  /** Idempotency key. NOTE: BullMQ forbids ":" in custom ids — use "__" separators. */
  jobId?: string;
  attempts?: number;
}

export interface Job<T = unknown> {
  name: string;
  data: T;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

/**
 * Port for async side effects. Production uses BullMQ on Redis; dev/tests use the in-process driver.
 * Handlers MUST be idempotent — every driver may deliver a job more than once.
 */
export interface QueueDriver {
  enqueue<T>(queue: QueueName, name: string, data: T, opts?: JobOptions): Promise<void>;
  /** Remove a not-yet-run delayed job (e.g. reminders once the tire is installed). */
  cancel(queue: QueueName, jobId: string): Promise<void>;
  process<T>(queue: QueueName, handler: JobHandler<T>): void;
  /** Repeating job (e.g. nightly overdue-order sweep). */
  schedule(queue: QueueName, schedulerId: string, everyMs: number, name: string, data: unknown): Promise<void>;
  /** Wait until currently running jobs finish (tests). No-op for BullMQ. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

interface DelayedJob {
  queue: QueueName;
  name: string;
  data: unknown;
  runAt: number;
  attempts: number;
}

/** In-process driver: same contract as BullMQ, no Redis needed. Delayed jobs fire via runDue(). */
export class InlineQueueDriver implements QueueDriver {
  private readonly handlers = new Map<QueueName, JobHandler>();
  private readonly delayed = new Map<string, DelayedJob>();
  private readonly seenIds = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private readonly intervals: NodeJS.Timeout[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly pollMs = 30_000
  ) {}

  process<T>(queue: QueueName, handler: JobHandler<T>): void {
    this.handlers.set(queue, handler as JobHandler);
  }

  /** Start polling for due delayed jobs (server only; tests call runDue() directly). */
  start(): void {
    const timer = setInterval(() => {
      void this.runDue();
    }, this.pollMs);
    timer.unref();
    this.intervals.push(timer);
  }

  async enqueue<T>(queue: QueueName, name: string, data: T, opts: JobOptions = {}): Promise<void> {
    const attempts = opts.attempts ?? 3;
    const key = opts.jobId ? `${queue}/${opts.jobId}` : undefined;
    if (key) {
      if (this.seenIds.has(key) || this.delayed.has(key)) return; // idempotent enqueue
      this.seenIds.add(key);
    }
    if (opts.delayMs && opts.delayMs > 0) {
      const id = key ?? `${queue}/anon-${this.delayed.size}-${this.clock.now().getTime()}`;
      this.delayed.set(id, { queue, name, data, runAt: this.clock.now().getTime() + opts.delayMs, attempts });
      return;
    }
    this.dispatch(queue, name, data, attempts);
  }

  async cancel(queue: QueueName, jobId: string): Promise<void> {
    this.delayed.delete(`${queue}/${jobId}`);
  }

  async schedule(queue: QueueName, _id: string, everyMs: number, name: string, data: unknown): Promise<void> {
    const timer = setInterval(() => this.dispatch(queue, name, data, 1), everyMs);
    timer.unref();
    this.intervals.push(timer);
  }

  /** Run every delayed job whose time has come. Returns how many were dispatched. */
  async runDue(): Promise<number> {
    const now = this.clock.now().getTime();
    let count = 0;
    for (const [key, job] of [...this.delayed.entries()]) {
      if (job.runAt <= now) {
        this.delayed.delete(key);
        this.dispatch(job.queue, job.name, job.data, job.attempts);
        count += 1;
      }
    }
    await this.drain();
    return count;
  }

  /** Test helper: delayed jobs still waiting. */
  pendingDelayed(): { queue: QueueName; jobId: string; runAt: Date }[] {
    return [...this.delayed.entries()].map(([key, job]) => ({
      queue: job.queue,
      jobId: key.slice(key.indexOf("/") + 1),
      runAt: new Date(job.runAt)
    }));
  }

  async drain(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running]);
    }
  }

  async close(): Promise<void> {
    for (const timer of this.intervals) clearInterval(timer);
    this.intervals.length = 0;
    await this.drain();
  }

  private dispatch(queue: QueueName, name: string, data: unknown, attempts: number): void {
    const handler = this.handlers.get(queue);
    if (!handler) {
      this.logger.warn({ queue, name }, "no handler registered for queue; job dropped");
      return;
    }
    const promise = this.runWithRetry(handler, queue, name, data, attempts).finally(() => {
      this.running.delete(promise);
    });
    this.running.add(promise);
  }

  private async runWithRetry(
    handler: JobHandler,
    queue: QueueName,
    name: string,
    data: unknown,
    attempts: number
  ): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await handler({ name, data });
        return;
      } catch (err) {
        this.logger.warn({ err, queue, name, attempt, attempts }, "job failed");
        if (attempt === attempts) this.logger.error({ queue, name }, "job exhausted retries");
      }
    }
  }
}
