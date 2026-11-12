import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Logger } from "./logger";
import type { JobHandler, JobOptions, QueueDriver, QueueName } from "./queue";

function connectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null
  };
}

/** Production queue driver: BullMQ on Redis. Queue names are prefixed to avoid collisions. */
export class BullMqQueueDriver implements QueueDriver {
  private readonly connection: ConnectionOptions;
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    redisUrl: string,
    private readonly logger: Logger
  ) {
    this.connection = connectionFromUrl(redisUrl);
  }

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(`vsev-${name}`, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue<T>(queue: QueueName, name: string, data: T, opts: JobOptions = {}): Promise<void> {
    await this.queue(queue).add(name, data, {
      jobId: opts.jobId,
      delay: opts.delayMs,
      attempts: opts.attempts ?? 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 }
    });
  }

  async cancel(queue: QueueName, jobId: string): Promise<void> {
    const job = await this.queue(queue).getJob(jobId);
    if (job) await job.remove();
  }

  process<T>(queue: QueueName, handler: JobHandler<T>): void {
    const worker = new Worker(
      `vsev-${queue}`,
      async (job) => handler({ name: job.name, data: job.data as T }),
      { connection: this.connection }
    );
    worker.on("failed", (job, err) => {
      this.logger.warn({ err, queue, name: job?.name, attemptsMade: job?.attemptsMade }, "job failed");
    });
    this.workers.push(worker);
  }

  async schedule(queue: QueueName, schedulerId: string, everyMs: number, name: string, data: unknown): Promise<void> {
    await this.queue(queue).upsertJobScheduler(schedulerId, { every: everyMs }, { name, data: data as object });
  }

  async drain(): Promise<void> {
    /* BullMQ workers run independently; nothing to wait for. */
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
