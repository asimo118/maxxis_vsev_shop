const TZ = "Asia/Taipei";
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("zh-TW", { timeZone: TZ, month: "2-digit", day: "2-digit", year: "numeric" });
export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-TW", { timeZone: TZ, hour12: false });
export const fmtMonthDay = (iso: string): string => {
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: TZ }));
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "發生未知錯誤。";
}
/** Stable per-tab id for the anonymous funnel beacon. */
export function sessionId(): string {
  try {
    let id = sessionStorage.getItem("vsev.sid");
    if (!id) {
      id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("vsev.sid", id);
    }
    return id;
  } catch {
    return `s${Math.random().toString(36).slice(2, 14)}`;
  }
}

/** Who did it, in customer-facing words (audit actor ids are "user:…", "admin:…", "system", "gateway", "commerce"). */
export function actorLabel(actor: string): string {
  if (actor.startsWith("user:")) return "你";
  if (actor.startsWith("admin:")) return "客服";
  return "系統";
}

/** A Date → value for <input type="datetime-local"> in Taipei time (Taiwan has no DST). */
export function toTaipeiLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 16);
}
/** <input type="datetime-local"> value, read as Taipei time → UTC ISO string. */
export function fromTaipeiLocalInput(value: string): string {
  return new Date(`${value}:00+08:00`).toISOString();
}
