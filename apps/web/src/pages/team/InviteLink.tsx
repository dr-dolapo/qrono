import { useState } from "react";
import { ApiError, api, type PendingInvite } from "../../api";
import { Alert } from "../../components/Form";
import { toast } from "sonner";

/**
 * QR001: the team's shareable invite link. People who use it join as Members
 * after an Approver or Admin lets them in. The link is shown once, when it's
 * created (only a hash is stored); making a new one turns off the old one.
 */
export function InviteLink({
  teamId,
  activeLink,
  onTurnOff,
  onChanged,
}: {
  teamId: string;
  activeLink: PendingInvite | null;
  onTurnOff: (inviteId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await api<{ url: string }>(`/teams/${teamId}/invite-link`, { method: "POST", body: {} });
      setUrl(res.url);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      setError("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  return (
    <section className="section" aria-labelledby="link-heading">
      <h2 id="link-heading">Invite link</h2>
      <p className="muted small">
        Share one link with a group, e.g. in WhatsApp. Anyone who uses it joins as a Member once you approve them. Links last 30 days.
      </p>
      <Alert>{error}</Alert>

      {url ? (
        <div className="link-box">
          <input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button button-small button-primary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : activeLink ? (
        <p className="small">
          A link is active until {new Date(activeLink.expiresAt).toLocaleDateString()}. For security it's only shown when
          it's created; make a new one to see it again.
        </p>
      ) : null}

      <div className="button-row">
        <button type="button" className="button button-small" onClick={create} disabled={busy}>
          {busy ? "Creating…" : activeLink || url ? "Create a new link" : "Create invite link"}
        </button>
        {activeLink && (
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              setUrl(null);
              onTurnOff(activeLink.id);
            }}
          >
            Turn off link
          </button>
        )}
      </div>
      {(activeLink || url) && <p className="muted small">Creating a new link turns off the current one.</p>}
    </section>
  );
}
