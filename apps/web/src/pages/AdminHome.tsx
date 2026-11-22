import { Link } from "react-router";

/** Placeholder for the Admin & Approver area (QR006–QR022). Web only. */
export function AdminHome() {
  return (
    <main className="page">
      <Link to="/" className="muted small">← Qrono</Link>
      <h1>Events &amp; team</h1>
      <section className="placeholder">
        <p>Coming next:</p>
        <ul>
          <li>Create and edit draft events, with stages and tasks</li>
          <li>Assign participants, including guests</li>
          <li>Send for review and approve</li>
          <li>Invite your team and assign roles</li>
        </ul>
      </section>
    </main>
  );
}
