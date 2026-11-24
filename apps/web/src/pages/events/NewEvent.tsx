import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { api, type SettingsResponse } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell, refreshComingUp } from "../../components/AppShell";
import { EventDetailsForm } from "./EventDetailsForm";

/** QR019 / QR022: create a draft event (Approvers and Admins, web only). */
export function NewEvent() {
  const { currentTeam } = useAuth();
  const navigate = useNavigate();
  // The team's usual start time, if it has one. The form waits for it so it can be filled in.
  const [defaultTime, setDefaultTime] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api<SettingsResponse>(`/teams/${currentTeam!.id}/settings`)
      .then((r) => setDefaultTime(r.settings?.defaultStartTime ?? null))
      .catch(() => setDefaultTime(null));
  }, [currentTeam]);
  if (currentTeam!.role === "member") return <Navigate to="/admin" replace />;

  return (
    <AppShell>
      <Link to="/admin" className="back-link">
        ← Events
      </Link>
      <h1 className="with-back">New event</h1>
      <p className="page-intro">You'll build the agenda and choose who runs each part next. The event stays a draft until you send it for review.</p>
      <div className="form-card">
        {defaultTime === undefined ? (
          <p className="muted">Loading…</p>
        ) : (
          <EventDetailsForm
            defaultTime={defaultTime}
            timeZone={currentTeam!.timezone}
            canChangeZone
            submitLabel="Create draft event"
            onSubmit={async (values) => {
              const res = await api<{ event: { id: string } }>(`/teams/${currentTeam!.id}/events`, { body: values });
              refreshComingUp();
              navigate(`/admin/events/${res.event.id}`, { replace: true });
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
