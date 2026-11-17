import { ErrorNote } from "@vsev/ui";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { errorText } from "../format";

export function AuthPage({ mode }: { mode: "login" | "register" }): ReactElement {
  const { login, register } = useAuth();
  const nav = useNavigate();
  // Carries the checkout selection (model / shop) through login and registration.
  const carried: unknown = useLocation().state;
  const [params] = useSearchParams();
  const next = params.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login({ email: form.email, password: form.password });
      else await register({ email: form.email, password: form.password, name: form.name, ...(form.phone ? { phone: form.phone } : {}) });
      nav(dest, { replace: true, state: carried });
    } catch (ex) {
      setError(errorText(ex));
    } finally {
      setBusy(false);
    }
  };

  const other = `${mode === "login" ? "/register" : "/login"}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className="page">
      <h1>{mode === "login" ? "會員登入" : "註冊會員"}</h1>
      <form className="card" onSubmit={(e) => void submit(e)}>
        {mode === "register" && (
          <div className="field"><label htmlFor="name">姓名</label><input id="name" required value={form.name} onChange={set("name")} /></div>
        )}
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></div>
        <div className="field">
          <label htmlFor="pw">密碼{mode === "register" ? "（至少 8 碼）" : ""}</label>
          <input id="pw" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={set("password")} />
        </div>
        {mode === "register" && (
          <div className="field"><label htmlFor="phone">手機（選填）</label><input id="phone" value={form.phone} onChange={set("phone")} /></div>
        )}
        {error && <ErrorNote message={error} />}
        <div className="btn-row">
          <button className="btn" disabled={busy}>{mode === "login" ? "登入" : "建立帳號"}</button>
          <Link className="btn ghost" to={other} state={carried}>{mode === "login" ? "還沒有帳號？註冊" : "已有帳號？登入"}</Link>
        </div>
      </form>
    </div>
  );
}
