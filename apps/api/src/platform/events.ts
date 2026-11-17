import type { DomainEventMap, DomainEventName } from "@vsev/shared";
import type { Logger } from "./logger";

type Handler<K extends DomainEventName> = (payload: DomainEventMap[K]) => Promise<void> | void;

export interface EventBus {
  publish<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): Promise<void>;
  subscribe<K extends DomainEventName>(name: K, handler: Handler<K>): void;
}

/**
 * In-process domain event bus. Subscribers are isolated: one failing never fails the publisher
 * (the order transition has already committed). Subscribers that do real work enqueue a queue job.
 */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<DomainEventName, Handler<DomainEventName>[]>();

  constructor(private readonly logger: Logger) {}

  subscribe<K extends DomainEventName>(name: K, handler: Handler<K>): void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as unknown as Handler<DomainEventName>);
    this.handlers.set(name, list);
  }

  async publish<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): Promise<void> {
    const list = this.handlers.get(name) ?? [];
    const results = await Promise.allSettled(
      list.map(async (handler) => handler(payload as DomainEventMap[DomainEventName]))
    );
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.error({ err: result.reason, event: name }, "domain event subscriber failed");
      }
    }
  }
}
