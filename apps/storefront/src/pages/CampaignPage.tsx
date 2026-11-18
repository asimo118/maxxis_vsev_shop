import { evaluateCtaGate, formatTWD, type Region } from "@vsev/shared";
import { ErrorNote, Spinner, TreadDivider } from "@vsev/ui";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { beacon, useCampaign } from "../campaign";
import { CoverageBox } from "../components/CoverageBox";
import { RegionChips, ShopCard } from "../components/ShopCard";
import { SiteFooter } from "../components/SiteFooter";
import { fmtMonthDay } from "../format";

/** How many spec rows / FAQ items the landing page previews before linking to the full page. */
const PREVIEW_SPECS = 4;
const PREVIEW_FAQ = 3;

function useCountdown(endIso: string | undefined): string {
  const [text, setText] = useState("--天 --:--:--");
  useEffect(() => {
    if (!endIso) return;
    const end = new Date(endIso).getTime();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const tick = (): void => {
      const d = Math.max(0, end - Date.now());
      const days = Math.floor(d / 864e5);
      const h = Math.floor((d % 864e5) / 36e5);
      const m = Math.floor((d % 36e5) / 6e4);
      const s = Math.floor((d % 6e4) / 1e3);
      setText(`${days}天 ${pad(h)}:${pad(m)}:${pad(s)}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endIso]);
  return text;
}

export function CampaignPage(): ReactElement {
  const nav = useNavigate();
  const { page, error } = useCampaign();
  const [params, setParams] = useSearchParams();
  const [modelId, setModelId] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [region, setRegion] = useState<Region | "all">("all");
  const panelRef = useRef<HTMLElement>(null);
  const countdown = useCountdown(page?.orderDeadline);
  const sent = useRef(new Set<string>());

  const once = (event: string): void => {
    if (sent.current.has(event)) return;
    sent.current.add(event);
    beacon(event);
  };

  useEffect(() => {
    if (page) once("page_view");
    // Runs once per loaded page.
  }, [page]);

  // Arriving from the shop directory (/shops → "選這家訂購") pre-selects that shop.
  const preselect = params.get("shop");
  useEffect(() => {
    if (!page || !preselect) return;
    if (page.shops.some((s) => s.id === preselect)) {
      setShopId(preselect);
      once("shop_selected");
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "center" }));
    }
    setParams((p) => {
      p.delete("shop");
      return p;
    }, { replace: true });
    // Reacts to the query parameter only.
  }, [page, preselect]);

  const shops = page?.shops ?? [];
  const visible = region === "all" ? shops : shops.filter((s) => s.region === region);
  const selectedShop = shops.find((s) => s.id === shopId) ?? null;
  const priceLabel = page ? formatTWD(page.product.salePriceCents) : "";
  const gate = useMemo(
    () => evaluateCtaGate({ vehicleModelId: modelId, shopId, deadlineAcknowledged: ack, priceLabel }),
    [modelId, shopId, ack, priceLabel]
  );

  if (error) return <div className="wrap"><ErrorNote message={error} /></div>;
  if (!page) return <div className="wrap"><Spinner /></div>;

  const c = page.content;
  const orderDay = fmtMonthDay(page.orderDeadline);
  const installDay = fmtMonthDay(page.installDeadline);
  const goCheckout = (): void => {
    if (!gate.ready) return;
    once("checkout_started");
    nav("/checkout", { state: { campaignSlug: page.slug, vehicleModelId: modelId, shopId } });
  };

  return (
    <>
      <div className="deadline-bar" role="status">
        <span className="tag">車主限定</span>
        <span>
          訂購截止 {orderDay}・剩 <span className="count">{countdown}</span>
        </span>
        <small>下單後請於 {installDay} 前完成安裝</small>
      </div>

      <div className="wrap">
        <div className="crumb">
          電動車胎 / VICTRA SPORT EV+ / <b>BMW iX2・X2 限定方案</b>
        </div>

        <section className="hero">
          <div>
            <div className="stage">
              <span className="badge-ev">EV Optimized</span>
              <div className="tire-visual">
                <div className="tire" role="img" aria-label="MAXXIS VS-EV+ 輪胎示意圖" />
              </div>
              <div className="caption">
                <span>VICTRA SPORT EV+</span>
                <span>{page.product.sizeLabel}</span>
              </div>
            </div>
            <div className="flow">
              <h3>How It Works</h3>
              <ol>
                {c.steps.map((s) => (
                  <li key={s.title}>
                    <b>{s.title}</b>
                    <p>{s.body}</p>
                  </li>
                ))}
              </ol>
              <p className="note">{c.directShipNote}</p>
            </div>
          </div>

          <aside className="panel" aria-label="購買資訊" ref={panelRef}>
            <p className="eyebrow">{c.eyebrow}</p>
            <h1>
              {page.title}
              <small>{page.subtitle}</small>
            </h1>
            <div className="price-row">
              <span className="was">{formatTWD(page.product.listPriceCents)}</span>
              <span className="now">{priceLabel}</span>
              <span className="per">/ 4 條完工價</span>
            </div>
            <p className="price-meta">✓ 已含{page.product.includes.join("、")}，無其他到店費用</p>

            <div className="field">
              <label htmlFor="model">你的車型（活動資格驗證）</label>
              <select
                id="model"
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  if (e.target.value) once("model_selected");
                }}
              >
                <option value="">請選擇車型</option>
                {page.eligibleModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="hint">安裝當日請攜帶行照，店家將核對車型資格。</p>
            </div>

            <div className={`shop-slot${selectedShop ? " filled" : ""}`}>
              <span>
                {selectedShop ? (
                  <>
                    <b>{selectedShop.name}</b>{"\u3000"}<span style={{ color: "var(--dim)", fontSize: 13 }}>{selectedShop.address}</span>
                  </>
                ) : (
                  "尚未選擇安裝店家"
                )}
              </span>
              <button className="go" onClick={() => document.getElementById("shops")?.scrollIntoView()}>
                {selectedShop ? "更改 ↓" : "前往選擇 ↓"}
              </button>
            </div>

            <label className="confirm">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => {
                  setAck(e.target.checked);
                  if (e.target.checked) once("deadline_acknowledged");
                }}
              />
              <span>
                我了解需於 <b style={{ color: "var(--ink)" }}>{installDay} 前完成安裝</b>，逾期視同放棄活動優惠。
              </span>
            </label>

            <button className="cta" disabled={!gate.ready} onClick={goCheckout}>
              {gate.label}
            </button>
            <p className="fine">
              {c.paymentNote}
            </p>
          </aside>
        </section>
      </div>

      <TreadDivider />
      <div className="wrap">
        <section className="sec" id="spec">
          <div className="sec-head"><h2>產品規格</h2><span>為什麼電動車需要 EV 專用胎</span></div>
          <div className="spec-grid">
            <table className="spec">
              <tbody>
                {c.specs.slice(0, PREVIEW_SPECS).map((s) => (
                  <tr key={s.label}><th>{s.label}</th><td>{s.value}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="ev-points">
              {c.evPoints.slice(0, 2).map((p) => (
                <div className="ev-card" key={p.title}><b>{p.title}</b><p>{p.body}</p></div>
              ))}
            </div>
          </div>
          <Link className="more-link" to="/spec">查看完整產品規格 →</Link>
        </section>
      </div>

      <TreadDivider />
      <div className="wrap">
        <section className="sec" id="shops">
          <div className="sec-head"><h2>選擇安裝店家</h2><span>{shops.length} 家配合據點・輪胎將直送你選擇的店家</span></div>
          <p className="selector-note">
            依地區篩選，點「選這家」後會自動帶入上方訂單。想看營業時間、搜尋店名？<Link to="/shops">到安裝據點頁 →</Link>
          </p>
          <RegionChips shops={shops} value={region} onChange={setRegion} />
          <div className="shop-grid">
            {visible.map((s) => (
              <ShopCard
                key={s.id}
                shop={s}
                selected={s.id === shopId}
                actionLabel={s.id === shopId ? "✓ 已選擇" : "選這家"}
                onAction={() => {
                  setShopId(s.id);
                  once("shop_selected");
                  panelRef.current?.scrollIntoView({ block: "center" });
                }}
              />
            ))}
          </div>
          <CoverageBox note={c.coverageNote} />
        </section>
      </div>

      <TreadDivider />
      <div className="wrap">
        <section className="sec">
          <div className="sec-head"><h2>下單後會發生什麼</h2><span>每個節點都會通知你，不用自己追</span></div>
          <div className="timeline">
            {c.timeline.map((t) => (
              <div className="tl" key={t.title}><em>{t.tag}</em><b>{t.title}</b>{t.body}</div>
            ))}
          </div>
        </section>
      </div>

      <TreadDivider />
      <div className="wrap">
        <section className="sec" id="reviews">
          <div className="sec-head"><h2>車主評價</h2><span>{c.reviewSummary.rating} / 5・來自 {c.reviewSummary.count} 位已完成安裝的車主</span></div>
          <div className="reviews">
            {c.reviews.map((r) => (
              <div className="review" key={r.body}>
                <div className="stars">{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</div>
                <p>{r.body}</p>
                <div className="who">{r.who} <span>・{r.where}</span></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="wrap">
        <section className="sec" id="faq">
          <div className="sec-head"><h2>常見問題</h2></div>
          {c.faq.slice(0, PREVIEW_FAQ).map((f) => (
            <details key={f.q}><summary>{f.q}</summary><div className="a">{f.a}</div></details>
          ))}
          {c.faq.length > PREVIEW_FAQ && <Link className="more-link" to="/faq">看全部 {c.faq.length} 個問題 →</Link>}
        </section>
      </div>

      <SiteFooter contact={c.contact} />

      <div className="sticky-cta">
        <div className="p">{priceLabel}<small>4 條完工價</small></div>
        <button onClick={() => panelRef.current?.scrollIntoView({ block: "center" })}>立即訂購</button>
      </div>
    </>
  );
}
