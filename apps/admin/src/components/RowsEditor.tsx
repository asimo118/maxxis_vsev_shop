import type { ReactElement } from "react";

export interface RowField<T> {
  key: keyof T & string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}

/** Editable list of small records (spec rows, EV points, FAQ): edit in place, reorder, add, remove. */
export function RowsEditor<T extends Record<string, string>>(props: {
  rows: T[];
  fields: RowField<T>[];
  blank: T;
  addLabel: string;
  disabled?: boolean;
  onChange: (rows: T[]) => void;
}): ReactElement {
  const { rows, onChange, disabled } = props;
  const set = (i: number, key: keyof T, value: string): void =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const move = (i: number, d: -1 | 1): void => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    if (row) next.splice(i + d, 0, row);
    onChange(next);
  };

  return (
    <div className="rows-editor">
      {rows.map((row, i) => (
        <div className="rows-row" key={i}>
          <span className="rows-idx">{i + 1}</span>
          <div className="rows-fields">
            {props.fields.map((f) =>
              f.multiline ? (
                <textarea key={f.key} aria-label={`${f.label} ${i + 1}`} placeholder={f.placeholder ?? f.label} rows={2}
                  disabled={disabled} value={row[f.key]} onChange={(e) => set(i, f.key, e.target.value)} />
              ) : (
                <input key={f.key} aria-label={`${f.label} ${i + 1}`} placeholder={f.placeholder ?? f.label}
                  disabled={disabled} value={row[f.key]} onChange={(e) => set(i, f.key, e.target.value)} />
              )
            )}
          </div>
          <div className="rows-tools">
            <button type="button" title="上移" aria-label="上移" disabled={disabled || i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" title="下移" aria-label="下移" disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" title="刪除" aria-label="刪除" disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      {!disabled && (
        <button type="button" className="btn ghost" onClick={() => onChange([...rows, { ...props.blank }])}>＋ {props.addLabel}</button>
      )}
    </div>
  );
}
