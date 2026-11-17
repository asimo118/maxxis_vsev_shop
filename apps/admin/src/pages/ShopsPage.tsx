import { REGIONS, REGION_LABELS, type ConnectorStatusDto, type CoverageGapDto, type Region, type ShopDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type FormEvent, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

const blank = { name: "", region: "taichung" as Region, city: "", address: "", phone: "", open: "09:00", close: "18:00" };

export function ShopsPage(): ReactElement {
  const { can } = useAdmin();
  const shops = useResource<ShopDto[]>("/shops");
  const gaps = useResource<CoverageGapDto[]>("/coverage-gaps");
  const connectors = useResource<ConnectorStatusDto[]>("/connectors");
  const external = connectors.data?.find((c) => c.name === "shops")?.mode === "http";
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<ShopDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = can("operator", "manager") && connectors.data !== null && !external;

  const body = (active: boolean, hours?: ShopDto["hours"]) => ({
    name: form.name, region: form.region, city: form.city, address: form.address,
    phone: form.phone || null, hours: hours ?? { open: form.open, close: form.close, days: [1, 2, 3, 4, 5, 6] }, active
  });

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      if (editing) await api.put(`/shops/${editing.id}`, body(editing.active, editing.hours.days ? { open: form.open, close: form.close, days: editing.hours.days } : undefined));
      else await api.post("/shops", body(true));
      setForm(blank);
      setEditing(null);
      shops.reload();
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const toggle = async (s: ShopDto): Promise<void> => {
    try {
      await api.put(`/shops/${s.id}`, {
        name: s.name, region: s.region, city: s.city, address: s.address, phone: s.phone, hours: s.hours, active: !s.active
      });
      shops.reload();
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const edit = (s: ShopDto): void => {
    setEditing(s);
    setForm({ name: s.name, region: s.region, city: s.city, address: s.address, phone: s.phone ?? "", open: s.hours.open, close: s.hours.close });
  };

  return (
    <>
      <h1>店家與覆蓋缺口</h1>
      {error && <ErrorNote message={error} />}
      {external && (
        <p className="card" style={{ fontSize: 14 }}>
          店家清單由外部系統同步（唯讀）。新增或修改請到來源系統，或到「外部連接」立即同步。活動的配合據點仍在「活動」頁指派。
        </p>
      )}
      {canWrite && (
        <form className="card" onSubmit={(e) => void save(e)}>
          <h2>{editing ? `編輯：${editing.name}` : "新增店家"}</h2>
          <div className="grid2">
            <div className="field"><label>店名</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>地區</label>
              <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value as Region })}>
                {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </select></div>
            <div className="field"><label>城市</label><input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="field"><label>電話（未填則前台不顯示）</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>地址</label><input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid2">
              <div className="field"><label>開店</label><input type="time" value={form.open} onChange={(e) => setForm({ ...form, open: e.target.value })} /></div>
              <div className="field"><label>打烊</label><input type="time" value={form.close} onChange={(e) => setForm({ ...form, close: e.target.value })} /></div>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn">{editing ? "儲存" : "新增"}</button>
            {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(blank); }}>取消編輯</button>}
          </div>
        </form>
      )}
      <div className="card">
        <h2>店家（{shops.data?.length ?? 0}）</h2>
        {!shops.data ? <Spinner /> : (
          <table className="t"><thead><tr><th>店名</th><th>地區</th><th>地址</th><th>營業時間</th><th>狀態</th><th /></tr></thead>
            <tbody>{shops.data.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.regionLabel}</td><td>{s.address}</td><td>{s.hoursLabel}</td>
                <td><span className={`pill${s.active ? " ok" : ""}`}>{s.active ? "上架" : "停用"}</span></td>
                <td>{canWrite && <><button className="link" onClick={() => edit(s)}>編輯</button>{"\u3000"}<button className="link" onClick={() => void toggle(s)}>{s.active ? "停用" : "啟用"}</button></>}</td>
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
