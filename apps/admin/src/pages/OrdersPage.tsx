import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  canTransition,
  formatTWD,
  type AdminOrderDetailDto,
  type AdminOrderRowDto,
  type Paged
} from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

export function OrdersPage(): ReactElement {
  const nav = useNavigate();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (query) qs.set("q", query);
  const { data, error } = useResource<Paged<AdminOrderRowDto>>(`/orders?${qs.toString()}`);
  return (
    <>
      <h1>訂單</h1>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </select>
        <input placeholder="訂單編號 / 姓名 / Email / 車牌" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQuery(q)} />
        <button className="btn" onClick={() => setQuery(q)}>搜尋</button>
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Spinner /> : (
        <div className="card">
          <table className="t">
            <thead><tr><th>編號</th><th>狀態</th><th>客戶</th><th>店家</th><th>車型 / 車牌</th><th>金額</th><th>安裝期限</th></tr></thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                  <td>{o.number}</td><td><span className="pill hot">{ORDER_STATUS_LABELS[o.status]}</span></td>
                  <td>{o.customerName}<br /><small>{o.customerEmail}</small></td><td>{o.shopName}</td>
                  <td>{o.vehicleModelLabel}<br /><small>{o.plate}</small></td><td>{formatTWD(o.amountCents)}</td><td>{fmtDateTime(o.installDeadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 8 }}>共 {data.total} 筆</p>
        </div>
      )}
    </>
  );
}

export function OrderDetailPage(): ReactElement {
  const { id = "" } = useParams();
  const { can } = useAdmin();
  const { data, error, reload } = useResource<AdminOrderDetailDto>(`/orders/${id}`);
  const [actErr, setActErr] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const act = async (path: string, confirmText?: string): Promise<void> => {
    if (confirmText && !window.confirm(confirmText)) return;
    setActErr(null);
    try {
      await api.post(`/orders/${id}/${path}`, note ? { note } : {});
      setNote("");
      reload();
    } catch (e) {
      setActErr(errorText(e));
    }
  };

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Spinner />;
  const s = data.status;
  const ops = can("operator", "manager");
  return (
    <>
      <p><Link className="link" to="/orders">← 訂單</Link></p>
      <h1>{data.number} <span className="pill hot">{ORDER_STATUS_LABELS[s]}</span></h1>
      <div className="card">
        <div className="row"><span>客戶</span><span>{data.customerName}（{data.customerEmail}）</span></div>
        <div className="row"><span>店家</span><span>{data.shopName}・{data.shopAddress}</span></div>
        <div className="row"><span>車型 / 車牌</span><span>{data.vehicleModelLabel}・{data.plate}</span></div>
        <div className="row"><span>金額</span><b>{formatTWD(data.amountCents)}</b></div>
        <div className="row"><span>安裝期限</span><span>{fmtDateTime(data.installDeadline)}</span></div>
        {data.booking && <div className="row"><span>預約時段</span><span>{fmtDateTime(data.booking.slotAt)}</span></div>}
        {data.externalRef && <div className="row"><span>外部購物車編號</span><span>{data.externalRef}</span></div>}
      </div>
      {actErr && <ErrorNote message={actErr} />}
      <div className="card">
        <h2>操作</h2>
        <div className="field"><label htmlFor="n">備註（選填，寫入稽核紀錄）</label><input id="n" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="btn-row">
          {ops && s === "paid" && <button className="btn" onClick={() => void act("ship")}>標記出貨</button>}
          {ops && s === "shipped" && <button className="btn" onClick={() => void act("arrival")}>標記到店</button>}
          {ops && s === "booked" && <button className="btn" onClick={() => void act("installed", "確認已完成安裝？這會啟用保固並發放點數。")}>回報完成安裝</button>}
          {ops && canTransition(s, "cancelled") && <button className="btn ghost" onClick={() => void act("cancel", "確定取消此訂單？")}>取消訂單</button>}
          {can("finance", "manager") && canTransition(s, "refunded") && <button className="btn danger" onClick={() => void act("refund", "確定退款？此動作無法復原。")}>退款</button>}
        </div>
        <p style={{ fontSize: 12.5, color: "var(--dim)" }}>退款僅記錄決定並更新狀態；實際退刷由金流轉接器處理（目前為示範金流）。</p>
      </div>
      <div className="card">
        <h2>稽核紀錄</h2>
        {data.events.map((e) => (
          <div className="row" key={e.id}><span>{fmtDateTime(e.createdAt)}・{e.actor}</span><span>{e.from ? `${ORDER_STATUS_LABELS[e.from]} → ` : ""}{ORDER_STATUS_LABELS[e.to]}{e.note ? `（${e.note}）` : ""}</span></div>
        ))}
      </div>
    </>
  );
}
