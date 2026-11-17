import type { PointsReason } from "@vsev/shared";

export interface PointsEntryRecord {
  id: string;
  userId: string;
  /** Signed integer. A balance is always the SUM of deltas — there is no balance column. */
  delta: number;
  reason: PointsReason;
  /** Business reference (e.g. order id). With `reason` it is unique → posting is idempotent. */
  refId: string | null;
  note: string | null;
  actor: string;
  createdAt: Date;
}

export type NewPointsEntry = Omit<PointsEntryRecord, "id" | "createdAt">;

export interface LoyaltyRepository {
  /** Append-only. Returns null when the same (reason, refId) was already posted. */
  addEntry(entry: NewPointsEntry): Promise<PointsEntryRecord | null>;
  balance(userId: string): Promise<number>;
  listEntries(userId: string, limit: number): Promise<PointsEntryRecord[]>;
  findCode(userId: string): Promise<string | null>;
  findUserByCode(code: string): Promise<string | null>;
  /** Returns false when the user already has a code or the code is taken. */
  createCode(userId: string, code: string): Promise<boolean>;
}
