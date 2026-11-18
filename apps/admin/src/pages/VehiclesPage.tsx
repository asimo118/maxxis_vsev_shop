import type { AdminCampaignDetailDto, AdminCampaignRowDto, AdminVehicleModelDto, ConnectorStatusDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { api, errorText } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

interface Form {
  id: string;
  label: string;
  active: boolean;
  /** New models only: also add it to the live campaign's eligible models. */
  joinCampaign: boolean;
}

const blank: Form = { id: "", label: "", active: true, joinCampaign: true };
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "BMW iX2 xDrive30" → "m-bmw-ix2-xdrive30"; a suggestion the admin can still edit before saving. */
export const suggestId = (label: string): string => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `m-${slug}`.slice(0, 40).replace(/-+$/, "") : "";
};

export function VehiclesPage(): ReactElement {
  const { can } = useAdmin();
  const models = useResource<AdminVehicleModelDto[]>("/vehicle-models");
  const connectors = useResource<ConnectorStatusDto[]>("/connectors");
  const campaigns = useResource<AdminCampaignRowDto[]>("/campaigns");
  const live = campaigns.data?.find((c) => c.status === "live") ?? null;
  const [eligible, setEligible] = useState<string[]>([]);
  const external = connectors.data?.find((c) => c.name === "vehicles")?.mode === "http";
  const canEdit = can("operator", "manager");
  const canWrite = canEdit && connectors.data !== null && !external;

  const [form, setForm] = useState<Form>(blank);
  const [idTouched, setIdTouched] = useState(false);
  const [editing, setEditing] = useState<AdminVehicleModelDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const loadEligible = (id: string): void => {
    api.get<AdminCampaignDetailDto>(`/campaigns/${id}`).then((c) => setEligible(c.eligibleModelIds)).catch(() => undefined);
  };
  useEffect(() => {
    if (live) loadEligible(live.id);
  }, [live?.id]); // re-run only when the live campaign changes

  const all = models.data ?? [];
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((m) => !needle || `${m.label} ${m.id}`.toLowerCase().includes(needle));
  }, [all, q]);
  const byId = new Map(all.map((m) => [m.id, m]));
  const sellable = eligible.filter((id) => byId.get(id)?.active);
  const hiddenEligible = eligible.filter((id) => byId.has(id) && !byId.get(id)?.active);

  const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((f) => ({ ...f, [key]: value }));
  const setLabel = (label: string): void =>
    setForm((f) => ({ ...f, label, id: editing || idTouched ? f.id : suggestId(label) }));

  const close = (): void => {
    setFormOpen(false);
    setEditing(null);
    setIdTouched(false);
  };
  const startNew = (): void => {
    setEditing(null);
    setForm(blank);
    setIdTouched(false);
    setFormOpen(true);
    setNotice(null);
    setError(null);
  };
  const startEdit = (m: AdminVehicleModelDto): void => {
    setEditing(m);
    setForm({ id: m.id, label: m.label, active: m.active, joinCampaign: false });
    setFormOpen(true);
    setNotice(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveEligible = async (ids: string[]): Promise<void> => {
    if (!live) return;
    const updated = await api.put<AdminCampaignDetailDto>(`/campaigns/${live.id}/eligible-models`, { modelIds: ids });
    setEligible(updated.eligibleModelIds);
  };

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!editing && !ID_PATTERN.test(form.id)) return setError("代碼只能用小寫英文、數字與連字號，例如 m-ix2-xdrive30。");
    try {
      if (editing) {
        await api.put(`/vehicle-models/${editing.id}`, { label: form.label.trim(), active: form.active });
        setNotice(`已更新「${form.label.trim()}」`);
      } else {
        const created = await api.post<AdminVehicleModelDto>("/vehicle-models", { id: form.id, label: form.label.trim(), active: form.active });
        const join = form.joinCampaign && live !== null;
        if (join) await saveEligible([...eligible, created.id]);
        setNotice(`已新增「${created.label}」${join ? `，並加入活動「${live.title}」的適用車型` : ""}`);
      }
      close();
      models.reload();
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const toggleActive = async (m: AdminVehicleModelDto): Promise<void> => {
    setError(null);
    try {
      await api.put(`/vehicle-models/${m.id}`, { label: m.label, active: !m.active });
      models.reload();
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  const toggleEligible = async (m: AdminVehicleModelDto): Promise<void> => {
    setError(null);
    const next = eligible.includes(m.id) ? eligible.filter((id) => id !== m.id) : [...eligible, m.id];
    try {
      await saveEligible(next);
    } catch (ex) {
      setError(errorText(ex));
    }
  };

  return (
    <>
      <h1>車型資料</h1>
      {(error ?? models.error) && <ErrorNote message={error ?? models.error ?? ""} />}
      {notice && <p className="notice">{notice}</p>}
      {external && (
        <p className="card" style={{ fontSize: 14 }}>
          車型清單由外部系統同步（唯讀）。新增或修改請到來源系統，或到「外部連接」立即同步。活動的適用車型仍可在下方勾選。
        </p>
      )}
      {live && models.data && sellable.length === 0 && (
        <p className="warn-box">活動「{live.title}」目前沒有任何上架中的適用車型，前台的車型選單是空的，客人無法下單。</p>
      )}
      {live && hiddenEligible.length > 0 && (
        <p className="warn-box">
          {hiddenEligible.map((id) => `「${byId.get(id)?.label ?? id}」`).join("")}在活動適用車型內但已停用，前台不會顯示，也不能下單。
        </p>
      )}

      {canWrite && !formOpen && (
        <div className="btn-row"><button className="btn" onClick={startNew}>＋ 新增車型</button></div>
      )}

      {canWrite && formOpen && (
        <form className="card" onSubmit={(e) => void save(e)}>
          <h2>{editing ? `編輯：${editing.label}` : "新增車型"}</h2>
          <div className="grid2">
            <div className="field">
              <label htmlFor="v-label">顯示名稱（前台車型選單看到的文字）</label>
              <input id="v-label" required maxLength={60} placeholder="BMW iX2 xDrive30" value={form.label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="v-id">車型代碼{editing ? "（不可修改）" : ""}</label>
              <input
                id="v-id" required maxLength={40} placeholder="m-ix2-xdrive30" disabled={editing !== null} value={form.id}
                onChange={(e) => { setIdTouched(true); set("id", e.target.value.trim().toLowerCase()); }}
              />
              {!editing && <p className="hint">系統內部識別用，訂單和車主資料會記錄這個代碼，建立後不能修改。會依名稱自動產生，也可以自己改。</p>}
            </div>
          </div>
          <label className="check-line">
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> 上架（停用的車型不會出現在前台，也不能下單；既有訂單不受影響）
          </label>
          {!editing && live && (
            <label className="check-line">
              <input type="checkbox" checked={form.joinCampaign} onChange={(e) => set("joinCampaign", e.target.checked)} /> 同時加入活動「{live.title}」的適用車型，前台立即可選
            </label>
          )}
          <div className="btn-row">
            <button className="btn">{editing ? "儲存" : "新增"}</button>
            <button type="button" className="btn ghost" onClick={() => { close(); setError(null); }}>取消</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="card-head">
          <h2>車型（{all.length}）</h2>
          <input type="search" placeholder="搜尋名稱或代碼" aria-label="搜尋車型" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!models.data ? <Spinner /> : (
          <table className="t">
            <thead><tr><th>顯示名稱</th><th>代碼</th><th>車主登記</th><th>狀態</th>{live && <th>活動適用車型</th>}<th /></tr></thead>
            <tbody>{visible.map((m) => {
              const inCampaign = eligible.includes(m.id);
              const last = inCampaign && eligible.length === 1;
              return (
                <tr key={m.id}>
                  <td>{m.label}</td>
                  <td><code>{m.id}</code></td>
                  <td>{m.ownerVehicles} 台</td>
                  <td><span className={`pill${m.active ? " ok" : ""}`}>{m.active ? "上架" : "停用"}</span></td>
                  {live && (
                    <td>
                      <label className="check-line" title={last ? "活動至少要有一個適用車型" : `活動「${live.title}」`}>
                        <input type="checkbox" disabled={!canEdit || last} checked={inCampaign} onChange={() => void toggleEligible(m)} />
                        {inCampaign ? "適用" : "不適用"}
                      </label>
                    </td>
                  )}
                  <td className="nowrap">
                    {canWrite && <><button className="link" onClick={() => startEdit(m)}>編輯</button>{"　"}<button className="link" onClick={() => void toggleActive(m)}>{m.active ? "停用" : "啟用"}</button></>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          車型不能刪除（訂單與車主資料會用到），不再販售請改為「停用」。前台車型選單的順序依勾選「適用」的先後。
        </p>
      </div>
    </>
  );
}
