import type { OrderEventPayload } from "@vsev/shared";
import type { EventBus } from "../../platform/events";
import type { QueueDriver } from "../../platform/queue";
import type { MaintenanceService } from "./maintenance.service";

export function registerMaintenanceSubscribers(deps: { events: EventBus; queue: QueueDriver; maintenance: MaintenanceService }): void {
  deps.queue.process<OrderEventPayload>("maintenance", async (job) => {
    if (job.name === "open-profile") await deps.maintenance.openProfile(job.data);
  });
  deps.events.subscribe("order.warranty_active", (payload) =>
    deps.queue.enqueue("maintenance", "open-profile", payload, { jobId: `profile__${payload.orderId}` })
  );
}
