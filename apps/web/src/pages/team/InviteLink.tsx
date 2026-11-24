import { useState } from "react";
import { ApiError, api, type PendingInvite } from "../../api";
import { Alert } from "../../components/Form";
import { toast } from "sonner";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";

/**
 * QR001: the team's shareable invite link. People who use it join as Members
 * after an Admin or Planner lets them in. The link is shown once, when it's
 * created (only a hash is stored); making a new one turns off the old one.
 */
export function InviteLink({
  teamId,
  enabled,
  needsLettingIn,
  activeLink,
  onTurnOff,
  onChanged,
}: {
  teamId: string;
  /** Teams can turn the invite link off in Settings. */
  enabled: boolean;
  needsLettingIn: boolean;
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

  if (!enabled) {
    return (
      <section className="panel" aria-labelledby="link-heading">
        <h2 id="link-heading">Invite link</h2>
        <p className="panel-sub">
          Turned off for this team. Invite people by email, or{" "}
          <Link className="text-link" to="/admin/settings/invites">
            turn it on in Settings
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="link-heading">
      <h2 id="link-heading">Invite link</h2>
      <p className="panel-sub">
        Share one link with a group, e.g. in WhatsApp. People who use it join as Members{needsLettingIn ? " once you let them in" : " straight away"}.
      </p>
      <Alert>{error}</Alert>

      {url ? (
        <>
          <input className="code-box" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <div className="panel-row">
            <span className="small muted">Lasts 30 days</span>
            <button type="button" className="button button-secondary button-small" onClick={copy}>
              <Icon name="copy" size={14} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : activeLink ? (
        <p className="panel-note">
          A link is active until {new Date(activeLink.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. For security it's only
          shown when it's created; make a new one to see it again.
        </p>
      ) : null}

      <div className="rail-actions rail-actions-row">
        <button type="button" className="button button-secondary button-small" onClick={create} disabled={busy}>
          {busy ? "Creating…" : activeLink || url ? "Make a new link" : "Create invite link"}
        </button>
        {activeLink && (
          <button
            type="button"
            className="button button-soft button-small"
            onClick={() => {
              setUrl(null);
              onTurnOff(activeLink.id);
            }}
          >
            Turn off
          </button>
        )}
      </div>
      {(activeLink || url) && <p className="small muted panel-foot">A new link turns off the current one.</p>}
    </section>
  );
}
