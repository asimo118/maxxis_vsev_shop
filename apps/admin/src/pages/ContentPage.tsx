import type { AdminCampaignDetailDto, AdminCampaignRowDto, CampaignUpsertBody } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { RowsEditor } from "../components/RowsEditor";
import { useResource } from "../hooks";

type Spec = { label: string; value: string };
type Point = { title: string; body: string };
type Faq = { q: string; a: string };

interface Draft {
  productName: string;
  sizeLabel: string;
  includes: string;
  specs: Spec[];
  evPoints: Point[];
  faq: Faq[];
}

const toDraft = (c: AdminCampaignDetailDto): Draft => ({
  productName: c.productName,
  sizeLabel: c.sizeLabel,
  includes: c.includes.join("\n"),
  specs: c.content.specs,
  evPoints: c.content.evPoints,
  faq: c.content.faq
});

/** Drop rows the editor left completely empty; report rows that are only half filled. */
function clean<T extends Record<string, string>>(rows: T[], what: string, problems: string[]): T[] {
  const trimmed = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.trim()])) as T);
  const kept = trimmed.filter((r) => Object.values(r).some((v) => v !== ""));
  kept.forEach((r, i) => {
    if (Object.values(r).some((v) => v === "")) problems.push(`${what}第 ${i + 1} 列有欄位空白`);
  });
  return kept;
}

/**
 * Product spec editor: product name, size, what's included, the spec table, EV feature points and FAQ.
 * Saves the whole campaign (PUT /campaigns/:id); the storefront cache is refreshed by the API on save.
 */
export function ContentPage(): ReactElement {
  const { can } = useAdmin();
  const editable = can("operator", "manager");
  const list = useResource<AdminCampaignRowDto[]>("/campaigns");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<AdminCampaignDetailDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Default to the live campaign (else the newest).
  useEffect(() => {
    if (!campaignId && list.data && list.data.length > 0) {
      setCampaignId((list.data.find((c) => c.status === "live") ?? list.data[0])?.id ?? null);
    }
  }, [list.data, campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    setCampaign(null);
    api.get<AdminCampaignDetailDto>(`/campaigns/${campaignId}`)
      .then((c) => {
        setCampaign(c);
        setDraft(toDraft(c));
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [campaignId]);

  const dirty = useMemo(
    () => campaign !== null && draft !== null && JSON.stringify(toDraft(campaign)) !== JSON.stringify(draft),
    [campaign, draft]
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (list.error) return <ErrorNote message={list.error} />;
  if (!campaign || !draft) return <Spinner />;

  const update = (patch: Partial<Draft>): void => {
    setSaved(null);
    setDraft({ ...draft, ...patch });
  };

  const save = async (): Promise<void> => {
    const problems: string[] = [];
    const specs = clean(draft.specs, "規格表", problems);
    const evPoints = clean(draft.evPoints, "EV 特點", problems);
    const faq = clean(draft.faq, "常見問題", problems);
    const includes = draft.includes.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!draft.productName.trim()) problems.push("產品名稱不可空白");
    if (!draft.sizeLabel.trim()) problems.push("尺寸不可空白");
    if (specs.length === 0) problems.push("規格表至少要有一列");
    if (problems.length > 0) return setError(problems.join("；"));

    const { id: _id, status: _status, shopIds: _shops, ...rest } = campaign;
    const body: CampaignUpsertBody = {
      ...rest,
      productName: draft.productName.trim(),
      sizeLabel: draft.sizeLabel.trim(),
      includes,
      content: { ...campaign.content, specs, evPoints, faq }
    };
    setBusy(true);
    setError(null);
    try {
      const next = await api.put<AdminCampaignDetailDto>(`/campaigns/${campaign.id}`, body);
      setCampaign(next);
      setDraft(toDraft(next));
      setSaved(`已儲存（${fmtDateTime(new Date().toISOString())}）・前台「產品規格」與「常見問題」頁已更新`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>產品規格</h1>
      <div className="toolbar">
        <select aria-label="選擇活動" value={campaign.id} onChange={(e) => !dirty || window.confirm("有尚未儲存的變更，確定切換？") ? setCampaignId(e.target.value) : undefined}>
          {(list.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}（{c.status}）</option>)}
        </select>
        {!editable && <span className="pill">唯讀（finance 權限）</span>}
      </div>

      <div className="card">
        <h2>產品</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="pn">產品名稱</label><input id="pn" disabled={!editable} value={draft.productName} onChange={(e) => update({ productName: e.target.value })} /></div>
          <div className="field"><label htmlFor="sz">尺寸／規格標示</label><input id="sz" disabled={!editable} value={draft.sizeLabel} onChange={(e) => update({ sizeLabel: e.target.value })} /></div>
        </div>
        <div className="field">
          <label htmlFor="inc">方案內含（一行一項）</label>
          <textarea id="inc" rows={4} disabled={!editable} value={draft.includes} onChange={(e) => update({ includes: e.target.value })} />
        </div>
      </div>

      <div className="card">
        <h2>規格表</h2>
        <RowsEditor<Spec> rows={draft.specs} blank={{ label: "", value: "" }} addLabel="新增規格" disabled={!editable}
          fields={[{ key: "label", label: "項目", placeholder: "例如：負載指數" }, { key: "value", label: "內容", placeholder: "例如：99（775 kg）" }]}
          onChange={(specs) => update({ specs })} />
      </div>

      <div className="card">
        <h2>EV 特點</h2>
        <RowsEditor<Point> rows={draft.evPoints} blank={{ title: "", body: "" }} addLabel="新增特點" disabled={!editable}
          fields={[{ key: "title", label: "標題" }, { key: "body", label: "說明", multiline: true }]}
          onChange={(evPoints) => update({ evPoints })} />
      </div>

      <div className="card">
        <h2>常見問題</h2>
        <RowsEditor<Faq> rows={draft.faq} blank={{ q: "", a: "" }} addLabel="新增問題" disabled={!editable}
          fields={[{ key: "q", label: "問題" }, { key: "a", label: "回答", multiline: true }]}
          onChange={(faq) => update({ faq })} />
      </div>

      {editable && (
        <div className="save-bar">
          {error && <ErrorNote message={error} />}
          {saved && !dirty && <span className="saved">{saved}</span>}
          {dirty && <span className="dirty">尚未儲存的變更</span>}
          <button className="btn ghost" disabled={!dirty || busy} onClick={() => { setDraft(toDraft(campaign)); setError(null); }}>還原</button>
          <button className="btn" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "儲存中…" : "儲存並發布"}</button>
        </div>
      )}
    </>
  );
}
