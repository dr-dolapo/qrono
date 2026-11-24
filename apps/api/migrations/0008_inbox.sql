-- The mobile Inbox. Most items come straight from what's waiting on someone
-- (an approval, a join request, a part to confirm, a team invitation) and leave
-- when it's handled. These are the rest: things that happened, kept until opened.
CREATE TABLE inbox_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('part_changed', 'part_removed', 'program_approved', 'program_returned', 'comment')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at    TEXT
);
CREATE INDEX idx_inbox_notes_user ON inbox_notes (user_id, done_at, created_at);

-- Which Inbox items someone has seen, for the unread count. Keys look like
-- "approve:<eventId>", "join:<membershipId>", "confirm:<participantId>",
-- "invite:<inviteId>" or "note:<id>".
CREATE TABLE inbox_seen (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, key)
);
