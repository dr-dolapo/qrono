import clsx from "clsx";

const COLOURS = ["#2bb5a0", "#4a9be8", "#e89a20", "#a44be9", "#e8607a", "#5c6ac4"];

/** The same person always gets the same colour, picked from their name. */
function colourFor(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length]!;
}

/** Coloured initial for a person. Decorative: their name is always shown beside it. */
export function Avatar({ name, size = 30, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={clsx("avatar", className)}
      aria-hidden="true"
      style={{ background: colourFor(name), width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Up to three overlapping avatars. */
export function AvatarStack({ names }: { names: string[] }) {
  return (
    <span className="avatar-stack" aria-hidden="true">
      {names.slice(0, 3).map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size={22} />
      ))}
    </span>
  );
}
