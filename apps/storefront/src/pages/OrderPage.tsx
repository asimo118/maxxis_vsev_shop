import { ORDER_PROGRESS, ORDER_STATUS_LABELS, formatTWD, progressIndex, type OrderDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { startCheckout } from "../checkout";
import { errorText, fmtDate, fmtDateTime } from "../format";

export function OrderPage(): ReactElement {
  const { id = "" } = useParams();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);

  const [params] = useSearchParams();
  const backFromCheckout = params.get("from") === "checkout";
  const [polls, setPolls] = useState(0);

  const load = useCallback(() => {
    api.get<OrderDto>(`/me/orders/${id}`).then(setOrder).catch((e: unknown) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  // Back from the external cart: its webhook may land a moment after the shopper does — poll briefly.
  const awaitingPayment = backFromCheckout && order?.status === "created" && polls < 15;
  useEffect(() => {
    if (!awaitingPayment) return;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      load();
    }, 2000);
    return () => clearTimeout(timer);
  }, [awaitingPayment, polls, load]);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!order) return <div className="page">{error ? <ErrorNote message={error} /> : <Spinner />}</div>;
  const idx = progressIndex(order.status);

  const book = (e: FormEvent): void => {
    e.preventDefault();
    void act(() => api.post(`/orders/${order.id}/booking`, { slotAt: new Date(slot).toISOString() }));
  };

  return (
    <div className="page">
      <h1>訂單 {order.number} <span className="status-pill">{ORDER_STATUS_LABELS[order.status]}</span></h1>
      {idx >= 0 && (
        <div className="progress">
          {ORDER_PROGRESS.map((s, i) => <div key={s.status} className={i <= idx ? "done" : ""}>{s.label}</div>)}
        </div>
      )}
      {error && <ErrorNote message={error} />}

      <div className="card">
        <div className="row"><span>商品</span><span>{order.campaignTitle}</span></div>
        <div className="row"><span>車型 / 車牌</span><span>{order.vehicleModelLabel}・{order.plate}</span></div>
        <div className="row"><span>安裝店家</span><span>{order.shopName}（{order.shopAddress}）</span></div>
        <div className="row"><span>安裝期限</span><span>{fmtDate(order.installDeadline)}</span></div>
        <div className="row"><span>金額</span><b>{formatTWD(order.amountCents)}</b></div>
        {order.booking && <div className="row"><span>預約時段</span><b>{fmtDateTime(order.booking.slotAt)}</b></div>}
      </div>

      {awaitingPayment && <p className="ok-note" role="status">付款確認中，請稍候…</p>}
      {order.status === "created" && !awaitingPayment && (
        <div className="btn-row">
          <button className="btn" disabled={busy} onClick={() => void act(() => startCheckout(order.id))}>
            {backFromCheckout ? "尚未收到付款，重新結帳" : "前往付款"}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void act(() => api.post(`/orders/${order.id}/cancel`))}>取消訂單</button>
        </div>
      )}

      {order.status === "arrived_at_shop" && (
        <form className="card" onSubmit={book}>
          <h2>預約安裝時段</h2>
          <div className="field">
            <label htmlFor="slot">日期時間（須在店家營業時間與安裝期限內）</label>
            <input id="slot" type="datetime-local" required value={slot} onChange={(e) => setSlot(e.target.value)} />
          </div>
          <button className="btn" disabled={busy}>送出預約</button>
        </form>
      )}
      {order.status === "booked" && (
        <div className="btn-row">
          <button className="btn ghost" disabled={busy} onClick={() => void act(() => api.del(`/orders/${order.id}/booking`))}>取消預約</button>
        </div>
      )}
      {order.status === "warranty_active" && <p className="ok-note">保固已啟用 🎉 可到「我的帳戶」記錄里程與取得推薦碼。</p>}

      <div className="card">
        <h2>訂單紀錄</h2>
        {order.events.map((e) => (
          <div className="row" key={e.id}><span>{fmtDateTime(e.createdAt)}</span><span>{ORDER_STATUS_LABELS[e.to]}</span></div>
        ))}
      </div>
      <Link className="link" to="/account">← 回我的帳戶</Link>
    </div>
  );
}
