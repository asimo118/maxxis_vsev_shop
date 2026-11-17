import type { ConnectorStatusDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type ReactElement } from "react";
import { api, errorText, fmtDateTime } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

const MODE_LABEL = { local: "本系統管理", http: "外部系統" } as const;

export function ConnectorsPage(): ReactElement {
  const { can } = useAdmin();
  const { data, error, reload } = useResource<ConnectorStatusDto[]>("/connectors");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sync = async (name: string): Promise<void> => {
    setBusy(name);
    setErr(null);
    try {
      await api.post(`/connectors/${name}/sync`);
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h1>外部連接</h1>
      <p style={{ color: "var(--dim)", fontSize: 13.5, marginBottom: 14 }}>
        車型與店家清單可改由外部系統提供（定時同步到本系統，外部暫時斷線時仍以最後一次成功的資料運作）；
        購物車／結帳可交給外部系統處理。設定方式見 docs/connectors.md。
      </p>
      {(error || err) && <ErrorNote message={error ?? err ?? ""} />}
      {!data ? <Spinner /> : (
        <div className="card">
          <table className="t">
            <thead><tr><th>連接器</th><th>資料來源</th><th>端點</th><th>最近一次</th><th>結果</th><th /></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.name}>
                  <td>{c.label}<br /><small>{c.name}</small></td>
                  <td><span className={`pill${c.mode === "http" ? " hot" : ""}`}>{MODE_LABEL[c.mode]}</span></td>
                  <td>{c.endpointHost ?? "—"}</td>
                  <td>{c.lastRunAt ? fmtDateTime(c.lastRunAt) : "—"}</td>
                  <td>
                    {c.lastResult === "ok" && <span className="pill ok">成功{c.lastCounts ? `・${c.lastCounts.upserted} 筆，停用 ${c.lastCounts.deactivated}` : ""}</span>}
                    {c.lastResult === "error" && <><span className="pill" style={{ color: "var(--danger)" }}>失敗</span><br /><small>{c.lastMessage}</small></>}
                    {c.lastResult === null && "—"}
                  </td>
                  <td>
                    {c.syncable && can("operator", "manager") && (
                      <button className="btn ghost" disabled={busy !== null} onClick={() => void sync(c.name)}>
                        {busy === c.name ? "同步中…" : "立即同步"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
