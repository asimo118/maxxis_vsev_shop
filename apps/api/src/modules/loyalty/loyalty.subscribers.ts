import type { OrderEventPayload } from "@vsev/shared";
import type { EventBus } from "../../platform/events";
import type { QueueDriver } from "../../platform/queue";
import type { LoyaltyService } from "./loyalty.service";

export function registerLoyaltySubscribers(deps: {
  events: EventBus;
  queue: QueueDriver;
  loyalty: LoyaltyService;
}): void {
  deps.queue.process<OrderEventPayload>("loyalty", async (job) => {
    if (job.name === "award") await deps.loyalty.awardForWarranty(job.data);
  });

  deps.events.subscribe("order.warranty_active", (payload) =>
    deps.queue.enqueue("loyalty", "award", payload, { jobId: `award__${payload.orderId}` })
  );
}
