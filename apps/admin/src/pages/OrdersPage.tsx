import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  formatTWD,
  orderRules,
  type AdminCampaignDetailDto,
  type AdminOrderDetailDto,
  type AdminOrderRowDto,
  type AdminOrderSummaryDto,
  type AdminUpdateOrderBody,
  type OrderStatus,
  type Paged,
  type ShopDto,
  type AdminVehicleModelDto,
  type VehicleModelDto
} from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

const PAGE_SIZE = 20;
/** Tab order follows the order's life cycle. ("installed" is momentary: it chains to warranty_active.) */
const TAB_STATUSES: OrderStatus[] = ORDER_STATUSES.filter((s) => s !== "installed");
const CARRIERS = ["黑貓宅急便", "新竹物流", "嘉里大榮物流", "宅配通", "自有車隊"];

export function actorText(actor: string): string {
  if (actor.startsWith("user:")) return "客戶";
  if (actor.startsWith("admin:")) return "管理員";
  if (actor === "gateway" || actor === "commerce") return "金流";
  return "系統";
}

/* ───────────────────────── list ───────────────────────── */

export function OrdersPage(): ReactElement {
  const nav = useNavigate();
  // Filters live in the URL, so returning from an order keeps the list where it was.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "all";
  const page = Number(params.get("page") ?? "1") || 1;
  const q = params.get("q") ?? "";
  const shopId = params.get("shop") ?? "";
  const [qInput, setQInput] = useState(q);

  const summary = useResource<AdminOrderSummaryDto>("/orders/summary");
  const shops = useResource<ShopDto[]>("/shops");

  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (tab === "cancel") qs.set("cancelRequested", "true");
  else if (tab !== "all") qs.set("status", tab);
  if (q) qs.set("q", q);
  if (shopId) qs.set("shopId", shopId);
  const { data, error } = useResource<Paged<AdminOrderRowDto>>(`/orders?${qs.toString()}`);

  const update = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };

  const s = summary.data;
  const tabs: { key: string; label: string; count: number | undefined; warn?: boolean }[] = [
    { key: "all", label: "全部", count: s?.total },
    { key: "cancel", label: "取消申請", count: s?.cancelRequests, warn: (s?.cancelRequests ?? 0) > 0 },
    ...TAB_STATUSES.map((st) => ({ key: st, label: ORDER_STATUS_LABELS[st], count: s?.byStatus[st] }))
  ];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <h1>訂單管理</h1>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`${tab === t.key ? "active" : ""}${t.warn ? " warn" : ""}`}
            onClick={() => update({ tab: t.key === "all" ? "" : t.key })}>
            {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); update({ q: qInput.trim() }); }}>
        <input placeholder="訂單編號／車牌／客戶姓名／Email" aria-label="搜尋訂單" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <select aria-label="安裝店家" value={shopId} onChange={(e) => update({ shop: e.target.value })}>
          <option value="">全部店家</option>
          {(shops.data ?? []).map((sh) => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
        </select>
        <button className="btn">搜尋</button>
        {(q || shopId) && <button type="button" className="btn ghost" onClick={() => { setQInput(""); update({ q: "", shop: "" }); }}>清除</button>}
      </form>
      {error && <ErrorNote message={error} />}
      {!data ? <Spinner /> : (
        <div className="card">
          {data.items.length === 0 ? <p style={{ color: "var(--dim)" }}>沒有符合的訂單。</p> : (
            <table className="t">
              <thead><tr><th>編號</th><th>狀態</th><th>客戶</th><th>安裝店家</th><th>車型／車牌</th><th>金額</th><th>訂購時間</th><th>安裝期限</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                    <td><Link to={`/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>{o.number}</Link></td>
                    <td>
                      <span className="pill hot">{ORDER_STATUS_LABELS[o.status]}</span>
                      {o.cancelRequested && <><br /><span className="pill danger">取消申請</span></>}
                    </td>
                    <td>{o.customerName}<br /><small>{o.customerEmail}</small></td>
                    <td>{o.shopName}</td>
                    <td>{o.vehicleModelLabel}<br /><small>{o.plate}</small></td>
                    <td className="nowrap">{formatTWD(o.amountCents)}</td>
                    <td className="nowrap">{fmtDateTime(o.createdAt)}</td>
                    <td className="nowrap">{fmtDateTime(o.installDeadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span>共 {data.total} 筆・第 {page} / {pages} 頁</span>
            <button className="btn ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>上一頁</button>
            <button className="btn ghost" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>下一頁</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ───────────────────────── detail ───────────────────────── */

export function OrderDetailPage(): ReactElement {
  const { id = "" } = useParams();
  const { can } = useAdmin();
  const [order, setOrder] = useState<AdminOrderDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    api.get<AdminOrderDetailDto>(`/orders/${id}`).then(setOrder).catch((e: unknown) => setLoadError(errorText(e)));
  };
  useEffect(load, [id]); // re-run only when the id changes

  /** POST/PATCH an admin action; every admin order endpoint answers with the fresh order. */
  const run = async (fn: () => Promise<AdminOrderDetailDto>, done: string, confirmText?: string): Promise<boolean> => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setOrder(await fn());
      setNotice(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, body: object = {}) => () => api.post<AdminOrderDetailDto>(`/orders/${id}/${path}`, body);

  if (loadError) return <ErrorNote message={loadError} />;
  if (!order) return <Spinner />;

  const rules = { status: order.status, cancelRequestedAt: order.cancelRequest?.requestedAt ?? null };
  const ops = can("operator", "manager");
  const money = can("finance", "manager");

  return (
    <>
      <p><Link className="link" to="/orders">← 訂單管理</Link></p>
      <h1>
        {order.number} <span className="pill hot">{ORDER_STATUS_LABELS[order.status]}</span>
        {order.cancelRequest && <span className="pill danger">取消申請</span>}
      </h1>
      {error && <ErrorNote message={error} />}
      {notice && <p className="notice">{notice}</p>}

      <div className="detail-grid">
        <div>
          <div className="card">
            <h2>訂單資料</h2>
            <div className="row"><span>客戶</span><span>{order.customerName}（{order.customerEmail}）</span></div>
            <div className="row"><span>安裝店家</span><span>{order.shopName}・{order.shopAddress}</span></div>
            <div className="row"><span>車型 / 車牌</span><span>{order.vehicleModelLabel}・{order.plate}</span></div>
            <div className="row"><span>金額</span><b>{formatTWD(order.amountCents)}</b></div>
            <div className="row"><span>訂購時間</span><span>{fmtDateTime(order.createdAt)}</span></div>
            <div className="row"><span>安裝期限</span><span>{fmtDateTime(order.installDeadline)}</span></div>
            {order.shipment && <div className="row"><span>物流</span><span>{[order.shipment.carrier, order.shipment.trackingNumber].filter(Boolean).join("・")}</span></div>}
            {order.booking && <div className="row"><span>預約時段</span><b>{fmtDateTime(order.booking.slotAt)}</b></div>}
            {order.externalRef && <div className="row"><span>外部購物車編號</span><span>{order.externalRef}</span></div>}
          </div>

          {(ops && (orderRules.canChangeShop(rules) || orderRules.canChangeVehicle(rules) || orderRules.canEditTracking(rules))) && (
            <EditCard order={order} busy={busy} onSave={(body) => run(() => api.patch<AdminOrderDetailDto>(`/orders/${id}`, body), "訂單資料已更新")} />
          )}

          <div className="card">
            <h2>訂單紀錄</h2>
            <NoteForm busy={busy} onAdd={(note) => run(post("notes", { note }), "已新增內部備註")} />
            <ol className="timeline-list">
              {[...order.events].reverse().map((e) => (
                <li key={e.id} className={e.kind}>
                  <span className="when">{fmtDateTime(e.createdAt)}</span>
                  <span className="what">
                    <span className={`kind ${e.kind}`}>{e.kind === "status" ? "狀態" : e.kind === "change" ? "修改" : "內部備註"}</span>
                    {e.kind === "status" ? `${e.from ? `${ORDER_STATUS_LABELS[e.from]} → ` : ""}${ORDER_STATUS_LABELS[e.to]}${e.note ? `（${e.note}）` : ""}` : e.note}
                  </span>
                  <span className="who">{actorText(e.actor)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div>
          {order.cancelRequest && (
            <CancelRequestCard order={order} busy={busy} canDecide={money}
              onRefund={() => run(post("refund", { note: "同意取消申請" }), "已退款，取消申請結案", "確認同意取消並退款？此動作無法復原。")}
              onDismiss={(note) => run(post("cancel-request/dismiss", { note }), "已回覆客戶：不同意取消")} />
          )}
          <NextActions order={order} ops={ops} money={money} busy={busy}
            onShip={(carrier, trackingNumber) => run(post("ship", { ...(carrier ? { carrier } : {}), ...(trackingNumber ? { trackingNumber } : {}) }), "已標記出貨，客戶會收到通知")}
            onArrive={() => run(post("arrival"), "已標記到店，客戶會收到預約通知")}
            onInstalled={() => run(post("installed"), "已完成安裝，保固已啟用", "確認已完成安裝？這會啟用保固並發放點數。")}
            onCancel={(note) => run(post("cancel", note ? { note } : {}), "訂單已取消", "確定取消此訂單？")}
            onRefund={(note) => run(post("refund", note ? { note } : {}), "已退款", "確定退款？此動作無法復原。")} />
        </div>
      </div>
    </>
  );
}

function NextActions(props: {
  order: AdminOrderDetailDto;
  ops: boolean;
  money: boolean;
  busy: boolean;
  onShip: (carrier: string, trackingNumber: string) => Promise<boolean>;
  onArrive: () => Promise<boolean>;
  onInstalled: () => Promise<boolean>;
  onCancel: (note: string) => Promise<boolean>;
  onRefund: (note: string) => Promise<boolean>;
}): ReactElement {
  const { order, ops, money, busy } = props;
  const s = order.status;
  const [carrier, setCarrier] = useState(CARRIERS[0] ?? "");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const refundable = s === "paid" || s === "shipped" || s === "arrived_at_shop" || s === "expired";

  const waiting: Partial<Record<OrderStatus, string>> = {
    created: "等待客戶付款。",
    arrived_at_shop: "輪胎已到店，等待客戶預約安裝時段。",
    warranty_active: "已完成安裝，保固啟用中。",
    cancelled: "訂單已取消。",
    refunded: "訂單已退款。",
    expired: "已超過安裝期限。"
  };

  return (
    <div className="card next-actions">
      <h2>下一步</h2>
      {waiting[s] && <p className="hint">{waiting[s]}</p>}

      {ops && s === "paid" && (
        <form onSubmit={(e) => { e.preventDefault(); void props.onShip(carrier, tracking.trim()); }}>
          <div className="field"><label htmlFor="carrier">物流公司</label>
            <select id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div className="field"><label htmlFor="tracking">追蹤單號（選填，客戶看得到）</label>
            <input id="tracking" value={tracking} maxLength={60} onChange={(e) => setTracking(e.target.value)} /></div>
          <button className="btn" disabled={busy}>標記出貨</button>
        </form>
      )}
      {ops && s === "shipped" && <button className="btn" disabled={busy} onClick={() => void props.onArrive()}>標記已到店</button>}
      {ops && s === "booked" && (
        <>
          {order.booking && <p className="hint">預約時段：{fmtDateTime(order.booking.slotAt)}</p>}
          <button className="btn" disabled={busy} onClick={() => void props.onInstalled()}>回報完成安裝</button>
        </>
      )}

      {((ops && s === "created") || (money && refundable)) && (
        <div className="subform">
          <div className="field"><label htmlFor="act-note">備註（寫入訂單紀錄，客戶看得到）</label>
            <input id="act-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="btn-row">
            {ops && s === "created" && <button className="btn ghost" disabled={busy} onClick={() => void props.onCancel(note)}>取消訂單</button>}
            {money && refundable && <button className="btn danger" disabled={busy} onClick={() => void props.onRefund(note)}>退款</button>}
          </div>
          {money && refundable && <p className="hint">退款僅記錄決定並更新狀態；實際退刷由金流處理。</p>}
        </div>
      )}
      {!ops && !money && <p className="hint">你的角色沒有可執行的操作。</p>}
    </div>
  );
}

function CancelRequestCard(props: {
  order: AdminOrderDetailDto;
  busy: boolean;
  canDecide: boolean;
  onRefund: () => Promise<boolean>;
  onDismiss: (note: string) => Promise<boolean>;
}): ReactElement | null {
  const [reply, setReply] = useState("");
  const req = props.order.cancelRequest;
  if (!req) return null;
  const refundable = props.order.status !== "booked";
  return (
    <div className="card banner-warn">
      <h2>客戶申請取消</h2>
      <p>原因：{req.reason}</p>
      <p className="hint">{fmtDateTime(req.requestedAt)} 送出</p>
      {props.canDecide ? (
        <>
          {refundable ? (
            <button className="btn danger" disabled={props.busy} onClick={() => void props.onRefund()}>同意並退款</button>
          ) : (
            <p className="hint">已預約安裝的訂單需先由客戶取消預約，才能退款。</p>
          )}
          <form className="subform" onSubmit={(e) => { e.preventDefault(); void props.onDismiss(reply.trim()).then((ok) => ok && setReply("")); }}>
            <div className="field"><label htmlFor="dismiss">不同意的原因（客戶看得到）</label>
              <input id="dismiss" required maxLength={200} value={reply} onChange={(e) => setReply(e.target.value)} /></div>
            <button className="btn ghost" disabled={props.busy}>回覆不同意</button>
          </form>
        </>
      ) : (
        <p className="hint">由 finance 或 manager 角色處理。</p>
      )}
    </div>
  );
}

function EditCard(props: { order: AdminOrderDetailDto; busy: boolean; onSave: (body: AdminUpdateOrderBody) => Promise<boolean> }): ReactElement {
  const { order } = props;
  const rules = { status: order.status, cancelRequestedAt: order.cancelRequest?.requestedAt ?? null };
  const [open, setOpen] = useState(false);
  const [shops, setShops] = useState<ShopDto[]>([]);
  const [models, setModels] = useState<VehicleModelDto[]>([]);
  const [form, setForm] = useState({
    shopId: order.shopId, vehicleModelId: order.vehicleModelId, plate: order.plate,
    carrier: order.shipment?.carrier ?? "", trackingNumber: order.shipment?.trackingNumber ?? ""
  });

  useEffect(() => {
    if (!open) return;
    // Only shops in this order's campaign, and only models it is eligible for.
    void Promise.all([
      api.get<AdminCampaignDetailDto>(`/campaigns/${order.campaignId}`),
      api.get<ShopDto[]>("/shops"),
      api.get<AdminVehicleModelDto[]>("/vehicle-models")
    ]).then(([campaign, allShops, allModels]) => {
      setShops(allShops.filter((s) => s.active && campaign.shopIds.includes(s.id)));
      // Keep the order's current model listed even if it was deactivated since, so the select shows it.
      setModels(allModels.filter((m) => m.id === order.vehicleModelId || (m.active && campaign.eligibleModelIds.includes(m.id))));
    }).catch(() => undefined);
  }, [open, order.campaignId]);

  if (!open) {
    return <div className="card"><h2>修改訂單</h2><button className="btn ghost" onClick={() => setOpen(true)}>代客戶修改資料</button></div>;
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const body: AdminUpdateOrderBody = {};
    if (orderRules.canChangeShop(rules) && form.shopId !== order.shopId) body.shopId = form.shopId;
    if (orderRules.canChangeVehicle(rules) && form.vehicleModelId !== order.vehicleModelId) body.vehicleModelId = form.vehicleModelId;
    if (orderRules.canChangeVehicle(rules) && form.plate.trim().toUpperCase() !== order.plate) body.plate = form.plate.trim();
    if (orderRules.canEditTracking(rules) && form.carrier.trim() && form.carrier.trim() !== (order.shipment?.carrier ?? "")) body.carrier = form.carrier.trim();
    if (orderRules.canEditTracking(rules) && form.trackingNumber.trim() && form.trackingNumber.trim() !== (order.shipment?.trackingNumber ?? "")) body.trackingNumber = form.trackingNumber.trim();
    if (Object.keys(body).length === 0) return setOpen(false);
    void props.onSave(body).then((ok) => ok && setOpen(false));
  };
  const set = (k: keyof typeof form, v: string): void => setForm({ ...form, [k]: v });

  return (
    <form className="card" onSubmit={submit}>
      <h2>修改訂單</h2>
      {orderRules.canChangeShop(rules) ? (
        <div className="field"><label htmlFor="e-shop">安裝店家</label>
          <select id="e-shop" value={form.shopId} onChange={(e) => set("shopId", e.target.value)}>
            {!shops.some((s) => s.id === order.shopId) && <option value={order.shopId}>{order.shopName}</option>}
            {shops.map((s) => <option key={s.id} value={s.id}>{s.regionLabel}・{s.name}</option>)}
          </select></div>
      ) : <p className="hint">已出貨，無法更換安裝店家。</p>}
      {orderRules.canChangeVehicle(rules) && (
        <div className="grid2">
          <div className="field"><label htmlFor="e-model">車型</label>
            <select id="e-model" value={form.vehicleModelId} onChange={(e) => set("vehicleModelId", e.target.value)}>
              {!models.some((m) => m.id === order.vehicleModelId) && <option value={order.vehicleModelId}>{order.vehicleModelLabel}</option>}
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="e-plate">車牌</label><input id="e-plate" required value={form.plate} onChange={(e) => set("plate", e.target.value)} /></div>
        </div>
      )}
      {orderRules.canEditTracking(rules) && (
        <div className="grid2">
          <div className="field"><label htmlFor="e-carrier">物流公司</label><input id="e-carrier" list="carriers" value={form.carrier} onChange={(e) => set("carrier", e.target.value)} />
            <datalist id="carriers">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="field"><label htmlFor="e-track">追蹤單號</label><input id="e-track" value={form.trackingNumber} onChange={(e) => set("trackingNumber", e.target.value)} /></div>
        </div>
      )}
      <p className="hint">每一項修改都會寫入訂單紀錄，客戶看得到。</p>
      <div className="btn-row">
        <button className="btn" disabled={props.busy}>儲存</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>取消</button>
      </div>
    </form>
  );
}

function NoteForm(props: { busy: boolean; onAdd: (note: string) => Promise<boolean> }): ReactElement {
  const [note, setNote] = useState("");
  return (
    <form className="note-form" onSubmit={(e) => { e.preventDefault(); void props.onAdd(note.trim()).then((ok) => ok && setNote("")); }}>
      <input placeholder="新增內部備註（只有管理員看得到）" aria-label="內部備註" required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn ghost" disabled={props.busy || !note.trim()}>新增</button>
    </form>
  );
}
