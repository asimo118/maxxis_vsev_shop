import { formatTWD } from "@vsev/shared";
import { ErrorNote, Spinner, TreadDivider } from "@vsev/ui";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useCampaign } from "../campaign";
import { SiteFooter } from "../components/SiteFooter";

export function SpecPage(): ReactElement {
  const { page, error } = useCampaign();
  if (error) return <div className="wrap"><ErrorNote message={error} /></div>;
  if (!page) return <div className="wrap"><Spinner /></div>;
  const c = page.content;
  return (
    <>
      <div className="wrap">
        <div className="crumb"><Link to="/">活動首頁</Link> / <b>產品規格</b></div>
        <section className="page-hero">
          <div>
            <p className="eyebrow">{c.eyebrow}</p>
            <h1>{page.product.name}<small>{page.product.sizeLabel}</small></h1>
            <p className="lead">為電動車的重量、瞬間扭力與靜音需求而設計。以下是本次車主方案的完整規格。</p>
          </div>
          <div className="hero-buy">
            <div className="price-row">
              <span className="was">{formatTWD(page.product.listPriceCents)}</span>
              <span className="now">{formatTWD(page.product.salePriceCents)}</span>
              <span className="per">/ 4 條完工價</span>
            </div>
            <p className="price-meta">✓ 已含{page.product.includes.join("、")}</p>
            <Link className="cta as-link" to="/">選擇車型與店家，立即訂購</Link>
          </div>
        </section>
      </div>

      <TreadDivider />
      <div className="wrap">
        <section className="sec">
          <div className="sec-head"><h2>規格表</h2><span>{page.product.name}・{page.product.sizeLabel}</span></div>
          <table className="spec spec-full">
            <tbody>
              {c.specs.map((s) => (
                <tr key={s.label}><th>{s.label}</th><td>{s.value}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sec">
          <div className="sec-head"><h2>為什麼電動車需要 EV 專用胎</h2></div>
          <div className="ev-points ev-points-wide">
            {c.evPoints.map((p) => (
              <div className="ev-card" key={p.title}><b>{p.title}</b><p>{p.body}</p></div>
            ))}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head"><h2>方案內容</h2></div>
          <ul className="includes">
            {page.product.includes.map((i) => <li key={i}>✓ {i}</li>)}
          </ul>
          <p className="selector-note">
            適用車型：{page.eligibleModels.map((m) => m.label).join("、")}。還有疑問？看看 <Link to="/faq">常見問題</Link>。
          </p>
        </section>
      </div>
      <SiteFooter contact={c.contact} />
    </>
  );
}
