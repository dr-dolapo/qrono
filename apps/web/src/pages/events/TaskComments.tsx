import { useState } from "react";
import { ApiError, type EventDetail, type Task } from "../../api";
import type { Mutate } from "./EventEditor";

const DURING: Record<string, string> = { draft: "in draft", review: "in review", approved: "after approval", live: "live", past: "after the event" };

/** QR012–QR015, QR026: the comment thread on one task. */
export function TaskComments({ detail, task, mutate }: { detail: EventDetail; task: Task; mutate: Mutate }) {
  const comments = detail.comments.filter((c) => c.taskId === task.id);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await mutate(`/tasks/${task.id}/comments`, "POST", { body });
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post your comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comments">
      {comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="comment-meta">
                <strong>{c.author.name}</strong>
                <span className="muted small">
                  {new Date(c.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {DURING[c.postedDuring]}
                </span>
                {c.author.id === detail.me.userId && (
                  <button type="button" className="link-button small" onClick={() => mutate(`/comments/${c.id}`, "DELETE").catch(() => setError("Couldn't delete that comment."))}>
                    Delete
                  </button>
                )}
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {detail.permissions.canComment && (
        <div className="comment-form">
          <label className="visually-hidden" htmlFor={`comment-${task.id}`}>
            Comment on {task.title}
          </label>
          <textarea
            id={`comment-${task.id}`}
            rows={2}
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
          />
          <button type="button" className="button button-small button-auto" disabled={busy || !body.trim()} onClick={post}>
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
