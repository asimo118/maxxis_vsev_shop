import { ADMIN_PASSWORD_MIN, ADMIN_ROLES, type AdminAccountDto, type AdminCreateBody, type AdminRole } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type FormEvent, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

export const ROLE_TEXT: Record<AdminRole, string> = {
  manager: "manager・全部權限，含帳號管理",
  operator: "operator・出貨、訂單、內容、店家",
  finance: "finance・退款、取消申請"
};

const blank: AdminCreateBody = { email: "", name: "", role: "operator", password: "" };

/** Inline "reset password" row for one admin (someone who forgot theirs). */
function ResetPassword({ target, onDone }: { target: AdminAccountDto; onDone: (msg: string) => void }): ReactElement {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/admins/${target.id}/password`, { password });
      onDone(`已重設「${target.name}」的密碼，他所有的登入都已登出。請用安全的方式告知臨時密碼，並請他登入後到「帳號設定」修改。`);
    } catch (ex) {
      setError(errorText(ex));
    }
  };
  return (
    <form className="inline-form" onSubmit={(e) => void submit(e)}>
      <input type="password" autoComplete="new-password" required minLength={ADMIN_PASSWORD_MIN} maxLength={100}
        placeholder={`臨時密碼（至少 ${ADMIN_PASSWORD_MIN} 字元）`} aria-label={`${target.name} 的臨時密碼`} value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn">重設</button>
      {error && <ErrorNote message={error} />}
    </form>
  );
}

/** 後台帳號 (managers only): one personal account per person instead of a shared login (CASA 2.5.4). */
export function AdminsPage(): ReactElement {
  const { admin: me } = useAdmin();
  const admins = useResource<AdminAccountDto[]>("/admins");
  const [form, setForm] = useState<AdminCreateBody>(blank);
  const [formOpen, setFormOpen] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const all = admins.data ?? [];
  const activeManagers = all.filter((a) => a.active && a.role === "manager").length;
  const shared = all.find((a) => a.email === "admin@vsev.local" && a.active);

  const done = (msg: string): void => {
    setNotice(msg);
    setError(null);
    setResetFor(null);
    admins.reload();
  };

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<AdminAccountDto>("/admins", form);
      setForm(blank);
      setFormOpen(false);
      done(`已建立「${created.name}」（${created.role}）。請用安全的方式告知初始密碼，並請他登入後到「帳號設定」修改。`);
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const update = async (a: AdminAccountDto, patch: { role?: AdminRole; active?: boolean }, msg: string): Promise<void> => {
    setError(null);
    try {
      await api.patch(`/admins/${a.id}`, patch);
      done(msg);
    } catch (ex) {
      setError(errorText(ex));
      admins.reload();
    }
  };

  return (
    <>
      <h1>後台帳號</h1>
      {(error ?? admins.error) && <ErrorNote message={error ?? admins.error ?? ""} />}
      {notice && <p className="notice">{notice}</p>}
      {shared && (
        <p className="warn-box">
          共用帳號 admin@vsev.local 仍在使用中。請為每位管理者建立個人帳號，確認有另一位 manager 可以登入後，再停用這個共用帳號。
        </p>
      )}

      {!formOpen ? (
        <div className="btn-row"><button className="btn" onClick={() => { setFormOpen(true); setNotice(null); }}>＋ 新增帳號</button></div>
      ) : (
        <form className="card" onSubmit={(e) => void create(e)}>
          <h2>新增後台帳號</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="n-name">姓名</label><input id="n-name" required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="n-email">Email（登入帳號）</label><input id="n-email" type="email" required maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="n-role">角色</label>
              <select id="n-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}>
                {ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
              </select></div>
            <div className="field"><label htmlFor="n-pw">初始密碼（至少 {ADMIN_PASSWORD_MIN} 個字元）</label><input id="n-pw" type="password" autoComplete="new-password" required minLength={ADMIN_PASSWORD_MIN} maxLength={100} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          <p className="hint">給最少夠用的角色。初始密碼請用安全的方式告知本人，並請他登入後立刻修改。</p>
          <div className="btn-row">
            <button className="btn">建立</button>
            <button type="button" className="btn ghost" onClick={() => { setFormOpen(false); setError(null); }}>取消</button>
          </div>
        </form>
      )}

      <div className="card">
        <h2>帳號（{all.length}）</h2>
        {!admins.data ? <Spinner /> : (
          <table className="t">
            <thead><tr><th>姓名</th><th>Email</th><th>角色</th><th>狀態</th><th>最近登入</th><th /></tr></thead>
            <tbody>{all.map((a) => {
              const self = a.id === me?.id;
              const lastManager = a.active && a.role === "manager" && activeManagers <= 1;
              return (
                <tr key={a.id}>
                  <td>{a.name}{self && <small>（你）</small>}</td>
                  <td>{a.email}</td>
                  <td>
                    <select aria-label={`${a.name} 的角色`} value={a.role} disabled={self || lastManager}
                      title={self ? "不能變更自己的角色" : lastManager ? "至少要保留一位 manager" : undefined}
                      onChange={(e) => void update(a, { role: e.target.value as AdminRole }, `已把「${a.name}」改為 ${e.target.value}，他需要重新登入。`)}>
                      {ADMIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td><span className={`pill${a.active ? " ok" : ""}`}>{a.active ? "啟用" : "停用"}</span></td>
                  <td className="nowrap">{a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : "從未登入"}</td>
                  <td className="nowrap">
                    {!self && (
                      <>
                        <button className="link" disabled={lastManager} title={lastManager ? "至少要保留一位 manager" : undefined}
                          onClick={() => void update(a, { active: !a.active }, a.active ? `已停用「${a.name}」，他的登入已全部登出。` : `已重新啟用「${a.name}」。`)}>
                          {a.active ? "停用" : "啟用"}
                        </button>{"　"}
                        <button className="link" onClick={() => { setResetFor(resetFor === a.id ? null : a.id); setNotice(null); }}>重設密碼</button>
                        {resetFor === a.id && <ResetPassword target={a} onDone={done} />}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          停用、變更角色或重設密碼都會立即登出該帳號。忘記自己密碼又沒有其他 manager 時，請維運在 API 容器執行 <code>node dist/admin-reset.mjs &lt;email&gt;</code>。
        </p>
      </div>
    </>
  );
}
