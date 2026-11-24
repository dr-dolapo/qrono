import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { toast } from "sonner";
import { ApiError, api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { HelpTip } from "../../components/HelpTip";
import { allTimeZones, formatTime, zoneLongName } from "../../time";

interface TeamSettings {
  name: string;
  timezone: string;
}

/** Team-wide settings, for Approvers and Admins. */
export function SettingsPage() {
  const { currentTeam, refresh } = useAuth();
  const teamId = currentTeam!.id;
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(allTimeZones, []);

  useEffect(() => {
    setSettings(null);
    api<{ settings: TeamSettings }>(`/teams/${teamId}/settings`)
      .then((r) => {
        setSettings(r.settings);
        setTimezone(r.settings.timezone);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the settings."));
  }, [teamId]);

  if (currentTeam!.role === "member") return <Navigate to="/admin" replace />;

  async function saveZone() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ settings: TeamSettings }>(`/teams/${teamId}/settings`, { method: "PATCH", body: { timezone } });
      setSettings(r.settings);
      await refresh();
      toast.success(`Time zone set to ${zoneLongName(timezone)}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.timezone ?? err.message) : "Couldn't save the time zone.");
    } finally {
      setBusy(false);
    }
  }

  const now = new Date().toISOString();

  return (
    <AppShell>
      <h1>
        <span className="title-pre">Settings:</span> {currentTeam!.name}
      </h1>
      <Alert>{error}</Alert>
      {!settings && !error && <p className="muted">Loading…</p>}

      {settings && (
        <section className="settings-section" aria-labelledby="zone-heading">
          <div className="section-head">
            <h2 id="zone-heading">Time zone</h2>
            <HelpTip label="Time zone">
              Everyone sees an event's times in its time zone, whatever their own device is set to, so a program reads the same for the whole team.
            </HelpTip>
          </div>
          <p>New events are planned in this time zone. Events already planned keep the time zone they were made in.</p>
          <div className="setting-row">
            <label className="visually-hidden" htmlFor="team-zone">
              Time zone
            </label>
            <select id="team-zone" className="select setting-select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button type="button" className="button button-primary button-auto" disabled={busy || timezone === settings.timezone} onClick={saveZone}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          <p className="setting-hint">
            {zoneLongName(timezone)} · it's {formatTime(now, timezone)} there now
          </p>
        </section>
      )}
    </AppShell>
  );
}
