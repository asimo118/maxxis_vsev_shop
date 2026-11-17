import type { OwnerRowDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import { useState, type FormEvent, type ReactElement } from "react";
import { api, errorText } from "../api";
import { useAdmin } from "../auth";
import { useResource } from "../hooks";

export function OwnersPage(): ReactElement {
  const { can } = useAdmin();
  const { data, error, reload } = useResource<OwnerRowDto[]>("/owners");
  const [userId, setUserId] = useState("");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const adjust = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/points/adjust", { userId, delta: Number(delta), note });
      setDelta("");
      setNote("");
      reload();
    } catch (ex) {
      setErr(errorText(ex));
    }
  };

  return (
    <>
      <h1>車主與點數</h1>
      {error && <ErrorNote message={error} />}
      {can("manager") && (
        <form className="card" onSubmit={(e) => void adjust(e)}>
          <h2>手動調整點數（寫入稽核）</h2>
          <div className="grid2">
            <div className="field"><label>會員（從下表點選）</label><input required value={userId} readOnly /></div>
            <div className="field"><label>增減點數（可為負）</label><input required type="number" value={delta} onChange={(e) => setDelta(e.target.value)} /></div>
          </div>
          <div className="field"><label>原因（至少 3 字）</label><input required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {err && <ErrorNote message={err} />}
          <button className="btn" disabled={!userId}>送出</button>
        </form>
      )}
      <div className="card">
        {!data ? <Spinner /> : (
          <table className="t"><thead><tr><th>車主</th><th>訂單</th><th>點數</th><th>最近里程</th></tr></thead>
            <tbody>{data.map((o) => (
              <tr key={o.userId} className="click" onClick={() => setUserId(o.userId)}>
                <td>{o.name}<br /><small>{o.email}</small></td><td>{o.orders}</td><td>{o.pointsBalance}</td><td>{o.latestKm ?? "—"}</td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
