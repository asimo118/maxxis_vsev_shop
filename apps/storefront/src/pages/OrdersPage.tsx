import { ORDER_PROGRESS, ORDER_STATUS_LABELS, formatTWD, progressIndex, type OrderDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { errorText, fmtDate } from "../format";
import { nextStepText } from "../orderText";

const ACTION_NEEDED = new Set(["created", "arrived_at_shop"]);

export function OrdersPage(): ReactElement {
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<OrderDto[]>("/me/orders").then(setOrders).catch((e: unknown) => setError(errorText(e)));
  }, []);

  if (error) return <div className="page"><ErrorNote message={error} /></div>;
  if (!orders) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <h1>我的訂單</h1>
      {orders.length === 0 && (
        <div className="card">
          <p>還沒有訂單。</p>
          <Link className="btn" to="/">前往選購</Link>
        </div>
      )}
      {orders.map((o) => {
        const idx = progressIndex(o.status);
        return (
          <Link key={o.id} to={`/orders/${o.id}`} className="card order-card">
            <div className="order-card-head">
              <b>{o.number}</b>
              <span className="status-pill">{ORDER_STATUS_LABELS[o.status]}</span>
              {o.cancelRequest && <span className="status-pill warn">取消申請中</span>}
              <span className="order-amount">{formatTWD(o.amountCents)}</span>
            </div>
            {idx >= 0 && (
              <div className="progress mini" aria-hidden="true">
                {ORDER_PROGRESS.map((s, i) => <div key={s.status} className={i <= idx ? "done" : ""} />)}
              </div>
            )}
            <p className={`next-step${ACTION_NEEDED.has(o.status) && !o.cancelRequest ? " action" : ""}`}>{nextStepText(o)}</p>
            <p className="order-meta">
              {o.vehicleModelLabel}・{o.plate}・{o.shopName}・安裝期限 {fmtDate(o.installDeadline)}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
