import type { AuthResultDto, LoginBody, RegisterBody, UserDto } from "@vsev/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { api, readToken, setSessionToken, setUnauthorizedHandler } from "./api";

interface AuthState {
  user: UserDto | null;
  ready: boolean;
  login(body: LoginBody): Promise<void>;
  register(body: RegisterBody): Promise<void>;
  logout(): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);

  /** Local sign-out only (the server already rejected the token). */
  const clear = useCallback(() => {
    setSessionToken(null);
    setUser(null);
  }, []);

  /** Ends the session on the server first, so the token is useless even if it was copied. */
  const logout = useCallback(() => {
    void api.post("/auth/logout").catch(() => undefined).finally(clear);
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    if (!readToken()) {
      setReady(true);
      return;
    }
    api
      .get<UserDto>("/auth/me")
      .then(setUser)
      .catch(() => setSessionToken(null))
      .finally(() => setReady(true));
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      logout,
      async login(body) {
        const res = await api.post<AuthResultDto<UserDto>>("/auth/login", body);
        setSessionToken(res.token);
        setUser(res.user);
      },
      async register(body) {
        const res = await api.post<AuthResultDto<UserDto>>("/auth/register", body);
        setSessionToken(res.token);
        setUser(res.user);
      }
    }),
    [user, ready, logout]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
