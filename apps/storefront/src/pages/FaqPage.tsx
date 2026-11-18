import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useCampaign } from "../campaign";
import { SiteFooter } from "../components/SiteFooter";

export function FaqPage(): ReactElement {
  const { page, error } = useCampaign();
  const [q, setQ] = useState("");
  if (error) return <div className="wrap"><ErrorNote message={error} /></div>;
  if (!page) return <div className="wrap"><Spinner /></div>;

  const c = page.content;
  const needle = q.trim().toLowerCase();
  const items = c.faq.filter((f) => !needle || `${f.q} ${f.a}`.toLowerCase().includes(needle));

  return (
    <>
      <div className="wrap narrow">
        <div className="crumb"><Link to="/">活動首頁</Link> / <b>常見問題</b></div>
        <section className="page-hero compact">
          <div>
            <h1>常見問題<small>訂購、安裝、保固與退換</small></h1>
          </div>
        </section>
        <input
          className="faq-search"
          type="search"
          placeholder="輸入關鍵字，例如：安裝期限、更換店家、行照"
          aria-label="搜尋常見問題"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <section className="sec faq-list">
          {items.length === 0 && <p className="empty">找不到相關問題，歡迎直接聯絡客服。</p>}
          {items.map((f, i) => (
            <details key={f.q} open={i === 0 && !needle}>
              <summary>{f.q}</summary>
              <div className="a">{f.a}</div>
            </details>
          ))}
        </section>
        <div className="card contact-card">
          <h2>還是找不到答案？</h2>
          <p>客服專線 <a href={`tel:${c.contact.phone}`}>{c.contact.phone}</a>（{c.contact.hours}）</p>
          <p>Email <a href={`mailto:${c.contact.email}`}>{c.contact.email}</a></p>
          <p>訂單相關問題，也可以到 <Link to="/orders">我的訂單</Link> 直接修改或申請取消。</p>
        </div>
      </div>
      <SiteFooter contact={c.contact} />
    </>
  );
}
