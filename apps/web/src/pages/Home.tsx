import { Link } from "react-router";

export function Home() {
  return (
    <main className="page">
      <h1 className="brand">Qrono</h1>
      <p className="muted">Run live events on time, with no dead air.</p>
      <nav className="card-list">
        <Link className="card" to="/admin">
          <strong>Events &amp; team</strong>
          <span className="muted">Create events, send for review, manage your team</span>
        </Link>
        <Link className="card" to="/command/demo">
          <strong>Command centre</strong>
          <span className="muted">Run a live event on the stage screen</span>
        </Link>
      </nav>
      <p className="muted small">Sign-in arrives in the next milestone.</p>
    </main>
  );
}
