import type { AdminDto, AdminRole, AuthResultDto } from "@vsev/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { api, hasToken, setToken, setUnauthorizedHandler } from "./api";

interface AdminAuth {
  admin: AdminDto | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): void;
  can(...roles: AdminRole[]): boolean;
}
const Ctx = createContext<AdminAuth | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [admin, setAdmin] = useState<AdminDto | null>(null);
  const [ready, setReady] = useState(false);
  /** Local sign-out only (the server already rejected the token). */
  const clear = useCallback(() => {
    setToken(null);
    setAdmin(null);
  }, []);

  /** Ends the session on the server first, so a copied token is useless too. */
  const logout = useCallback(() => {
    void api.post("/auth/logout").catch(() => undefined).finally(clear);
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    if (!hasToken()) return setReady(true);
    api.get<AdminDto>("/auth/me").then(setAdmin).catch(() => setToken(null)).finally(() => setReady(true));
  }, [clear]);

  const value = useMemo<AdminAuth>(
    () => ({
      admin,
      ready,
      logout,
      can: (...roles) => admin !== null && roles.includes(admin.role),
      async login(email, password) {
        const res = await api.post<AuthResultDto<AdminDto>>("/auth/login", { email, password });
        setToken(res.token);
        setAdmin(res.user);
      }
    }),
    [admin, ready, logout]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminAuth {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAdmin outside provider");
  return c;
}
