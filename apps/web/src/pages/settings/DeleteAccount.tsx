import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ApiError, api } from "../../api";
import { useAuth } from "../../auth/AuthContext";

/** Your settings → Delete account: with the password, for good. Mirrors the app's Profile screen. */
export function DeleteAccount() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/me/delete", { body: { password } });
      await logout().catch(() => undefined);
      toast.success("Your account has been deleted.");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="danger">
      <div className="danger-item">
        <div>
          <h3 className="sub-head">Delete your account</h3>
          <p>
            Deletes your name, email and password and logs you out everywhere. You leave all your teams; teams where you're the only member are
            deleted. Programs you worked on stay with their teams, showing “Deleted user”. This can't be undone.
          </p>
        </div>
        {open ? (
          <form
            className="setting-row"
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            <label className="visually-hidden" htmlFor="delete-password">
              Your password
            </label>
            <input
              id="delete-password"
              className="input-filled"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="button button-danger button-auto" disabled={busy || !password}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </form>
        ) : (
          <button type="button" className="button button-secondary button-auto" onClick={() => setOpen(true)}>
            Delete account
          </button>
        )}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
