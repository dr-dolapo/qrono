import type { ReactNode } from "react";

/** A summary card: title, caption, "value / total" and a bar coloured by how full it is. */
export function StatCard({
  title,
  caption,
  value,
  total,
  ratio,
  tone,
  help,
}: {
  title: string;
  caption: string;
  value: ReactNode;
  total?: ReactNode;
  /** 0–1 (or above 1 when over). Leave out for a card with no bar. */
  ratio?: number;
  /** Override the automatic colour: green under 60%, amber up to 99%, red at or over 100%. */
  tone?: "good" | "warn" | "bad" | "neutral";
  help?: ReactNode;
}) {
  const auto = ratio === undefined ? "neutral" : ratio >= 1 ? "bad" : ratio >= 0.6 ? "warn" : "good";
  const colour = tone ?? auto;
  return (
    <div className="stat-card">
      <div className="stat-title">
        <h3>{title}</h3>
        {help}
      </div>
      <p className="stat-caption">{caption}</p>
      <p className="stat-value">
        {value}
        {total !== undefined && <span> / {total}</span>}
      </p>
      {ratio !== undefined && (
        <div className="stat-bar" aria-hidden="true">
          <i className={`tone-${colour}`} style={{ width: `${Math.max(3, Math.min(100, ratio * 100))}%` }} />
        </div>
      )}
    </div>
  );
}
