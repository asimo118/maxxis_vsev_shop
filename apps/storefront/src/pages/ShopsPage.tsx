import type { Region } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCampaign } from "../campaign";
import { CoverageBox } from "../components/CoverageBox";
import { RegionChips, ShopCard } from "../components/ShopCard";
import { SiteFooter } from "../components/SiteFooter";

export function ShopsPage(): ReactElement {
  const { page, error } = useCampaign();
  const nav = useNavigate();
  const [region, setRegion] = useState<Region | "all">("all");
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  const shops = page?.shops ?? [];
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return shops
      .filter((s) => region === "all" || s.region === region)
      .filter((s) => !openOnly || s.openNow)
      .filter((s) => !needle || `${s.name} ${s.city} ${s.address}`.toLowerCase().includes(needle));
  }, [shops, region, q, openOnly]);

  if (error) return <div className="wrap"><ErrorNote message={error} /></div>;
  if (!page) return <div className="wrap"><Spinner /></div>;

  return (
    <>
      <div className="wrap">
        <div className="crumb"><Link to="/">活動首頁</Link> / <b>安裝據點</b></div>
        <section className="page-hero compact">
          <div>
            <h1>安裝據點<small>{shops.length} 家配合店家・輪胎直送你選擇的店</small></h1>
            <p className="lead">選好店家後按「選這家訂購」，會帶回訂購頁並自動填入。安裝當日請攜帶行照。</p>
          </div>
        </section>

        <div className="shop-tools">
          <input
            type="search"
            placeholder="搜尋店名、城市或地址"
            aria-label="搜尋店家"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> 只看營業中
          </label>
        </div>
        <RegionChips shops={shops} value={region} onChange={setRegion} />

        {visible.length === 0 ? (
          <p className="empty">沒有符合的店家。試試其他地區或關鍵字。</p>
        ) : (
          <div className="shop-grid">
            {visible.map((s) => (
              <ShopCard key={s.id} shop={s} actionLabel="選這家訂購" onAction={() => nav(`/?shop=${encodeURIComponent(s.id)}`)} />
            ))}
          </div>
        )}
        <CoverageBox note={page.content.coverageNote} />
      </div>
      <SiteFooter contact={page.content.contact} />
    </>
  );
}
