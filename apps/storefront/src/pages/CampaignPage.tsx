import {
  REGIONS,
  REGION_LABELS,
  SEED_CAMPAIGN,
  evaluateCtaGate,
  formatTWD,
  type CampaignPageDto,
  type Region
} from "@vsev/shared";
import { ErrorNote, Spinner, TreadDivider } from "@vsev/ui";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { errorText, fmtMonthDay, sessionId } from "../format";

const SLUG = (import.meta.env["VITE_CAMPAIGN_SLUG"] as string | undefined) ?? SEED_CAMPAIGN.slug;

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

function beacon(event: string): void {
  void api.post("/track", { sessionId: sessionId(), event, campaignSlug: SLUG }).catch(() => undefined);
}

export function CampaignPage(): ReactElement {
  const nav = useNavigate();
  const [page, setPage] = useState<CampaignPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    api
      .get<CampaignPageDto>(`/campaigns/${SLUG}`)
      .then((p) => {
        setPage(p);
        once("page_view");
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

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
                {c.specs.map((s) => (
                  <tr key={s.label}><th>{s.label}</th><td>{s.value}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="ev-points">
              {c.evPoints.map((p) => (
                <div className="ev-card" key={p.title}><b>{p.title}</b><p>{p.body}</p></div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <TreadDivider />
      <div className="wrap">
        <section className="sec" id="shops">
          <div className="sec-head"><h2>選擇安裝店家</h2><span>{shops.length} 家配合據點・輪胎將直送你選擇的店家</span></div>
          <p className="selector-note">依地區篩選，點「選這家」後會自動帶入上方訂單。</p>
          <div className="region-rail" role="group" aria-label="地區篩選">
            <button className="chip" aria-pressed={region === "all"} onClick={() => setRegion("all")}>全部 ({shops.length})</button>
            {REGIONS.filter((r) => shops.some((s) => s.region === r)).map((r) => (
              <button key={r} className="chip" aria-pressed={region === r} onClick={() => setRegion(r)}>
                {REGION_LABELS[r]} ({shops.filter((s) => s.region === r).length})
              </button>
            ))}
          </div>
          <div className="shop-grid">
            {visible.map((s) => (
              <div key={s.id} className={`shop-card${s.id === shopId ? " selected" : ""}`}>
                <div className="shop-top"><span className="shop-name">{s.name}</span><span className="shop-region">{s.city}</span></div>
                <div className="shop-addr">{s.address}</div>
                <div className="shop-meta">
                  <span className={s.openNow ? "open" : ""}>{s.openNow ? "● 營業中" : "○ 休息中"}</span>
                  <span>{s.hoursLabel}</span>
                </div>
                <div className="shop-actions">
                  {s.phone && <a href={`tel:${s.phone}`}>☎ 電話</a>}
                  <a href={`https://www.google.com/maps/search/${encodeURIComponent(`${s.name} ${s.address}`)}`} target="_blank" rel="noopener noreferrer">➤ 導航</a>
                  <button
                    className="pick"
                    onClick={() => {
                      setShopId(s.id);
                      once("shop_selected");
                      panelRef.current?.scrollIntoView({ block: "center" });
                    }}
                  >
                    {s.id === shopId ? "✓ 已選擇" : "選這家"}
                  </button>
                </div>
              </div>
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
          {c.faq.map((f) => (
            <details key={f.q}><summary>{f.q}</summary><div className="a">{f.a}</div></details>
          ))}
        </section>
      </div>

      <footer>
        {c.contact.company}・{c.contact.address}
        <br />
        客服專線 {c.contact.phone}（{c.contact.hours}）・{c.contact.email}
      </footer>

      <div className="sticky-cta">
        <div className="p">{priceLabel}<small>4 條完工價</small></div>
        <button onClick={() => panelRef.current?.scrollIntoView({ block: "center" })}>立即訂購</button>
      </div>
    </>
  );
}

function CoverageBox({ note }: { note: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/coverage-requests", { city, ...(email ? { email } : {}) });
      setDone(true);
    } catch (ex) {
      setErr(errorText(ex));
    }
  };

  return (
    <div className="coverage">
      <b>你所在的區域沒有據點？</b> {note}{" "}
      {!open && <button className="link" onClick={() => setOpen(true)}>告訴我們你在哪裡</button>}
      {open && !done && (
        <form onSubmit={(e) => void submit(e)}>
          <input required placeholder="縣市，例如：台北市" value={city} onChange={(e) => setCity(e.target.value)} />
          <input type="email" placeholder="Email（選填，有據點時通知你）" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" type="submit">送出</button>
          {err && <ErrorNote message={err} />}
        </form>
      )}
      {done && <p className="ok-note">已收到，謝謝你！</p>}
    </div>
  );
}
