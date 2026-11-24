import { useId, useState } from "react";

/** Largest side of the stored logo, in pixels. Small enough to keep under the 150 KB limit. */
const MAX_SIDE = 256;

/** Shrinks an image to at most 256px a side and returns it as a PNG data URL. SVGs are kept as they are. */
async function toLogo(file: File): Promise<string> {
  const asDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(blob);
    });
  if (file.type === "image/svg+xml") return asDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** The team's logo: preview, upload and remove. */
export function LogoField({ logo, teamName, onChange }: { logo: string | null; teamName: string; onChange: (logo: string | null) => Promise<void> }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="setting-field">
      <span className="field-label" id={`${id}-label`}>
        Logo
      </span>
      <div className="logo-row">
        <span className="logo-preview" aria-hidden="true">
          {logo ? <img src={logo} alt="" /> : <span>{teamName.charAt(0).toUpperCase()}</span>}
        </span>
        <label className="button button-secondary button-small file-button">
          {busy ? "Uploading…" : logo ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            aria-labelledby={`${id}-label`}
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setError(null);
              setBusy(true);
              try {
                const data = await toLogo(file);
                if (data.length > 200_000) throw new Error("That image is too large. Try a simpler or smaller one.");
                await onChange(data);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't use that image.");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {logo && (
          <button type="button" className="button button-soft button-small" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
      <p className="setting-hint">A square image works best. PNG, JPG, WebP or SVG.</p>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
