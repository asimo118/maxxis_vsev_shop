import jwt from "jsonwebtoken";

/**
 * Two completely separate trust domains: different secrets AND different `aud` claims.
 * A storefront token can never authenticate against /admin, and vice versa.
 */
export type TokenAudience = "storefront" | "admin";

export interface TokenService {
  sign(audience: TokenAudience, subject: string): string;
  /** Returns the subject, or null for any invalid / expired / wrong-audience token. */
  verify(audience: TokenAudience, token: string): string | null;
}

const TTL_SECONDS: Record<TokenAudience, number> = {
  storefront: 7 * 24 * 3600,
  admin: 12 * 3600
};

export function createTokenService(secrets: Record<TokenAudience, string>): TokenService {
  return {
    sign(audience, subject) {
      return jwt.sign({}, secrets[audience], {
        subject,
        audience,
        issuer: "vsev",
        expiresIn: TTL_SECONDS[audience]
      });
    },
    verify(audience, token) {
      try {
        const payload = jwt.verify(token, secrets[audience], { audience, issuer: "vsev" });
        return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
      } catch {
        return null;
      }
    }
  };
}
