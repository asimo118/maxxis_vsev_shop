import {
  NOTIFICATION_KINDS,
  OPEN_FOR_INSTALL,
  type NotificationKind,
  type NotificationLogDto,
  type NotificationTemplateDto,
  type OrderEventPayload,
  type TemplateUpdateBody
} from "@vsev/shared";
import { DAY_MS } from "../../platform/clock";
import { errors } from "../../platform/errors";
import type { Logger } from "../../platform/logger";
import type { AuthService } from "../auth/auth.service";
import type { OrderService } from "../order/order.service";
import type { NotificationRepository } from "./notification.repository";

/** Port for a delivery channel (LINE, email, SMS …). Only a console adapter ships. */
export interface NotificationChannel {
  readonly name: string;
  send(msg: { userId: string; email: string; title: string; body: string }): Promise<void>;
}

export class ConsoleChannel implements NotificationChannel {
  readonly name = "console";
  constructor(private readonly logger: Logger) {}
  async send(msg: { userId: string; email: string; title: string; body: string }): Promise<void> {
    this.logger.info({ to: msg.email, title: msg.title }, "notification (console channel)");
  }
}

export const REMINDER_DAYS = [14, 3, 1] as const;

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
}

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });

export interface NotificationServiceDeps {
  repo: NotificationRepository;
  auth: AuthService;
  orders: OrderService;
  channel: NotificationChannel;
  logger: Logger;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  /** Idempotent per dedupeKey: the same event replayed never sends twice. */
  async send(kind: NotificationKind, payload: OrderEventPayload, extra: Record<string, string> = {}, dedupeKey?: string) {
    const key = dedupeKey ?? `${kind}__${payload.orderId}`;
    if (await this.deps.repo.hasLog(key)) return;
    const template = await this.deps.repo.findTemplate(kind);
    if (!template || !template.enabled) return;
    const user = await this.deps.auth.getUser(payload.userId);
    if (!user) return;

    const vars: Record<string, string> = {
      name: user.name,
      number: payload.orderNumber,
      shopName: payload.shopName,
      installDeadline: fmtDate(payload.installDeadline),
      slotAt: payload.slotAt ? fmtDateTime(payload.slotAt) : "",
      ...extra
    };
    const title = renderTemplate(template.title, vars);
    const body = renderTemplate(template.body, vars);

    let status: "sent" | "failed" = "sent";
    try {
      await this.deps.channel.send({ userId: user.id, email: user.email, title, body });
    } catch (err) {
      status = "failed";
      this.deps.logger.error({ err, kind, orderId: payload.orderId }, "notification channel failed");
    }
    await this.deps.repo.addLog({
      kind, userId: user.id, orderId: payload.orderId, channel: this.deps.channel.name,
      status, title, body, dedupeKey: key
    });
  }

  /** Reminder job: only fires if the order is still waiting for install. */
  async sendReminder(orderId: string, daysLeft: number): Promise<void> {
    const order = await this.deps.orders.getById(orderId);
    if (!OPEN_FOR_INSTALL.includes(order.status)) return;
    await this.send(
      "install_reminder",
      {
        orderId: order.id, orderNumber: order.number, userId: order.userId, campaignId: order.campaignId,
        shopId: order.shopId, shopName: order.shopName, amountCents: order.amountCents,
        referredByUserId: order.referredByUserId, from: null, to: order.status,
        installDeadline: order.installDeadline.toISOString(), slotAt: null, occurredAt: new Date().toISOString()
      },
      { daysLeft: String(daysLeft) },
      `install_reminder__${orderId}__${daysLeft}`
    );
  }

  reminderPlan(installDeadline: Date, now: Date): { daysLeft: number; delayMs: number }[] {
    return REMINDER_DAYS.map((d) => ({ daysLeft: d, delayMs: installDeadline.getTime() - d * DAY_MS - now.getTime() }))
      .filter((r) => r.delayMs > 0);
  }

  /* admin */
  async listTemplates(): Promise<NotificationTemplateDto[]> {
    const rows = await this.deps.repo.listTemplates();
    return NOTIFICATION_KINDS.map((k) => rows.find((r) => r.kind === k)).filter((r) => r !== undefined)
      .map((r) => ({ kind: r.kind, title: r.title, body: r.body, enabled: r.enabled }));
  }

  async updateTemplate(kind: string, body: TemplateUpdateBody): Promise<NotificationTemplateDto> {
    const known = NOTIFICATION_KINDS.find((k) => k === kind);
    if (!known) throw errors.notFound("找不到這個通知範本。");
    const saved = await this.deps.repo.upsertTemplate({ kind: known, ...body });
    return { kind: saved.kind, title: saved.title, body: saved.body, enabled: saved.enabled };
  }

  async listLogs(limit = 100): Promise<NotificationLogDto[]> {
    return (await this.deps.repo.listLogs(limit)).map((l) => ({
      id: l.id, kind: l.kind, userId: l.userId, channel: l.channel, status: l.status,
      title: l.title, createdAt: l.createdAt.toISOString()
    }));
  }
}
