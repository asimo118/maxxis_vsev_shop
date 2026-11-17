import bcrypt from "bcryptjs";
import type { AdminDto, AdminRole, AuthResultDto, LoginBody, RegisterBody, UserDto } from "@vsev/shared";
import { errors } from "../../platform/errors";
import type { TokenService } from "../../platform/tokens";
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
    return { token: this.deps.tokens.sign("storefront", user.id), user: toUserDto(user) };
  }

  async login(body: LoginBody): Promise<AuthResultDto<UserDto>> {
    const user = await this.deps.repo.findUserByEmail(body.email);
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !ok) throw errors.unauthenticated();
    return { token: this.deps.tokens.sign("storefront", user.id), user: toUserDto(user) };
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

  async adminLogin(body: LoginBody): Promise<AuthResultDto<AdminDto>> {
    const admin = await this.deps.repo.findAdminByEmail(body.email);
    const ok = await bcrypt.compare(body.password, admin?.passwordHash ?? (await this.dummyHash));
    if (!admin || !admin.active || !ok) throw errors.unauthenticated();
    return { token: this.deps.tokens.sign("admin", admin.id), user: toAdminDto(admin) };
  }

  /** Active admins only — a deactivated admin's still-valid token stops working immediately. */
  async getActiveAdmin(adminId: string): Promise<AdminDto | null> {
    const admin = await this.deps.repo.findAdminById(adminId);
    return admin?.active ? toAdminDto(admin) : null;
  }

  async upsertAdmin(input: { email: string; password: string; name: string; role: AdminRole }): Promise<AdminDto> {
    const admin = await this.deps.repo.upsertAdmin({
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, this.deps.bcryptCost),
      name: input.name,
      role: input.role
    });
    return toAdminDto(admin);
  }
}
