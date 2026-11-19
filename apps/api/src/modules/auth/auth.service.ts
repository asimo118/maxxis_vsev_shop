import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  ERROR_CODES,
  type AdminAccountDto,
  type AdminChangePasswordBody,
  type AdminCreateBody,
  type AdminDto,
  type AdminRole,
  type AdminUpdateBody,
  type AuthResultDto,
  type ChangePasswordBody,
  type LoginBody,
  type RegisterBody,
  type UserDto
} from "@vsev/shared";
import { AppError, errors } from "../../platform/errors";
import type { TokenAudience, TokenClaims, TokenService } from "../../platform/tokens";
import type { AdminRecord, AuthRepository, UserRecord } from "./auth.repository";

export interface AuthServiceDeps {
  repo: AuthRepository;
  tokens: TokenService;
  bcryptCost: number;
}

const toUserDto = (u: UserRecord): UserDto => ({ id: u.id, email: u.email, name: u.name, phone: u.phone });
const toAdminDto = (a: AdminRecord): AdminDto => ({ id: a.id, email: a.email, name: a.name, role: a.role });

export class AuthService {
  /** Compared against when the email is unknown so login timing does not reveal which emails exist. */
  private dummyHash: Promise<string>;

  constructor(private readonly deps: AuthServiceDeps) {
    this.dummyHash = bcrypt.hash("not-a-real-password", deps.bcryptCost);
  }

  /* ───────────── sessions ───────────── */

  /** Every sign-in opens a server-side session; the token only names it. */
  private async issue(audience: TokenAudience, subjectId: string): Promise<string> {
    const now = new Date();
    const id = randomUUID();
    await this.deps.repo.createSession({
      id,
      audience,
      subjectId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.deps.tokens.ttlSeconds(audience) * 1000)
    });
    await this.deps.repo.deleteExpiredSessions(now); // housekeeping, one indexed delete
    return this.deps.tokens.sign(audience, subjectId, id);
  }

  /**
   * A valid signature is not enough: the session must exist, belong to the token's subject and audience,
   * and be neither revoked (logout, password change, deactivation) nor expired.
   */
  async authenticate(audience: TokenAudience, token: string): Promise<TokenClaims | null> {
    const claims = this.deps.tokens.verify(audience, token);
    if (!claims) return null;
    const session = await this.deps.repo.findSession(claims.sessionId);
    if (!session || session.audience !== audience || session.subjectId !== claims.subject) return null;
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    return claims;
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.repo.revokeSession(sessionId, new Date());
  }

  private async checkCurrentPassword(given: string, hash: string): Promise<void> {
    if (!(await bcrypt.compare(given, hash))) {
      const message = "目前的密碼不正確。";
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, message, [{ path: "currentPassword", message }]);
    }
  }

  /* ───────────── customers ───────────── */

  async register(body: RegisterBody): Promise<AuthResultDto<UserDto>> {
    if (await this.deps.repo.findUserByEmail(body.email)) {
      throw errors.conflict("這個 Email 已經註冊過了，請直接登入。");
    }
    const user = await this.deps.repo.createUser({
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, this.deps.bcryptCost),
      name: body.name,
      phone: body.phone ?? null
    });
    return { token: await this.issue("storefront", user.id), user: toUserDto(user) };
  }

  async login(body: LoginBody): Promise<AuthResultDto<UserDto>> {
    const user = await this.deps.repo.findUserByEmail(body.email);
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !ok) throw errors.unauthenticated();
    return { token: await this.issue("storefront", user.id), user: toUserDto(user) };
  }

  /** CASA 2.1.5/2.1.6/3.3.3: needs the current password; other devices are signed out unless told not to. */
  async changeUserPassword(userId: string, sessionId: string, body: ChangePasswordBody): Promise<{ signedOutSessions: number }> {
    const user = await this.deps.repo.findUserById(userId);
    if (!user) throw errors.unauthenticated();
    await this.checkCurrentPassword(body.currentPassword, user.passwordHash);
    const now = new Date();
    await this.deps.repo.setUserPassword(userId, await bcrypt.hash(body.newPassword, this.deps.bcryptCost), now);
    const signedOutSessions = body.signOutOtherSessions
      ? await this.deps.repo.revokeSessions("storefront", userId, now, sessionId)
      : 0;
    return { signedOutSessions };
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.deps.repo.findUserById(userId);
    if (!user) throw errors.unauthenticated();
    return toUserDto(user);
  }

  async getUser(userId: string): Promise<UserDto | null> {
    const user = await this.deps.repo.findUserById(userId);
    return user ? toUserDto(user) : null;
  }

  async getUsersByIds(ids: string[]): Promise<UserDto[]> {
    if (ids.length === 0) return [];
    return (await this.deps.repo.findUsersByIds(ids)).map(toUserDto);
  }

  async searchUserIds(query: string): Promise<string[]> {
    return (await this.deps.repo.searchUsers(query)).map((u) => u.id);
  }

  /* ───────────── admins ───────────── */

  async adminLogin(body: LoginBody): Promise<AuthResultDto<AdminDto>> {
    const admin = await this.deps.repo.findAdminByEmail(body.email);
    const ok = await bcrypt.compare(body.password, admin?.passwordHash ?? (await this.dummyHash));
    if (!admin || !admin.active || !ok) throw errors.unauthenticated();
    return { token: await this.issue("admin", admin.id), user: toAdminDto(admin) };
  }

  /** Active admins only — a deactivated admin's still-valid token stops working immediately. */
  async getActiveAdmin(adminId: string): Promise<AdminDto | null> {
    const admin = await this.deps.repo.findAdminById(adminId);
    return admin?.active ? toAdminDto(admin) : null;
  }

  async changeAdminPassword(adminId: string, sessionId: string, body: AdminChangePasswordBody): Promise<{ signedOutSessions: number }> {
    const admin = await this.deps.repo.findAdminById(adminId);
    if (!admin?.active) throw errors.unauthenticated();
    await this.checkCurrentPassword(body.currentPassword, admin.passwordHash);
    const now = new Date();
    await this.deps.repo.updateAdmin(adminId, {
      passwordHash: await bcrypt.hash(body.newPassword, this.deps.bcryptCost),
      passwordChangedAt: now
    });
    const signedOutSessions = body.signOutOtherSessions ? await this.deps.repo.revokeSessions("admin", adminId, now, sessionId) : 0;
    return { signedOutSessions };
  }

  /** Manager → 後台帳號. */
  async listAdminAccounts(): Promise<AdminAccountDto[]> {
    const [admins, last] = await Promise.all([this.deps.repo.listAdmins(), this.deps.repo.lastSessionAt("admin")]);
    return admins.map((a) => ({
      ...toAdminDto(a),
      active: a.active,
      createdAt: a.createdAt.toISOString(),
      lastLoginAt: last.get(a.id)?.toISOString() ?? null
    }));
  }

  private async mustFindAdminAccount(id: string): Promise<AdminAccountDto> {
    const found = (await this.listAdminAccounts()).find((a) => a.id === id);
    if (!found) throw errors.notFound();
    return found;
  }

  async createAdmin(body: AdminCreateBody): Promise<AdminAccountDto> {
    if (await this.deps.repo.findAdminByEmail(body.email)) throw errors.conflict("這個 Email 已經有後台帳號。");
    const admin = await this.deps.repo.createAdmin({
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, this.deps.bcryptCost),
      name: body.name,
      role: body.role
    });
    return this.mustFindAdminAccount(admin.id);
  }

  /**
   * Rename, change role, (de)activate. Guards keep the console usable: nobody locks themselves out, and at
   * least one active manager always remains. Deactivation or a role change ends that admin's sessions.
   */
  async updateAdmin(actorId: string, id: string, body: AdminUpdateBody): Promise<AdminAccountDto> {
    const target = await this.deps.repo.findAdminById(id);
    if (!target) throw errors.notFound();
    // Copy what we compare against: a repository may hand back a live object that the update mutates.
    const before = { role: target.role, active: target.active };
    if (id === actorId && (body.active === false || (body.role !== undefined && body.role !== before.role))) {
      throw errors.conflict("不能停用自己或變更自己的角色，請由另一位管理者操作。");
    }
    const losesManager =
      before.role === "manager" && before.active && (body.active === false || (body.role !== undefined && body.role !== "manager"));
    if (losesManager) {
      const managers = (await this.deps.repo.listAdmins()).filter((a) => a.active && a.role === "manager");
      if (managers.length <= 1) throw errors.conflict("至少要保留一位啟用中的 manager。");
    }
    await this.deps.repo.updateAdmin(id, { name: body.name, role: body.role, active: body.active });
    if (body.active === false || (body.role !== undefined && body.role !== before.role)) {
      await this.deps.repo.revokeSessions("admin", id, new Date());
    }
    return this.mustFindAdminAccount(id);
  }

  /** For someone who forgot their password. Their own password is changed with changeAdminPassword instead. */
  async resetAdminPassword(actorId: string, id: string, password: string): Promise<AdminAccountDto> {
    if (id === actorId) throw errors.conflict("請到「帳號設定」修改自己的密碼。");
    const target = await this.deps.repo.findAdminById(id);
    if (!target) throw errors.notFound();
    const now = new Date();
    await this.deps.repo.updateAdmin(id, { passwordHash: await bcrypt.hash(password, this.deps.bcryptCost), passwordChangedAt: now });
    await this.deps.repo.revokeSessions("admin", id, now);
    return this.mustFindAdminAccount(id);
  }

  /**
   * First boot only: creates the first manager from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD when no admin
   * exists. It never touches an existing account, so passwords changed in the console survive restarts.
   */
  async ensureBootstrapAdmin(input: { email: string; password: string }): Promise<boolean> {
    if ((await this.deps.repo.listAdmins()).length > 0) return false;
    await this.deps.repo.createAdmin({
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, this.deps.bcryptCost),
      name: "Admin",
      role: "manager"
    });
    return true;
  }

  /**
   * Break-glass recovery (`node dist/admin-reset.mjs <email>` in the API container) and test fixtures:
   * creates or overwrites the admin, re-activates it and ends its existing sessions.
   */
  async upsertAdmin(input: { email: string; password: string; name: string; role: AdminRole }): Promise<AdminDto> {
    const admin = await this.deps.repo.upsertAdmin({
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, this.deps.bcryptCost),
      name: input.name,
      role: input.role
    });
    await this.deps.repo.revokeSessions("admin", admin.id, new Date());
    return toAdminDto(admin);
  }
}
