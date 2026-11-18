import {
  REGIONS,
  REGION_LABELS,
  type AdminCampaignRowDto,
  type ConnectorStatusDto,
  type CoverageGapDto,
  type Region,
  type ShopDto,
  type ShopUpsertBody
} from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

const WEEKDAYS: [number, string][] = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [7, "日"]];

interface Form {
  name: string;
  region: Region;
  city: string;
  address: string;
  phone: string;
  open: string;
  close: string;
  days: number[];
  active: boolean;
  /** New shops only: also add it to the live campaign so it appears on the storefront right away. */
  joinCampaign: boolean;
}

const blank: Form = {
  name: "", region: "taichung", city: "", address: "", phone: "",
  open: "09:00", close: "18:00", days: [1, 2, 3, 4, 5, 6], active: true, joinCampaign: true
};

const fromShop = (s: ShopDto): Form => ({
  name: s.name, region: s.region, city: s.city, address: s.address, phone: s.phone ?? "",
  open: s.hours.open, close: s.hours.close, days: [...s.hours.days], active: s.active, joinCampaign: false
});

const toBody = (f: Form): ShopUpsertBody => ({
  name: f.name.trim(), region: f.region, city: f.city.trim(), address: f.address.trim(),
  phone: f.phone.trim() || null, hours: { open: f.open, close: f.close, days: [...f.days].sort() }, active: f.active
});

export function ShopsPage(): ReactElement {
  const { can } = useAdmin();
  const shops = useResource<ShopDto[]>("/shops");
  const gaps = useResource<CoverageGapDto[]>("/coverage-gaps");
  const connectors = useResource<ConnectorStatusDto[]>("/connectors");
  const campaigns = useResource<AdminCampaignRowDto[]>("/campaigns");
  const live = campaigns.data?.find((c) => c.status === "live") ?? null;
  const [liveShopIds, setLiveShopIds] = useState<Set<string>>(new Set());
  const external = connectors.data?.find((c) => c.name === "shops")?.mode === "http";
  const canWrite = can("operator", "manager") && connectors.data !== null && !external;

  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<ShopDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const loadLiveShops = (id: string): void => {
    api.get<{ shopIds: string[] }>(`/campaigns/${id}/shops`).then((r) => setLiveShopIds(new Set(r.shopIds))).catch(() => undefined);
  };
  useEffect(() => {
    if (live) loadLiveShops(live.id);
  }, [live?.id]); // re-run only when the id changes

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (shops.data ?? []).filter((s) => !needle || `${s.name} ${s.city} ${s.address}`.toLowerCase().includes(needle));
  }, [shops.data, q]);

  const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm({ ...form, [key]: value });
  const toggleDay = (d: number): void =>
    set("days", form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d]);

  const startNew = (): void => {
    setEditing(null);
    setForm(blank);
    setFormOpen(true);
    setNotice(null);
  };
  const startEdit = (s: ShopDto): void => {
    setEditing(s);
    setForm(fromShop(s));
    setFormOpen(true);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (form.days.length === 0) return setError("請至少勾選一個營業日。");
    if (form.close <= form.open) return setError("打烊時間必須晚於開店時間。");
    try {
      if (editing) {
        await api.put(`/shops/${editing.id}`, toBody(form));
        setNotice(`已更新「${form.name}」`);
      } else {
        const created = await api.post<ShopDto>("/shops", toBody(form));
        if (form.joinCampaign && live) {
          const ids = new Set(liveShopIds).add(created.id);
          await api.put(`/campaigns/${live.id}/shops`, { shopIds: [...ids] });
          loadLiveShops(live.id);
        }
        setNotice(`已新增「${created.name}」${form.joinCampaign && live ? `，並加入活動「${live.title}」` : ""}`);
      }
      setFormOpen(false);
      setEditing(null);
      shops.reload();
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const toggleActive = async (s: ShopDto): Promise<void> => {
    try {
      await api.put(`/shops/${s.id}`, { ...toBody(fromShop(s)), active: !s.active });
      shops.reload();
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const toggleInCampaign = async (s: ShopDto): Promise<void> => {
    if (!live) return;
    const ids = new Set(liveShopIds);
    if (ids.has(s.id)) ids.delete(s.id);
    else ids.add(s.id);
    try {
      await api.put(`/campaigns/${live.id}/shops`, { shopIds: [...ids] });
      setLiveShopIds(ids);
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  return (
    <>
      <h1>店家管理</h1>
      {error && <ErrorNote message={error} />}
      {notice && <p className="notice">{notice}</p>}
      {external && (
        <p className="card" style={{ fontSize: 14 }}>
          店家清單由外部系統同步（唯讀）。新增或修改請到來源系統，或到「外部連接」立即同步。活動的配合據點仍可在下方勾選。
        </p>
      )}

      {canWrite && !formOpen && (
        <div className="btn-row"><button className="btn" onClick={startNew}>＋ 新增店家</button></div>
      )}

      {canWrite && formOpen && (
        <form className="card" onSubmit={(e) => void save(e)}>
          <h2>{editing ? `編輯：${editing.name}` : "新增店家"}</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="s-name">店名</label><input id="s-name" required maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field"><label htmlFor="s-phone">電話（未填則前台不顯示）</label><input id="s-phone" maxLength={30} placeholder="04-2345-6789" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            <div className="field"><label htmlFor="s-region">地區</label>
              <select id="s-region" value={form.region} onChange={(e) => set("region", e.target.value as Region)}>
                {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </select></div>
            <div className="field"><label htmlFor="s-city">城市</label><input id="s-city" required maxLength={20} placeholder="台中" value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="s-addr">地址</label><input id="s-addr" required maxLength={200} value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
          <div className="grid2">
            <div className="field">
              <span className="label">營業日</span>
              <div className="day-picker" role="group" aria-label="營業日">
                {WEEKDAYS.map(([d, label]) => (
                  <label key={d} className={form.days.includes(d) ? "on" : ""}>
                    <input type="checkbox" checked={form.days.includes(d)} onChange={() => toggleDay(d)} />週{label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="s-open">開店</label><input id="s-open" type="time" required value={form.open} onChange={(e) => set("open", e.target.value)} /></div>
              <div className="field"><label htmlFor="s-close">打烊</label><input id="s-close" type="time" required value={form.close} onChange={(e) => set("close", e.target.value)} /></div>
            </div>
          </div>
          <label className="check-line"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> 上架（停用的店家不會出現在前台，也不能被選為安裝店家）</label>
          {!editing && live && (
            <label className="check-line"><input type="checkbox" checked={form.joinCampaign} onChange={(e) => set("joinCampaign", e.target.checked)} /> 同時加入活動「{live.title}」，前台立即可選</label>
          )}
          <div className="btn-row">
            <button className="btn">{editing ? "儲存" : "新增"}</button>
            <button type="button" className="btn ghost" onClick={() => { setFormOpen(false); setEditing(null); setError(null); }}>取消</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="card-head">
          <h2>店家（{shops.data?.length ?? 0}）</h2>
          <input type="search" placeholder="搜尋店名、城市、地址" aria-label="搜尋店家" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!shops.data ? <Spinner /> : (
          <table className="t"><thead><tr><th>店名</th><th>地區</th><th>地址／電話</th><th>營業時間</th><th>狀態</th>{live && <th>活動據點</th>}<th /></tr></thead>
            <tbody>{visible.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.regionLabel}・{s.city}</td><td>{s.address}{s.phone && <><br /><small>{s.phone}</small></>}</td><td>{s.hoursLabel}</td>
                <td><span className={`pill${s.active ? " ok" : ""}`}>{s.active ? "上架" : "停用"}</span></td>
                {live && (
                  <td>
                    <label className="check-line" title={`活動「${live.title}」`}>
                      <input type="checkbox" disabled={!can("operator", "manager")} checked={liveShopIds.has(s.id)} onChange={() => void toggleInCampaign(s)} />
                      {liveShopIds.has(s.id) ? "參加中" : "未參加"}
                    </label>
                  </td>
                )}
                <td className="nowrap">{canWrite && <><button className="link" onClick={() => startEdit(s)}>編輯</button>{"　"}<button className="link" onClick={() => void toggleActive(s)}>{s.active ? "停用" : "啟用"}</button></>}</td>
              </tr>))}</tbody></table>
        )}
      </div>
      <div className="card">
        <h2>覆蓋缺口（客人留下的需求地區）</h2>
        {gaps.data && gaps.data.length === 0 && <p style={{ color: "var(--dim)" }}>目前沒有留言。</p>}
        <table className="t"><tbody>{(gaps.data ?? []).map((g) => <tr key={g.city}><td>{g.city}</td><td>{g.requests} 人</td><td>{fmtDateTime(g.latestAt)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
