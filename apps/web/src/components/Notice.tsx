import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** A soft tinted notice: icon, a bold first line, detail, and an optional action on the right. */
export function Notice({ kind = "info", title, children, action }: { kind?: "info" | "warn"; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role="status">
      <Icon name={kind === "warn" ? "warn" : "info"} className="notice-icon" />
      <div className="notice-text">
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}
