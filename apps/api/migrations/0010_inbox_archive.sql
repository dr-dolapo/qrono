-- The Inbox's Archived list: what each person did with an Inbox item, kept for 60 days.
CREATE TABLE inbox_archive (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The Inbox item's key (approve:<eventId>, confirm:<participantId>, note:<id>, …): one row per item.
  key         TEXT NOT NULL,
  team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,
  event_id    TEXT REFERENCES events(id) ON DELETE SET NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN (
                'approved', 'confirmed', 'declined_part', 'let_in', 'declined_join',
                'joined_team', 'declined_invite', 'opened', 'dismissed')),
  title       TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idx_inbox_archive_user_time ON inbox_archive(user_id, created_at);
