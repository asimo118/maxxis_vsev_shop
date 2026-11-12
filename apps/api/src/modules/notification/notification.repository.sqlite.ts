import { randomUUID } from "node:crypto";
import type { NotificationKind } from "@vsev/shared";
import { fromBool, nowIso, toBool, toDate, type SqliteDb } from "../../platform/sqlite";
import type { NotificationLogRecord, NotificationRepository, TemplateRecord } from "./notification.repository";

interface TemplateRow {
  kind: NotificationKind;
  title: string;
  body: string;
  enabled: number;
}
interface LogRow {
  id: string;
  kind: NotificationKind;
  user_id: string;
  order_id: string | null;
  channel: string;
  status: "sent" | "failed";
  title: string;
  body: string;
  dedupe_key: string | null;
  created_at: string;
}

const toTemplate = (r: TemplateRow): TemplateRecord => ({
  kind: r.kind,
  title: r.title,
  body: r.body,
  enabled: toBool(r.enabled)
});
const toLog = (r: LogRow): NotificationLogRecord => ({
  id: r.id,
  kind: r.kind,
  userId: r.user_id,
  orderId: r.order_id,
  channel: r.channel,
  status: r.status,
  title: r.title,
  body: r.body,
  dedupeKey: r.dedupe_key,
  createdAt: toDate(r.created_at)
});

export function createSqliteNotificationRepository(db: SqliteDb): NotificationRepository {
  const list = db.prepare<[], TemplateRow>("SELECT * FROM notification_templates ORDER BY rowid");
  const find = db.prepare<[NotificationKind], TemplateRow>("SELECT * FROM notification_templates WHERE kind = ?");
  const upsert = db.prepare<[NotificationKind, string, string, number], TemplateRow>(
    `INSERT INTO notification_templates (kind, title, body, enabled) VALUES (?, ?, ?, ?)
     ON CONFLICT (kind) DO UPDATE SET title = excluded.title, body = excluded.body, enabled = excluded.enabled
     RETURNING *`
  );
  const addLog = db.prepare<
    [string, NotificationKind, string, string | null, string, string, string, string, string | null, string]
  >(
    `INSERT INTO notification_logs (id, kind, user_id, order_id, channel, status, title, body, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (dedupe_key) DO NOTHING`
  );
  const hasLog = db.prepare<[string], { hit: number }>("SELECT 1 AS hit FROM notification_logs WHERE dedupe_key = ?");
  const logs = db.prepare<[number], LogRow>(
    "SELECT * FROM notification_logs ORDER BY created_at DESC, rowid DESC LIMIT ?"
  );

  return {
    async listTemplates() {
      return list.all().map(toTemplate);
    },
    async findTemplate(kind) {
      const row = find.get(kind);
      return row ? toTemplate(row) : null;
    },
    async upsertTemplate(t) {
      const row = upsert.get(t.kind, t.title, t.body, fromBool(t.enabled));
      if (!row) throw new Error("upsert notification_templates returned no row");
      return toTemplate(row);
    },
    async addLog(e) {
      return (
        addLog.run(randomUUID(), e.kind, e.userId, e.orderId, e.channel, e.status, e.title, e.body, e.dedupeKey, nowIso())
          .changes === 1
      );
    },
    async hasLog(dedupeKey) {
      return hasLog.get(dedupeKey) !== undefined;
    },
    async listLogs(limit) {
      return logs.all(limit).map(toLog);
    }
  };
}
