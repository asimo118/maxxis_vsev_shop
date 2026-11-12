import type { ReactElement } from "react";

/** The signature tread-stripe divider. Style lives in tokens.css (.tread). */
export function TreadDivider(): ReactElement {
  return <div className="tread" aria-hidden="true" />;
}

export function Spinner({ label = "載入中…" }: { label?: string }): ReactElement {
  return (
    <p role="status" style={{ color: "var(--dim)", padding: "24px 0" }}>
      {label}
    </p>
  );
}

export function ErrorNote({ message }: { message: string }): ReactElement {
  return (
    <p role="alert" style={{ color: "var(--danger)", fontSize: 14, margin: "8px 0" }}>
      {message}
    </p>
  );
}
