import type { NotificationKind } from "@vsev/shared";

export interface TemplateRecord {
  kind: NotificationKind;
  title: string;
  body: string;
  enabled: boolean;
}

export interface NotificationLogRecord {
  id: string;
  kind: NotificationKind;
  userId: string;
  orderId: string | null;
  channel: string;
  status: "sent" | "failed";
  title: string;
  body: string;
  /** Unique when set — makes a send idempotent (e.g. one reminder per order per day-count). */
  dedupeKey: string | null;
  createdAt: Date;
}

export type NewNotificationLog = Omit<NotificationLogRecord, "id" | "createdAt">;

export interface NotificationRepository {
  listTemplates(): Promise<TemplateRecord[]>;
  findTemplate(kind: NotificationKind): Promise<TemplateRecord | null>;
  upsertTemplate(template: TemplateRecord): Promise<TemplateRecord>;
  /** Returns false when `dedupeKey` was already logged. */
  addLog(entry: NewNotificationLog): Promise<boolean>;
  hasLog(dedupeKey: string): Promise<boolean>;
  listLogs(limit: number): Promise<NotificationLogRecord[]>;
}
