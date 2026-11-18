import { ErrorNote } from "@vsev/ui";
import { useState, type FormEvent, type ReactElement } from "react";
import { api } from "../api";
import { errorText } from "../format";

export function CoverageBox({ note }: { note: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/coverage-requests", { city, ...(email ? { email } : {}) });
      setDone(true);
    } catch (ex) {
      setErr(errorText(ex));
    }
  };

  return (
    <div className="coverage">
      <b>你所在的區域沒有據點？</b> {note}{" "}
      {!open && <button className="link" onClick={() => setOpen(true)}>告訴我們你在哪裡</button>}
      {open && !done && (
        <form onSubmit={(e) => void submit(e)}>
          <input required placeholder="縣市，例如：台北市" value={city} onChange={(e) => setCity(e.target.value)} />
          <input type="email" placeholder="Email（選填，有據點時通知你）" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" type="submit">送出</button>
          {err && <ErrorNote message={err} />}
        </form>
      )}
      {done && <p className="ok-note">已收到，謝謝你！</p>}
    </div>
  );
}
