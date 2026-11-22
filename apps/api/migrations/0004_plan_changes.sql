-- Editing approved and live events, with batched notifications to everyone affected.

-- When set, people affected by recent changes are emailed at this time
-- (2 minutes after the last edit, so a burst of edits becomes one email).
ALTER TABLE events ADD COLUMN notify_after TEXT;

-- What each person on the program was last told about their part, so the
-- next notification goes only to people whose part actually changed.
-- Not linked to event_participants, so we can still tell people who were removed.
CREATE TABLE plan_notices (
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('member', 'guest')),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  summary         TEXT NOT NULL,       -- JSON: event name, times, this person's tasks
  lines           TEXT NOT NULL,       -- JSON array of "09:00  Keynote" lines, for emails
  notified_at     TEXT NOT NULL,
  PRIMARY KEY (event_id, participant_id)
);
