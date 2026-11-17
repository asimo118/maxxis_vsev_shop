import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  campaignContentSchema,
  canTransition,
  createOrderBody,
  evaluateCtaGate,
  formatTWD,
  isTerminal,
  ntd,
  progressIndex,
  SEED_CAMPAIGN_CONTENT,
  SEED_SHOPS
} from "./index";

describe("money", () => {
  it("keeps integers and formats NT$", () => {
    expect(ntd(32_800)).toBe(3_280_000);
    expect(formatTWD(3_280_000)).toBe("NT$ 32,800");
    expect(formatTWD(0)).toBe("NT$ 0");
  });
  it("rejects floats", () => {
    expect(() => ntd(10.5)).toThrow(RangeError);
    expect(() => formatTWD(10.5)).toThrow(RangeError);
  });
});

describe("order state machine", () => {
  it("defines a row for every status", () => {
    for (const s of ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toBeDefined();
  });
  it("allows the happy path end to end", () => {
    const path = ["created", "paid", "shipped", "arrived_at_shop", "booked", "installed", "warranty_active"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it("blocks skipping steps and leaving terminal states", () => {
    expect(canTransition("paid", "installed")).toBe(false);
    expect(canTransition("created", "shipped")).toBe(false);
    expect(canTransition("warranty_active", "installed")).toBe(false);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("paid")).toBe(false);
  });
  it("lets a missed booking fall back to arrived_at_shop", () => {
    expect(canTransition("booked", "arrived_at_shop")).toBe(true);
  });
  it("maps statuses onto the progress rail", () => {
    expect(progressIndex("paid")).toBe(0);
    expect(progressIndex("warranty_active")).toBe(4);
    expect(progressIndex("cancelled")).toBe(-1);
  });
});

describe("CTA gate", () => {
  const price = "NT$ 32,800";
  it("prompts the first missing step in order", () => {
    expect(evaluateCtaGate({ deadlineAcknowledged: false, priceLabel: price }).label).toBe("請先選擇車型");
    expect(evaluateCtaGate({ vehicleModelId: "m", deadlineAcknowledged: false, priceLabel: price }).label).toBe("請選擇安裝店家");
    expect(evaluateCtaGate({ vehicleModelId: "m", shopId: "s", deadlineAcknowledged: false, priceLabel: price }).label).toBe("請確認安裝期限");
  });
  it("is ready only when all three conditions hold", () => {
    const r = evaluateCtaGate({ vehicleModelId: "m", shopId: "s", deadlineAcknowledged: true, priceLabel: price });
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.label).toBe("加入購物車・NT$ 32,800");
  });
  it("is not ready when the shop is missing even if the rest is set", () => {
    const r = evaluateCtaGate({ vehicleModelId: "m", deadlineAcknowledged: true, priceLabel: price });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["shop"]);
  });
});

describe("schemas and seed", () => {
  it("createOrderBody enforces the deadline acknowledgement and normalises the plate", () => {
    const base = { campaignSlug: "c", vehicleModelId: "m", plate: "abc-1234", shopId: "s" };
    expect(createOrderBody.safeParse({ ...base, deadlineAcknowledged: false }).success).toBe(false);
    const ok = createOrderBody.parse({ ...base, deadlineAcknowledged: true });
    expect(ok.plate).toBe("ABC-1234");
  });
  it("ships a valid campaign content blob and 19 shops", () => {
    expect(campaignContentSchema.safeParse(SEED_CAMPAIGN_CONTENT).success).toBe(true);
    expect(SEED_SHOPS).toHaveLength(19);
  });
});
