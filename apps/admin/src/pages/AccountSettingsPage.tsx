import { ADMIN_PASSWORD_MIN, type AdminChangePasswordBody } from "@vsev/shared";
import { ErrorNote } from "@vsev/ui";
import { useState, type FormEvent, type ReactElement } from "react";
import { api, errorText } from "../api";
import { useAdmin } from "../auth";

const ROLE_LABELS = { manager: "manager（全部權限）", operator: "operator（出貨、訂單、內容、店家）", finance: "finance（退款、取消申請）" } as const;

/** 帳號設定: every admin changes their own password here (CASA 2.1.5 / 2.1.6 / 3.3.3). */
export function AccountSettingsPage(): ReactElement {
  const { admin } = useAdmin();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (next !== confirm) return setError("兩次輸入的新密碼不一致。");
    setBusy(true);
    try {
      const body: AdminChangePasswordBody = { currentPassword: current, newPassword: next, signOutOtherSessions: others };
      const res = await api.post<{ signedOutSessions: number }>("/auth/password", body);
      setNotice(res.signedOutSessions > 0 ? `密碼已更新，並已登出其他 ${res.signedOutSessions} 個登入。` : "密碼已更新。");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (ex) {
      setError(errorText(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>帳號設定</h1>
      <div className="card">
        <div className="row"><span>姓名</span><b>{admin?.name}</b></div>
        <div className="row"><span>Email</span><b>{admin?.email}</b></div>
        <div className="row"><span>角色</span><b>{admin ? ROLE_LABELS[admin.role] : ""}</b></div>
      </div>
      <form className="card" onSubmit={(e) => void submit(e)} style={{ maxWidth: 520 }}>
        <h2>修改密碼</h2>
        {notice && <p className="notice">{notice}</p>}
        <div className="field"><label htmlFor="a-cur">目前的密碼</label><input id="a-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="field"><label htmlFor="a-new">新密碼（至少 {ADMIN_PASSWORD_MIN} 個字元）</label><input id="a-new" type="password" autoComplete="new-password" required minLength={ADMIN_PASSWORD_MIN} maxLength={100} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="field"><label htmlFor="a-again">再輸入一次新密碼</label><input id="a-again" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        <label className="check-line"><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> 同時登出我在其他裝置的登入（建議）</label>
        {error && <ErrorNote message={error} />}
        <div className="btn-row"><button className="btn" disabled={busy}>更新密碼</button></div>
      </form>
    </>
  );
}
