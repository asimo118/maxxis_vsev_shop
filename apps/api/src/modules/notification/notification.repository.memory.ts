import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { NotificationRepository } from "./notification.repository";

export function createMemoryNotificationRepository(store: MemoryStore): NotificationRepository {
  return {
    async listTemplates() {
      return [...store.templates.values()];
    },
    async findTemplate(kind) {
      return store.templates.get(kind) ?? null;
    },
    async upsertTemplate(template) {
      store.templates.set(template.kind, { ...template });
      return { ...template };
    },
    async addLog(entry) {
      if (entry.dedupeKey && store.logs.some((l) => l.dedupeKey === entry.dedupeKey)) return false;
      store.logs.push({ ...entry, id: randomUUID(), createdAt: new Date() });
      return true;
    },
    async hasLog(dedupeKey) {
      return store.logs.some((l) => l.dedupeKey === dedupeKey);
    },
    async listLogs(limit) {
      return [...store.logs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
    }
  };
}
