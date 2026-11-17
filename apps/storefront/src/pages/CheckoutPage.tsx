import { formatTWD, type CampaignPageDto, type OrderDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { checkoutMode, startCheckout } from "../checkout";
import { errorText, fmtDate } from "../format";

interface CheckoutState {
  campaignSlug: string;
  vehicleModelId: string;
  shopId: string;
}

export function CheckoutPage(): ReactElement {
  const state = useLocation().state as CheckoutState | null;
  const nav = useNavigate();
  const [page, setPage] = useState<CampaignPageDto | null>(null);
  const [plate, setPlate] = useState("");
  const [referral, setReferral] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"internal" | "external">("internal");

  useEffect(() => {
    void checkoutMode().then(setMode);
  }, []);

  useEffect(() => {
    if (state) api.get<CampaignPageDto>(`/campaigns/${state.campaignSlug}`).then(setPage).catch((e: unknown) => setError(errorText(e)));
  }, [state]);

  if (!state) return <Navigate to="/" replace />;
  if (!page) return <div className="page">{error ? <ErrorNote message={error} /> : <Spinner />}</div>;

  const model = page.eligibleModels.find((m) => m.id === state.vehicleModelId);
  const shop = page.shops.find((s) => s.id === state.shopId);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let order: OrderDto | null = null;
    try {
      order = await api.post<OrderDto>("/orders", {
        campaignSlug: state.campaignSlug,
        vehicleModelId: state.vehicleModelId,
        shopId: state.shopId,
        plate: plate.trim(),
        deadlineAcknowledged: true,
        ...(referral.trim() ? { referralCode: referral.trim() } : {})
      });
      if (await startCheckout(order.id)) return; // leaving for the external cart
      nav(`/orders/${order.id}`, { replace: true });
    } catch (ex) {
      setError(errorText(ex));
      // The order exists but payment failed: the order page lets the shopper retry or cancel.
      if (order) nav(`/orders/${order.id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>確認訂單</h1>
      <div className="card">
        <h2>{page.title}</h2>
        <div className="row"><span>車型</span><span>{model?.label}</span></div>
        <div className="row"><span>安裝店家</span><span>{shop?.name}（{shop?.address}）</span></div>
        <div className="row"><span>安裝期限</span><span>{fmtDate(page.installDeadline)}</span></div>
        <div className="row"><span>應付金額</span><b>{formatTWD(page.product.salePriceCents)}</b></div>
      </div>
      <form className="card" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="plate">車牌號碼</label>
          <input id="plate" required placeholder="例如 ABC-1234" value={plate} onChange={(e) => setPlate(e.target.value)} />
          <p className="hint">用於店家核對行照與車型資格。</p>
        </div>
        <div className="field">
          <label htmlFor="ref">推薦碼（選填）</label>
          <input id="ref" value={referral} onChange={(e) => setReferral(e.target.value)} />
        </div>
        {error && <ErrorNote message={error} />}
        <p className="fine" style={{ fontSize: 12, color: "var(--dim)" }}>
          {mode === "external"
            ? "下一步將前往購物車頁面完成付款，付款完成後會自動回到這裡。"
            : `${page.content.paymentNote}。本站目前使用示範金流，不會真的扣款。`}
        </p>
        <div className="btn-row">
          <button className="btn" disabled={busy}>
            {busy ? "處理中…" : mode === "external" ? `前往結帳 ${formatTWD(page.product.salePriceCents)}` : `確認付款 ${formatTWD(page.product.salePriceCents)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
