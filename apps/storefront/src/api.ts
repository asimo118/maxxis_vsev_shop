import { createApiClient } from "@vsev/shared";

const TOKEN_KEY = "vsev.token";

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — session lasts until reload */
  }
}

let memoryToken: string | null = readToken();
let onUnauthorized: () => void = () => undefined;

export const api = createApiClient({
  baseUrl: "/api/v1",
  getToken: () => memoryToken,
  onUnauthorized: () => onUnauthorized()
});

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  writeToken(token);
}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}
