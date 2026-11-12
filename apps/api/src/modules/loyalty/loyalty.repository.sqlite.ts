import { randomUUID } from "node:crypto";
import type { PointsReason } from "@vsev/shared";
import { nowIso, toDate, type SqliteDb } from "../../platform/sqlite";
import type { LoyaltyRepository, PointsEntryRecord } from "./loyalty.repository";

interface EntryRow {
  id: string;
  user_id: string;
  delta: number;
  reason: PointsReason;
  ref_id: string | null;
  note: string | null;
  actor: string;
  created_at: string;
}

const toEntry = (r: EntryRow): PointsEntryRecord => ({
  id: r.id,
  userId: r.user_id,
  delta: r.delta,
  reason: r.reason,
  refId: r.ref_id,
  note: r.note,
  actor: r.actor,
  createdAt: toDate(r.created_at)
});

export function createSqliteLoyaltyRepository(db: SqliteDb): LoyaltyRepository {
  // UNIQUE (reason, ref_id) makes a replayed award a no-op — the ledger can never double-pay.
  const addEntry = db.prepare<[string, string, number, PointsReason, string | null, string | null, string, string], EntryRow>(
    `INSERT INTO points_ledger (id, user_id, delta, reason, ref_id, note, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (reason, ref_id) DO NOTHING
     RETURNING *`
  );
  const balance = db.prepare<[string], { total: number }>(
    "SELECT COALESCE(SUM(delta), 0) AS total FROM points_ledger WHERE user_id = ?"
  );
  const list = db.prepare<[string, number], EntryRow>(
    "SELECT * FROM points_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
  );
  const codeOf = db.prepare<[string], { code: string }>("SELECT code FROM referral_codes WHERE user_id = ?");
  const userOf = db.prepare<[string], { user_id: string }>("SELECT user_id FROM referral_codes WHERE code = ?");
  const createCode = db.prepare<[string, string, string]>(
    "INSERT OR IGNORE INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)"
  );

  return {
    async addEntry(entry) {
      const row = addEntry.get(
        randomUUID(), entry.userId, entry.delta, entry.reason, entry.refId, entry.note, entry.actor, nowIso()
      );
      return row ? toEntry(row) : null;
    },
    async balance(userId) {
      return balance.get(userId)?.total ?? 0;
    },
    async listEntries(userId, limit) {
      return list.all(userId, limit).map(toEntry);
    },
    async findCode(userId) {
      return codeOf.get(userId)?.code ?? null;
    },
    async findUserByCode(code) {
      return userOf.get(code)?.user_id ?? null;
    },
    async createCode(userId, code) {
      return createCode.run(userId, code, nowIso()).changes === 1;
    }
  };
}
