import jwt from "jsonwebtoken";

/**
 * Two completely separate trust domains: different secrets AND different `aud` claims.
 * A storefront token can never authenticate against /admin, and vice versa.
 *
 * Every token names a server-side session (`jti`). The signature only proves the token is ours; the auth
 * service additionally checks that the session is still open, so logout and password changes end it at once.
 */
export type TokenAudience = "storefront" | "admin";

export interface TokenClaims {
  subject: string;
  sessionId: string;
}

export interface TokenService {
  sign(audience: TokenAudience, subject: string, sessionId: string): string;
  /** Returns the claims, or null for any invalid / expired / wrong-audience / session-less token. */
  verify(audience: TokenAudience, token: string): TokenClaims | null;
  ttlSeconds(audience: TokenAudience): number;
}

const TTL_SECONDS: Record<TokenAudience, number> = {
  storefront: 7 * 24 * 3600,
  admin: 12 * 3600
};

export function createTokenService(secrets: Record<TokenAudience, string>): TokenService {
  return {
    sign(audience, subject, sessionId) {
      return jwt.sign({}, secrets[audience], {
        algorithm: "HS256",
        subject,
        audience,
        jwtid: sessionId,
        issuer: "vsev",
        expiresIn: TTL_SECONDS[audience]
      });
    },
    verify(audience, token) {
      try {
        const payload = jwt.verify(token, secrets[audience], { algorithms: ["HS256"], audience, issuer: "vsev" });
        if (typeof payload !== "object" || typeof payload.sub !== "string" || typeof payload.jti !== "string") return null;
        return { subject: payload.sub, sessionId: payload.jti };
      } catch {
        return null;
      }
    },
    ttlSeconds(audience) {
      return TTL_SECONDS[audience];
    }
  };
}
