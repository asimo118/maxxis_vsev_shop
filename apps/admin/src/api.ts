import { createApiClient } from "@vsev/shared";

const KEY = "vsev.admin.token";
let token: string | null = null;
try {
  token = localStorage.getItem(KEY);
} catch {
  /* storage unavailable */
}
let onUnauthorized: () => void = () => undefined;

export const api = createApiClient({ baseUrl: "/api/v1/admin", getToken: () => token, onUnauthorized: () => onUnauthorized() });

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export const hasToken = (): boolean => token !== null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "發生未知錯誤。";
}
export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
