import { Switch } from "@base-ui/react/switch";
import clsx from "clsx";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ApiError, api, type Member, type SettingsResponse, type TeamSettings } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { HelpTip } from "../../components/HelpTip";
import { allTimeZones, formatTime, zoneLongName } from "../../time";
import { AgendaLibrary } from "./AgendaLibrary";
import { DangerZone } from "./DangerZone";
import { LogoField } from "./LogoField";

const REMINDER_CHOICES = [
  { value: 10080, label: "1 week before" },
  { value: 1440, label: "1 day before" },
  { value: 180, label: "3 hours before" },
  { value: 60, label: "1 hour before" },
];
const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

const SECTIONS = [
  { id: "you", label: "Your settings" },
  { id: "profile", label: "Team profile" },
  { id: "time", label: "Time and region" },
  { id: "defaults", label: "Program defaults" },
  { id: "approval", label: "Approval" },
  { id: "reminders", label: "Reminders" },
  { id: "invites", label: "Invites" },
  { id: "live", label: "Live screen" },
  { id: "library", label: "Agenda library" },
  { id: "danger", label: "Danger zone" },
];

/** A labelled on/off switch with a line of explanation. */
function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={clsx("toggle-row", disabled && "is-disabled")}>
      <Switch.Root id={id} className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
      <label htmlFor={id} className="toggle-text">
        <span>{label}</span>
        {hint && (
          <small id={`${id}-hint`} className="toggle-hint">
            {hint}
          </small>
        )}
      </label>
    </div>
  );
}

/** A small set of choices shown side by side (radio buttons). */
function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="choice">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={String(o.value)} className={clsx("segment", o.value === value && "is-on")}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A text setting with its own Save button. */
function TextSetting({ label, value, placeholder, maxLength, onSave }: { label: string; value: string; placeholder?: string; maxLength: number; onSave: (v: string) => Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value;
  return (
    <form
      className="setting-field"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void onSave(draft.trim());
      }}
    >
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="setting-row">
        <input id={id} className="input-filled" value={draft} placeholder={placeholder} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="button button-secondary button-auto" disabled={!dirty}>
          Save
        </button>
      </div>
    </form>
  );
}

function Section({ id, title, help, children }: { id: string; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section" id={id} aria-labelledby={`${id}-heading`}>
      <div className="section-head">
        <h2 id={`${id}-heading`}>{title}</h2>
        {help && <HelpTip label={title}>{help}</HelpTip>}
      </div>
      {children}
    </section>
  );
}

/**
 * Settings. Everyone sees their own (reminder emails); Approvers and Admins also
 * change the team's. Each change saves straight away.
 */
export function SettingsPage() {
  const { currentTeam, refresh, user } = useAuth();
  const navigate = useNavigate();
  const teamId = currentTeam!.id;
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [approvers, setApprovers] = useState<Member[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(allTimeZones, []);

  const load = useCallback(async () => {
    try {
      const res = await api<SettingsResponse>(`/teams/${teamId}/settings`);
      setData(res);
      if (res.canEdit) {
        const m = await api<{ members: Member[] }>(`/teams/${teamId}/members`);
        const active = m.members.filter((x) => x.status === "active");
        setMembers(active);
        setApprovers(active.filter((x) => x.role === "approver"));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the settings.");
    }
  }, [teamId]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  /** Save one or more team settings, then show what's stored. */
  async function save(patch: Partial<TeamSettings>, message = "Saved") {
    setError(null);
    try {
      const res = await api<{ settings: TeamSettings }>(`/teams/${teamId}/settings`, { method: "PATCH", body: patch });
      setData((d) => (d ? { ...d, settings: res.settings, remindersEnabled: res.settings.remindersEnabled } : d));
      // The name, time zone, clock and week start are part of the signed-in team.
      if ("name" in patch || "timezone" in patch || "clockFormat" in patch || "weekStart" in patch) await refresh();
      toast.success(message);
    } catch (err) {
      const msg = err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Couldn't save that setting.";
      setError(msg);
      toast.error(msg);
    }
  }

  async function saveMine(reminderEmails: boolean) {
    try {
      await api(`/teams/${teamId}/settings/me`, { method: "PATCH", body: { reminderEmails } });
      setData((d) => (d ? { ...d, me: { reminderEmails } } : d));
      toast.success(reminderEmails ? "Reminder emails on" : "Reminder emails off");
    } catch {
      toast.error("Couldn't save that setting.");
    }
  }

  // Links like /admin/settings#invites: scroll there once the page has loaded.
  const loaded = data !== null;
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [loaded]);

  const s = data?.settings;
  const visible = SECTIONS.filter((x) => x.id === "you" || (data?.canEdit && (x.id !== "danger" || data.canDeleteTeam)));
  const rail = data && visible.length > 1 && (
    <nav className="panel settings-toc" aria-label="Settings sections">
      <h2>On this page</h2>
      <ul>
        {visible.map((x) => (
          <li key={x.id}>
            <a href={`#${x.id}`}>{x.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <AppShell rail={rail || undefined}>
      <h1>
        <span className="title-pre">Settings:</span> {currentTeam!.name}
      </h1>
      <Alert>{error}</Alert>
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <Section id="you" title="Your settings" help="These are just for you, on this team. Nobody else sees or changes them.">
          <Toggle
            label="Email me reminders before events I'm on"
            hint={data.remindersEnabled ? "Sent at the times your team has chosen." : "Your team has turned reminders off, so none are sent at the moment."}
            checked={data.me.reminderEmails}
            onChange={saveMine}
          />
        </Section>
      )}

      {s && (
        <>
          <Section id="profile" title="Team profile" help="Shown on emails about your programs and on the page guests open from their email.">
            <TextSetting label="Team name" value={s.name} maxLength={80} onSave={(name) => save({ name }, "Team name saved")} />
            <LogoField logo={s.logo} teamName={s.name} onChange={(logo) => save({ logo }, logo ? "Logo saved" : "Logo removed")} />
            <TextSetting
              label="Usual venue"
              value={s.defaultVenue ?? ""}
              placeholder="e.g. Main auditorium, 12 Allen Avenue, Ikeja"
              maxLength={120}
              onSave={(v) => save({ defaultVenue: v || null }, "Venue saved")}
            />
          </Section>

          <Section id="time" title="Time and region" help="Everyone sees an event's times in its time zone, whatever their own device is set to.">
            <div className="setting-field">
              <label htmlFor="team-zone" className="field-label">
                Time zone
              </label>
              <div className="setting-row">
                <select id="team-zone" className="select setting-select" value={s.timezone} onChange={(e) => save({ timezone: e.target.value }, `Time zone set to ${zoneLongName(e.target.value)}`)}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <p className="setting-hint">
                {zoneLongName(s.timezone)} · it's {formatTime(new Date().toISOString(), s.timezone)} there now. New events use it; events already planned keep theirs.
              </p>
            </div>
            <Choice
              label="Clock"
              value={s.clockFormat}
              options={[
                { value: "12h", label: "12-hour (6:00 PM)" },
                { value: "24h", label: "24-hour (18:00)" },
              ]}
              onChange={(clockFormat) => save({ clockFormat })}
            />
            <Choice
              label="Weeks start on"
              value={s.weekStart}
              options={[
                { value: "monday", label: "Monday" },
                { value: "sunday", label: "Sunday" },
              ]}
              onChange={(weekStart) => save({ weekStart })}
            />
          </Section>

          <Section id="defaults" title="Program defaults" help="Filled in for each new event. You can still change them on the event.">
            <div className="setting-field">
              <label htmlFor="default-start" className="field-label">
                Usual start time
              </label>
              <select
                id="default-start"
                className="select setting-select-narrow"
                value={s.defaultStartTime ?? ""}
                onChange={(e) => save({ defaultStartTime: e.target.value || null })}
              >
                <option value="">No usual time</option>
                {QUARTER_HOURS.map((t) => (
                  <option key={t} value={t}>
                    {formatTime(`2000-01-01T${t}:00.000Z`, "UTC")}
                  </option>
                ))}
              </select>
            </div>
            <Choice
              label="Moving to the next item"
              value={s.defaultProgression}
              options={[
                { value: "manual", label: "Manually, by an Admin" },
                { value: "auto", label: "Automatically, on time" },
              ]}
              onChange={(defaultProgression) => save({ defaultProgression })}
            />
          </Section>

          <Section id="approval" title="Approval" help="Approval is when everyone on a program is emailed their part.">
            <Toggle
              label="Programs need an Approver's approval"
              hint={s.requireApproval ? "Drafts are sent for review, and an Approver approves them." : "Approvers and Admins publish drafts straight away, with no review."}
              checked={s.requireApproval}
              onChange={(requireApproval) => save({ requireApproval })}
            />
            <Toggle
              label="People can approve programs they sent for review"
              hint={s.allowSelfApproval ? "Handy for small teams." : "Someone else must approve, for a second pair of eyes."}
              checked={s.allowSelfApproval}
              disabled={!s.requireApproval}
              onChange={(allowSelfApproval) => save({ allowSelfApproval })}
            />
            <fieldset className="choice" disabled={!s.requireApproval}>
              <legend>Approvers chosen by default</legend>
              {approvers.length === 0 && <p className="setting-hint">Nobody on the team is an Approver yet.</p>}
              <div className="check-list">
                {approvers.map((a) => {
                  const on = s.defaultApproverIds.includes(a.user.id);
                  return (
                    <label key={a.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          save({ defaultApproverIds: on ? s.defaultApproverIds.filter((x) => x !== a.user.id) : [...s.defaultApproverIds, a.user.id] })
                        }
                      />
                      {a.user.firstName} {a.user.lastName}
                      {a.user.id === user?.id && <span className="muted"> (you)</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </Section>

          <Section id="reminders" title="Reminders" help="Emailed to everyone on an approved program. Each person can turn them off for themselves.">
            <Toggle
              label="Send reminder emails before events"
              hint="To everyone on the program, team members and guests."
              checked={s.remindersEnabled}
              onChange={(remindersEnabled) => save({ remindersEnabled })}
            />
            <fieldset className="choice" disabled={!s.remindersEnabled}>
              <legend>When</legend>
              <div className="check-list check-list-inline">
                {REMINDER_CHOICES.map((r) => {
                  const on = s.reminderOffsets.includes(r.value);
                  return (
                    <label key={r.value} className="check-row">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => save({ reminderOffsets: on ? s.reminderOffsets.filter((x) => x !== r.value) : [...s.reminderOffsets, r.value] })}
                      />
                      {r.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </Section>

          <Section id="invites" title="Invites">
            <Choice
              label="New invitations are for"
              value={s.inviteDefaultRole}
              options={[
                { value: "member", label: "Members" },
                { value: "admin", label: "Admins" },
              ]}
              onChange={(inviteDefaultRole) => save({ inviteDefaultRole })}
            />
            <Choice
              label="Email invitations last"
              value={s.inviteExpiryDays}
              options={[3, 7, 14, 30].map((d) => ({ value: d, label: `${d} days` }))}
              onChange={(inviteExpiryDays) => save({ inviteExpiryDays })}
            />
            <Toggle
              label="Allow an invite link"
              hint={s.inviteLinkEnabled ? "One link to share with a group, made on the People page." : "Turning it off also stops the link that's out there now."}
              checked={s.inviteLinkEnabled}
              onChange={(inviteLinkEnabled) => save({ inviteLinkEnabled })}
            />
            <Toggle
              label="People who use the link wait to be let in"
              hint={s.linkRequiresApproval ? "An Approver or Admin checks who they are first." : "They join as Members straight away."}
              checked={s.linkRequiresApproval}
              disabled={!s.inviteLinkEnabled}
              onChange={(linkRequiresApproval) => save({ linkRequiresApproval })}
            />
          </Section>

          <Section id="live" title="Live screen" help="How the command centre looks on the day.">
            <Choice
              label="The countdown turns amber with"
              value={s.liveWarningMinutes}
              options={[1, 2, 5].map((m) => ({ value: m, label: `${m} minute${m === 1 ? "" : "s"} left` }))}
              onChange={(liveWarningMinutes) => save({ liveWarningMinutes })}
            />
            <Toggle
              label="Show who's on each item"
              hint="Turn off if the screen is seen by the audience and names shouldn't be."
              checked={s.liveShowNames}
              onChange={(liveShowNames) => save({ liveShowNames })}
            />
          </Section>

          <Section id="library" title="Agenda library" help="What's suggested as you type What, and the programs offered as templates.">
            <AgendaLibrary teamId={teamId} />
          </Section>

          {data.canDeleteTeam && (
            <Section id="danger" title="Danger zone">
              <DangerZone
                teamId={teamId}
                teamName={s.name}
                members={members.filter((m) => m.user.id !== user?.id)}
                onGone={async () => {
                  await refresh();
                  navigate("/admin", { replace: true });
                }}
              />
            </Section>
          )}
        </>
      )}
    </AppShell>
  );
}
