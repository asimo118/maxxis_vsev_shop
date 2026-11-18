import {
  ORDER_PROGRESS,
  ORDER_STATUS_LABELS,
  formatTWD,
  orderRules,
  progressIndex,
  type OrderDto,
  type UpdateOrderBody
} from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useCampaign } from "../campaign";
import { startCheckout } from "../checkout";
import { actorLabel, errorText, fmtDate, fmtDateTime, fromTaipeiLocalInput, toTaipeiLocalInput } from "../format";
import { nextStepText } from "../orderText";

export function OrderPage(): ReactElement {
  const { id = "" } = useParams();
  const { page: campaign } = useCampaign();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  /** Runs an action; every action endpoint returns the fresh order (or nothing → reload). */
  const act = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "events" in result) setOrder(result as OrderDto);
      else load();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!order) return <div className="page">{error ? <ErrorNote message={error} /> : <Spinner />}</div>;

  const rules = { status: order.status, cancelRequestedAt: order.cancelRequest?.requestedAt ?? null };
  const idx = progressIndex(order.status);
  // Shop / model choices come from the order's campaign (when it is the one this storefront sells).
  const sameCampaign = campaign && campaign.id === order.campaignId ? campaign : null;
  const shop = sameCampaign?.shops.find((s) => s.id === order.shopId);

  return (
    <div className="page">
      <p className="crumb"><Link to="/orders">← 我的訂單</Link></p>
      <h1>
        訂單 {order.number} <span className="status-pill">{ORDER_STATUS_LABELS[order.status]}</span>
        {order.cancelRequest && <span className="status-pill warn">取消申請中</span>}
      </h1>
      {idx >= 0 && (
        <div className="progress">
          {ORDER_PROGRESS.map((s, i) => <div key={s.status} className={i <= idx ? "done" : ""}>{s.label}</div>)}
        </div>
      )}
      <p className="next-step big">{awaitingPayment ? "付款確認中，請稍候…" : nextStepText(order)}</p>
      {error && <ErrorNote message={error} />}
      {notice && <p className="ok-note" role="status">{notice}</p>}

      {order.cancelRequest && (
        <div className="card banner-warn">
          <h2>取消申請處理中</h2>
          <p>原因：{order.cancelRequest.reason}（{fmtDateTime(order.cancelRequest.requestedAt)} 送出）</p>
          <p className="hint">客服確認後會為你辦理退款；在此之前訂單照常進行。</p>
          <button className="btn ghost" disabled={busy} onClick={() => void act(() => api.del(`/orders/${order.id}/cancel-request`), "已撤回取消申請")}>
            撤回申請
          </button>
        </div>
      )}

      {order.status === "created" && !awaitingPayment && (
        <div className="btn-row">
          <button className="btn" disabled={busy} onClick={() => void act(() => startCheckout(order.id))}>
            {backFromCheckout ? "尚未收到付款，重新結帳" : `前往付款 ${formatTWD(order.amountCents)}`}
          </button>
        </div>
      )}

      {orderRules.canBook(rules) && (
        <BookingForm
          title="預約安裝時段"
          hint={shop ? `${shop.name} 營業時間：${shop.hoursLabel}・須在 ${fmtDate(order.installDeadline)} 前` : `須在 ${fmtDate(order.installDeadline)} 前`}
          busy={busy}
          submitLabel="送出預約"
          onSubmit={(slotAt) => act(() => api.post(`/orders/${order.id}/booking`, { slotAt }), "預約完成！")}
        />
      )}

      {orderRules.canChangeBooking(rules) && order.booking && (
        <div className="card">
          <h2>安裝預約</h2>
          <div className="row"><span>目前時段</span><b>{fmtDateTime(order.booking.slotAt)}</b></div>
          <div className="row"><span>店家</span><span>{order.shopName}・{order.shopAddress}</span></div>
          <BookingForm
            embedded
            title="更改時段"
            initial={order.booking.slotAt}
            hint={shop ? `營業時間：${shop.hoursLabel}・須在 ${fmtDate(order.installDeadline)} 前` : undefined}
            busy={busy}
            submitLabel="改到這個時段"
            onSubmit={(slotAt) => act(() => api.put(`/orders/${order.id}/booking`, { slotAt }), "預約時段已更改")}
          />
          <button className="link" disabled={busy} onClick={() => void act(() => api.del(`/orders/${order.id}/booking`), "已取消預約，可以重新選擇時段")}>
            取消預約
          </button>
        </div>
      )}

      <div className="card">
        <h2>訂單資料</h2>
        <div className="row"><span>商品</span><span>{order.campaignTitle}</span></div>
        <div className="row"><span>車型 / 車牌</span><span>{order.vehicleModelLabel}・{order.plate}</span></div>
        <div className="row"><span>安裝店家</span><span>{order.shopName}（{order.shopAddress}）</span></div>
        {order.shipment && (
          <div className="row"><span>物流</span><b>{[order.shipment.carrier, order.shipment.trackingNumber].filter(Boolean).join("・")}</b></div>
        )}
        {order.booking && <div className="row"><span>預約時段</span><b>{fmtDateTime(order.booking.slotAt)}</b></div>}
        <div className="row"><span>安裝期限</span><span>{fmtDate(order.installDeadline)}</span></div>
        <div className="row"><span>金額</span><b>{formatTWD(order.amountCents)}</b></div>
        <div className="row"><span>訂購時間</span><span>{fmtDateTime(order.createdAt)}</span></div>
      </div>

      {(orderRules.canChangeShop(rules) || orderRules.canChangeVehicle(rules)) && (
        <EditOrder order={order} canShop={orderRules.canChangeShop(rules)} campaign={sameCampaign} busy={busy}
          onSave={(body) => act(() => api.patch(`/me/orders/${order.id}`, body), "訂單資料已更新")} />
      )}

      {(orderRules.canCancel(rules) || orderRules.canRequestCancel(rules)) && (
        <CancelOrder immediate={orderRules.canCancel(rules)} busy={busy}
          onSubmit={(reason) => act(() => api.post(`/orders/${order.id}/cancel-request`, { reason }),
            orderRules.canCancel(rules) ? "訂單已取消" : "已送出取消申請，客服會盡快與你聯絡")} />
      )}

      {order.status === "warranty_active" && <p className="ok-note">保固已啟用 🎉 可到「我的帳戶」記錄里程與取得推薦碼。</p>}

      <div className="card">
        <h2>訂單紀錄</h2>
        <ol className="timeline-list">
          {[...order.events].reverse().map((e) => (
            <li key={e.id} className={e.kind}>
              <span className="when">{fmtDateTime(e.createdAt)}</span>
              <span className="what">
                {e.kind === "status" ? ORDER_STATUS_LABELS[e.to] : e.note}
                {e.kind === "status" && e.note && e.to !== "paid" ? `（${e.note}）` : ""}
              </span>
              <span className="who">{actorLabel(e.actor)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function BookingForm(props: {
  title: string;
  hint?: string;
  initial?: string;
  busy: boolean;
  submitLabel: string;
  embedded?: boolean;
  onSubmit: (slotAtIso: string) => Promise<boolean>;
}): ReactElement {
  const [slot, setSlot] = useState(props.initial ? toTaipeiLocalInput(props.initial) : "");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void props.onSubmit(fromTaipeiLocalInput(slot));
  };
  const body = (
    <form onSubmit={submit}>
      {props.embedded ? <h3>{props.title}</h3> : <h2>{props.title}</h2>}
      <div className="field">
        <label htmlFor={`slot-${props.title}`}>日期時間（台灣時間）</label>
        <input id={`slot-${props.title}`} type="datetime-local" required value={slot} onChange={(e) => setSlot(e.target.value)} />
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      <button className="btn" disabled={props.busy}>{props.submitLabel}</button>
    </form>
  );
  return props.embedded ? <div className="subform">{body}</div> : <div className="card">{body}</div>;
}

function EditOrder(props: {
  order: OrderDto;
  canShop: boolean;
  campaign: ReturnType<typeof useCampaign>["page"];
  busy: boolean;
  onSave: (body: UpdateOrderBody) => Promise<boolean>;
}): ReactElement {
  const { order, campaign } = props;
  const [open, setOpen] = useState(false);
  const [shopId, setShopId] = useState(order.shopId);
  const [modelId, setModelId] = useState(order.vehicleModelId);
  const [plate, setPlate] = useState(order.plate);

  if (!open) {
    return (
      <div className="card">
        <h2>修改訂單</h2>
        <p className="hint">
          {props.canShop ? "出貨前可更換安裝店家；" : "輪胎已出貨，無法更換店家；"}完成安裝前可修改車型與車牌。
        </p>
        <button className="btn ghost" onClick={() => setOpen(true)}>修改資料</button>
      </div>
    );
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body: UpdateOrderBody = {};
    if (props.canShop && shopId !== order.shopId) body.shopId = shopId;
    if (modelId !== order.vehicleModelId) body.vehicleModelId = modelId;
    if (plate.trim().toUpperCase() !== order.plate) body.plate = plate.trim();
    if (Object.keys(body).length === 0) return setOpen(false);
    if (await props.onSave(body)) setOpen(false);
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h2>修改訂單</h2>
      {props.canShop && campaign && (
        <div className="field">
          <label htmlFor="edit-shop">安裝店家（出貨前可更換）</label>
          <select id="edit-shop" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            {campaign.shops.map((s) => <option key={s.id} value={s.id}>{s.regionLabel}・{s.name}（{s.city}）</option>)}
          </select>
        </div>
      )}
      {campaign && (
        <div className="field">
          <label htmlFor="edit-model">車型</label>
          <select id="edit-model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {campaign.eligibleModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="edit-plate">車牌號碼</label>
        <input id="edit-plate" required value={plate} onChange={(e) => setPlate(e.target.value)} />
        <p className="hint">安裝當日店家會核對行照上的車牌與車型。</p>
      </div>
      <div className="btn-row">
        <button className="btn" disabled={props.busy}>儲存變更</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>取消</button>
      </div>
    </form>
  );
}

function CancelOrder(props: { immediate: boolean; busy: boolean; onSubmit: (reason: string) => Promise<boolean> }): ReactElement {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="card">
      <h2>{props.immediate ? "取消訂單" : "申請取消"}</h2>
      <p className="hint">
        {props.immediate
          ? "尚未付款的訂單可以直接取消。"
          : "已付款的訂單需由客服確認後辦理退款；送出後你仍可撤回申請。"}
      </p>
      {!open ? (
        <button className="btn ghost" onClick={() => setOpen(true)}>{props.immediate ? "取消這筆訂單" : "我要申請取消"}</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void props.onSubmit(reason).then((ok) => ok && setOpen(false)); }}>
          <div className="field">
            <label htmlFor="cancel-reason">取消原因</label>
            <textarea id="cancel-reason" required minLength={2} maxLength={300} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="btn-row">
            <button className="btn danger" disabled={props.busy}>{props.immediate ? "確認取消" : "送出申請"}</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>先不要</button>
          </div>
        </form>
      )}
    </div>
  );
}
