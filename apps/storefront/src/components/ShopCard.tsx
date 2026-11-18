import { REGIONS, REGION_LABELS, type Region, type ShopDto } from "@vsev/shared";
import type { ReactElement } from "react";

export const mapsUrl = (s: ShopDto): string =>
  `https://www.google.com/maps/search/${encodeURIComponent(`${s.name} ${s.address}`)}`;

export function ShopCard({
  shop,
  selected = false,
  actionLabel,
  onAction
}: {
  shop: ShopDto;
  selected?: boolean;
  actionLabel: string;
  onAction: () => void;
}): ReactElement {
  return (
    <div className={`shop-card${selected ? " selected" : ""}`}>
      <div className="shop-top"><span className="shop-name">{shop.name}</span><span className="shop-region">{shop.city}</span></div>
      <div className="shop-addr">{shop.address}</div>
      <div className="shop-meta">
        <span className={shop.openNow ? "open" : ""}>{shop.openNow ? "● 營業中" : "○ 休息中"}</span>
        <span>{shop.hoursLabel}</span>
      </div>
      <div className="shop-actions">
        {shop.phone && <a href={`tel:${shop.phone}`}>☎ {shop.phone}</a>}
        <a href={mapsUrl(shop)} target="_blank" rel="noopener noreferrer">➤ 導航</a>
        <button className="pick" onClick={onAction}>{actionLabel}</button>
      </div>
    </div>
  );
}

export function RegionChips({
  shops,
  value,
  onChange
}: {
  shops: ShopDto[];
  value: Region | "all";
  onChange: (r: Region | "all") => void;
}): ReactElement {
  return (
    <div className="region-rail" role="group" aria-label="地區篩選">
      <button className="chip" aria-pressed={value === "all"} onClick={() => onChange("all")}>全部 ({shops.length})</button>
      {REGIONS.filter((r) => shops.some((s) => s.region === r)).map((r) => (
        <button key={r} className="chip" aria-pressed={value === r} onClick={() => onChange(r)}>
          {REGION_LABELS[r]} ({shops.filter((s) => s.region === r).length})
        </button>
      ))}
    </div>
  );
}
