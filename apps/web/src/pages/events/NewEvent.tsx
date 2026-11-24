import { Link, Navigate, useNavigate } from "react-router";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell, refreshComingUp } from "../../components/AppShell";
import { EventDetailsForm } from "./EventDetailsForm";

/** QR019 / QR022: create a draft event (Approvers and Admins, web only). */
export function NewEvent() {
  const { currentTeam } = useAuth();
  const navigate = useNavigate();
  if (currentTeam!.role === "member") return <Navigate to="/admin" replace />;

  return (
    <AppShell>
      <Link to="/admin" className="back-link">
        ← Events
      </Link>
      <h1 className="with-back">New event</h1>
      <p className="page-intro">You'll build the agenda and choose who runs each part next. The event stays a draft until you send it for review.</p>
      <div className="form-card">
        <EventDetailsForm
          timeZone={currentTeam!.timezone}
          canChangeZone
          submitLabel="Create draft event"
          onSubmit={async (values) => {
            const res = await api<{ event: { id: string } }>(`/teams/${currentTeam!.id}/events`, { body: values });
            refreshComingUp();
            navigate(`/admin/events/${res.event.id}`, { replace: true });
          }}
        />
      </div>
    </AppShell>
  );
}
