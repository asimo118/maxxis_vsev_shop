import { NOTIFICATION_KIND_LABELS, type NotificationLogDto, type NotificationTemplateDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

function TemplateEditor({ t, canEdit, onSaved }: { t: NotificationTemplateDto; canEdit: boolean; onSaved: () => void }): ReactElement {
  const [draft, setDraft] = useState(t);
  const [err, setErr] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setErr(null);
    try {
      await api.put(`/notifications/templates/${t.kind}`, { title: draft.title, body: draft.body, enabled: draft.enabled });
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <div className="card">
      <h2>{NOTIFICATION_KIND_LABELS[t.kind]} <small style={{ color: "var(--dim)" }}>{t.kind}</small></h2>
      <div className="field"><label>標題</label><input disabled={!canEdit} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
      <div className="field"><label>內容（可用 {"{{name}} {{number}} {{shopName}} {{installDeadline}} {{slotAt}} {{daysLeft}}"}）</label>
        <textarea rows={3} disabled={!canEdit} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
      <label style={{ fontSize: 14 }}><input type="checkbox" disabled={!canEdit} checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> 啟用</label>
      {err && <ErrorNote message={err} />}
      {canEdit && <div className="btn-row"><button className="btn" onClick={() => void save()}>儲存</button></div>}
    </div>
  );
}

export function NotificationsPage(): ReactElement {
  const { can } = useAdmin();
  const tpl = useResource<NotificationTemplateDto[]>("/notifications/templates");
  const log = useResource<NotificationLogDto[]>("/notifications/log");
  return (
    <>
      <h1>通知</h1>
      <p style={{ color: "var(--dim)", fontSize: 13.5, marginBottom: 14 }}>目前發送管道為 console 示範轉接器（寫入日誌，不會真的發 LINE / Email）。</p>
      {!tpl.data ? <Spinner /> : tpl.data.map((t) => <TemplateEditor key={t.kind + t.title + t.body} t={t} canEdit={can("manager")} onSaved={tpl.reload} />)}
      <div className="card">
        <h2>發送紀錄</h2>
        <table className="t"><tbody>
          {(log.data ?? []).map((l) => <tr key={l.id}><td>{fmtDateTime(l.createdAt)}</td><td>{NOTIFICATION_KIND_LABELS[l.kind]}</td><td>{l.title}</td><td><span className={`pill${l.status === "sent" ? " ok" : ""}`}>{l.status}</span></td></tr>)}
        </tbody></table>
      </div>
    </>
  );
}
