import { randomInt } from "node:crypto";
import type { AdjustPointsBody, OrderEventPayload, PointsSummaryDto } from "@vsev/shared";
import { errors } from "../../platform/errors";
import type { AuthService } from "../auth/auth.service";
import type { LoyaltyRepository } from "./loyalty.repository";

/** 1 point per NT$100 of order value — integer arithmetic only (amounts are in cents: NT$100 = 10_000). */
export const CENTS_PER_POINT = 10_000;
export const REFERRAL_REWARD_POINTS = 300;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L ambiguity
const CODE_LENGTH = 8;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * Loyalty is BACKEND-ONLY: there is no client path that writes points or validates a referral code.
 * Points are an append-only ledger; a balance is always the sum of deltas. Awards are idempotent
 * on (reason, refId), so a replayed queue job can never double-pay.
 */
export class LoyaltyService {
  constructor(private readonly deps: { repo: LoyaltyRepository; auth: AuthService }) {}

  async ensureReferralCode(userId: string): Promise<string> {
    const existing = await this.deps.repo.findCode(userId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await this.deps.repo.createCode(userId, randomCode())) break;
      const raced = await this.deps.repo.findCode(userId); // someone else created it concurrently
      if (raced) return raced;
    }
    const code = await this.deps.repo.findCode(userId);
    if (!code) throw errors.conflict("無法產生推薦碼，請稍後再試。");
    return code;
  }

  /** Server-side referral validation. Unknown codes and self-referral are rejected with E2007. */
  async resolveReferrer(code: string, buyerUserId: string): Promise<string> {
    const referrerId = await this.deps.repo.findUserByCode(code.trim().toUpperCase());
    if (!referrerId || referrerId === buyerUserId) throw errors.referralInvalid();
    return referrerId;
  }

  /** Runs when an order reaches warranty_active (the Shopper → Owner hand-off). */
  async awardForWarranty(payload: OrderEventPayload): Promise<void> {
    const purchasePoints = Math.floor(payload.amountCents / CENTS_PER_POINT);
    if (purchasePoints > 0) {
      await this.deps.repo.addEntry({
        userId: payload.userId,
        delta: purchasePoints,
        reason: "purchase",
        refId: payload.orderId,
        note: `訂單 ${payload.orderNumber} 完成安裝`,
        actor: "system"
      });
    }
    if (payload.referredByUserId) {
      await this.deps.repo.addEntry({
        userId: payload.referredByUserId,
        delta: REFERRAL_REWARD_POINTS,
        reason: "referral",
        refId: payload.orderId,
        note: `推薦的訂單 ${payload.orderNumber} 完成安裝`,
        actor: "system"
      });
    }
    await this.ensureReferralCode(payload.userId);
  }

  async summary(userId: string): Promise<PointsSummaryDto> {
    const [balance, referralCode, entries] = await Promise.all([
      this.deps.repo.balance(userId),
      this.deps.repo.findCode(userId),
      this.deps.repo.listEntries(userId, 50)
    ]);
    return {
      balance,
      referralCode,
      entries: entries.map((e) => ({
        id: e.id,
        delta: e.delta,
        reason: e.reason,
        note: e.note,
        createdAt: e.createdAt.toISOString()
      }))
    };
  }

  /** Manual correction by a manager. Always leaves an audit row naming the admin; can never drive a balance below 0. */
  async adjust(adminId: string, body: AdjustPointsBody): Promise<PointsSummaryDto> {
    if (!(await this.deps.auth.getUser(body.userId))) throw errors.notFound("找不到這位會員。");
    const balance = await this.deps.repo.balance(body.userId);
    if (balance + body.delta < 0) throw errors.insufficientPoints();
    await this.deps.repo.addEntry({
      userId: body.userId,
      delta: body.delta,
      reason: "adjustment",
      refId: null,
      note: body.note,
      actor: `admin:${adminId}`
    });
    return this.summary(body.userId);
  }
}
