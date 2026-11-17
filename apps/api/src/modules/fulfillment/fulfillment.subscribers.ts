import { DAY_MS } from "../../platform/clock";
import type { QueueDriver } from "../../platform/queue";
import type { FulfillmentService } from "./fulfillment.service";

/** Registers the nightly overdue sweep on the `fulfillment` queue. */
export async function registerFulfillmentJobs(deps: {
  queue: QueueDriver;
  fulfillment: FulfillmentService;
}): Promise<void> {
  deps.queue.process("fulfillment", async (job) => {
    if (job.name === "expire-overdue") await deps.fulfillment.expireOverdue();
  });
  await deps.queue.schedule("fulfillment", "expire-overdue-daily", DAY_MS, "expire-overdue", {});
}
