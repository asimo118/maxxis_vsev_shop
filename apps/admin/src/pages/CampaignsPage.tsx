import { formatTWD, type AdminCampaignRowDto, type ShopDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";
import type { AdminCampaignDetailDto } from "@vsev/shared";

export function CampaignsPage(): ReactElement {
  const { can } = useAdmin();
  const list = useResource<AdminCampaignRowDto[]>("/campaigns");
  const shops = useResource<ShopDto[]>("/shops");
  const [sel, setSel] = useState<AdminCampaignDetailDto | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const open = async (id: string): Promise<void> => {
    setError(null);
    setMsg(null);
    try {
      const [detail, ids] = await Promise.all([
        api.get<AdminCampaignDetailDto>(`/campaigns/${id}`),
        api.get<{ shopIds: string[] }>(`/campaigns/${id}/shops`)
      ]);
      setSel(detail);
      setAssigned(new Set(ids.shopIds));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const post = async (path: string, body?: unknown): Promise<void> => {
    setError(null);
    try {
      await api.post(path, body);
      list.reload();
      setMsg("已更新");
    } catch (e) {
      setError(errorText(e));
    }
  };
  const saveShops = async (): Promise<void> => {
    if (!sel) return;
    try {
      await api.put(`/campaigns/${sel.id}/shops`, { shopIds: [...assigned] });
      setMsg(`已儲存 ${assigned.size} 家據點，前台快取已更新`);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const manager = can("manager");
  return (
    <>
      <h1>活動</h1>
      {error && <ErrorNote message={error} />}
      {msg && <p style={{ color: "var(--ok)" }}>{msg}</p>}
      <div className="card">
        {!list.data ? <Spinner /> : (
          <table className="t"><thead><tr><th>活動</th><th>狀態</th><th>訂購截止</th><th>安裝截止</th><th>據點</th><th /></tr></thead>
            <tbody>{list.data.map((c) => (
              <tr key={c.id}>
                <td>{c.title}<br /><small>{c.slug}</small></td><td><span className="pill hot">{c.status}</span></td>
                <td>{fmtDateTime(c.orderDeadline)}</td><td>{fmtDateTime(c.installDeadline)}</td><td>{c.shopCount}</td>
                <td>
                  <button className="link" onClick={() => void open(c.id)}>檢視</button>
                  {manager && c.status !== "live" && <>{"\u3000"}<button className="link" onClick={() => void post(`/campaigns/${c.id}/publish`)}>上架</button></>}
                  {manager && c.status === "live" && <>{"\u3000"}<button className="link" onClick={() => window.confirm("確定結束活動？") && void post(`/campaigns/${c.id}/end`)}>結束</button></>}
                  {manager && <>{"\u3000"}<button className="link" onClick={() => { const slug = window.prompt("新活動 slug（kebab-case）"); if (slug) void post(`/campaigns/${c.id}/clone`, { slug }); }}>複製</button></>}
                </td>
              </tr>))}</tbody></table>
        )}
      </div>
      {sel && (
        <div className="card">
          <h2>{sel.title}</h2>
          <div className="row"><span>售價 / 定價</span><span>{formatTWD(sel.salePriceCents)} / {formatTWD(sel.listPriceCents)}</span></div>
          <div className="row"><span>適用車型</span><span>{sel.eligibleModelIds.join("、")}</span></div>
          <h2 style={{ marginTop: 16 }}>配合據點</h2>
          <div className="grid2">
            {(shops.data ?? []).map((s) => (
              <label key={s.id} style={{ fontSize: 14 }}>
                <input type="checkbox" disabled={!can("operator", "manager")} checked={assigned.has(s.id)}
                  onChange={(e) => { const next = new Set(assigned); if (e.target.checked) next.add(s.id); else next.delete(s.id); setAssigned(next); }} />{" "}
                {s.name}（{s.regionLabel}）{!s.active && <span className="pill">停用</span>}
              </label>
            ))}
          </div>
          {can("operator", "manager") && <div className="btn-row"><button className="btn" onClick={() => void saveShops()}>儲存據點</button></div>}
          <p style={{ fontSize: 12.5, color: "var(--dim)" }}>價格、期限與頁面文案目前請透過 API（PUT /admin/campaigns/:id）修改；表單編輯器列為後續項目。</p>
        </div>
      )}
    </>
  );
}
