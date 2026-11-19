import {
  ORDER_STATUS_LABELS,
  type ChangePasswordBody,
  formatTWD,
  type MileageSummaryDto,
  type OrderDto,
  type PointsSummaryDto
} from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { errorText, fmtDate } from "../format";

/** CASA 2.1.5/2.1.6: change password with the current one; other devices are signed out by default. */
function ChangePassword(): ReactElement {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError("兩次輸入的新密碼不一致。");
    setBusy(true);
    try {
      const body: ChangePasswordBody = { currentPassword: current, newPassword: next, signOutOtherSessions: others };
      const res = await api.post<{ signedOutSessions: number }>("/auth/password", body);
      setDone(res.signedOutSessions > 0 ? `密碼已更新，並已登出其他 ${res.signedOutSessions} 個裝置。` : "密碼已更新。");
      setOpen(false);
      setCurrent(""); setNext(""); setConfirm("");
    } catch (ex) {
      setError(errorText(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>登入與安全</h2>
      {done && <p className="notice">{done}</p>}
      {!open ? (
        <button className="btn ghost" onClick={() => { setOpen(true); setDone(null); }}>修改密碼</button>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <div className="field"><label htmlFor="pw-cur">目前的密碼</label><input id="pw-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw-new">新密碼（至少 8 個字元）</label><input id="pw-new" type="password" autoComplete="new-password" required minLength={8} maxLength={100} value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw-again">再輸入一次新密碼</label><input id="pw-again" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <label className="confirm"><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /><span>同時登出其他裝置（建議）</span></label>
          {error && <ErrorNote message={error} />}
          <div className="btn-row">
            <button className="btn" disabled={busy}>更新密碼</button>
            <button type="button" className="btn ghost" onClick={() => { setOpen(false); setError(null); }}>取消</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function AccountPage(): ReactElement {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [points, setPoints] = useState<PointsSummaryDto | null>(null);
  const [mileage, setMileage] = useState<MileageSummaryDto | null>(null);
  const [km, setKm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<OrderDto[]>("/me/orders"),
      api.get<PointsSummaryDto>("/me/points"),
      api.get<MileageSummaryDto>("/me/mileage")
    ])
      .then(([o, p, m]) => { setOrders(o); setPoints(p); setMileage(m); })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  const isOwner = orders?.some((o) => o.status === "warranty_active") ?? false;

  const addMileage = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      setMileage(await api.post<MileageSummaryDto>("/me/mileage", { odometerKm: Number(km) }));
      setKm("");
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  if (!orders || !points || !mileage) return <div className="page">{error ? <ErrorNote message={error} /> : <Spinner />}</div>;

  return (
    <div className="page">
      <h1>{user?.name} 的帳戶</h1>
      {error && <ErrorNote message={error} />}

      <div className="card">
        <h2>我的訂單</h2>
        {orders.length === 0 && <p style={{ color: "var(--dim)" }}>還沒有訂單。<Link className="link" to="/">前往活動頁</Link></p>}
        {orders.slice(0, 3).map((o) => (
          <div className="row" key={o.id}>
            <Link className="link" to={`/orders/${o.id}`}>{o.number}</Link>
            <span>{ORDER_STATUS_LABELS[o.status]}・{formatTWD(o.amountCents)}・期限 {fmtDate(o.installDeadline)}</span>
          </div>
        ))}
        {orders.length > 0 && <Link className="more-link" to="/orders">查看全部訂單、修改或追蹤 →</Link>}
      </div>

      <ChangePassword />

      {isOwner ? (
        <>
          <div className="card">
            <h2>點數與推薦</h2>
            <div className="row"><span>點數餘額</span><b>{points.balance} 點</b></div>
            <div className="row"><span>我的推薦碼</span><b>{points.referralCode ?? "—"}</b></div>
            {points.entries.map((e) => (
              <div className="row" key={e.id}><span>{e.note ?? e.reason}</span><span>{e.delta > 0 ? "+" : ""}{e.delta}</span></div>
            ))}
          </div>
          <form className="card" onSubmit={(e) => void addMileage(e)}>
            <h2>里程與保養</h2>
            <div className="row"><span>最近里程</span><b>{mileage.latestKm ?? "—"} km</b></div>
            <div className="row"><span>下次輪胎檢查</span><b>{mileage.nextServiceKm ?? "—"} km</b></div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="km">目前里程數（km）</label>
              <input id="km" type="number" min={0} required value={km} onChange={(e) => setKm(e.target.value)} />
            </div>
            <button className="btn">記錄里程</button>
          </form>
        </>
      ) : (
        <p style={{ color: "var(--dim)", fontSize: 14 }}>完成安裝並啟用保固後，這裡會開通點數、推薦碼與里程追蹤。</p>
      )}
    </div>
  );
}
