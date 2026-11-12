import type { OrderEventPayload } from "@vsev/shared";
import type { EventBus } from "../../platform/events";
import type { QueueDriver } from "../../platform/queue";
import type { NotificationService } from "./notification.service";

type Job =
  | { type: "send"; kind: "order_paid" | "order_shipped" | "order_arrived" | "booking_confirmed" | "warranty_active"; payload: OrderEventPayload }
  | { type: "reminder"; orderId: string; daysLeft: number };

const OPEN_END = ["installed", "cancelled", "refunded", "expired"] as const;

export function registerNotificationSubscribers(deps: {
  events: EventBus;
  queue: QueueDriver;
  notifications: NotificationService;
  now: () => Date;
}): void {
  const { events, queue, notifications } = deps;

  queue.process<Job>("notifications", async (job) => {
    const d = job.data;
    if (d.type === "send") await notifications.send(d.kind, d.payload);
  });
  queue.process<Job>("reminders", async (job) => {
    const d = job.data;
    if (d.type === "reminder") await notifications.sendReminder(d.orderId, d.daysLeft);
  });

  const direct = (
    name: "order.paid" | "order.shipped" | "order.arrived_at_shop" | "order.booked" | "order.warranty_active",
    kind: Extract<Job, { type: "send" }>["kind"]
  ): void => {
    events.subscribe(name, (payload) =>
      queue.enqueue("notifications", "send", { type: "send", kind, payload } satisfies Job, {
        jobId: `${kind}__${payload.orderId}`
      })
    );
  };
  direct("order.paid", "order_paid");
  direct("order.shipped", "order_shipped");
  direct("order.arrived_at_shop", "order_arrived");
  direct("order.booked", "booking_confirmed");
  direct("order.warranty_active", "warranty_active");

  // Schedule deadline reminders once the order is paid; cancel when it can no longer be installed.
  events.subscribe("order.paid", async (payload) => {
    for (const r of notifications.reminderPlan(new Date(payload.installDeadline), deps.now())) {
      await queue.enqueue("reminders", "reminder",
        { type: "reminder", orderId: payload.orderId, daysLeft: r.daysLeft } satisfies Job,
        { jobId: `remind__${payload.orderId}__${r.daysLeft}`, delayMs: r.delayMs });
    }
  });
  for (const end of OPEN_END) {
    events.subscribe(`order.${end}`, async (payload) => {
      for (const d of [14, 3, 1]) await queue.cancel("reminders", `remind__${payload.orderId}__${d}`);
    });
  }
}
