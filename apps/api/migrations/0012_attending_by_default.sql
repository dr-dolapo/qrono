-- People put on a program are now attending by default; they can still decline.
-- Everyone still waiting for a reply counts as attending.
UPDATE event_participants
   SET response = 'acknowledged', responded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE response = 'pending';

-- A new Inbox note: "You're on the program" (it used to be an item to confirm).
CREATE TABLE inbox_notes_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('part_added', 'part_changed', 'part_removed', 'program_approved', 'program_returned', 'comment')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at    TEXT
);
INSERT INTO inbox_notes_new (id, user_id, team_id, event_id, task_id, kind, title, body, created_at, done_at)
  SELECT id, user_id, team_id, event_id, task_id, kind, title, body, created_at, done_at FROM inbox_notes;
DROP TABLE inbox_notes;
ALTER TABLE inbox_notes_new RENAME TO inbox_notes;
CREATE INDEX idx_inbox_notes_user ON inbox_notes (user_id, done_at, created_at);
