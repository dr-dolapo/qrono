-- Live Activities (iOS) and Live Updates (Android): the card on the lock screen during a live event.

-- iOS tokens for Live Activities. 'start' lets the server open a card on a phone (iOS 17.2+);
-- 'activity' updates one open card, for one event.
CREATE TABLE live_activity_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('start', 'activity')),
  event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((kind = 'start') = (event_id IS NULL))
);
CREATE INDEX idx_live_activity_tokens_user ON live_activity_tokens(user_id, kind);

-- What each person's card last showed, so phones only hear about real changes.
CREATE TABLE live_cards (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  ended_at    TEXT,
  PRIMARY KEY (event_id, user_id)
);
