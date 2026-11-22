-- Qrono v1 schema — implements docs/PRD.md section 10 (Data model).
-- Conventions:
--   * IDs are random, non-sequential TEXT (generated in the API).
--   * Timestamps are ISO-8601 UTC TEXT, e.g. '2026-11-22T14:00:00.000Z'.
--   * Enums are enforced with CHECK constraints.

-- D1 enforces foreign keys by default.

-- ───────────────────────── 10.1 People & teams ─────────────────────────

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at  TEXT,
  phone              TEXT,
  password_hash      TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mandate     TEXT NOT NULL DEFAULT 'any_to_sign' CHECK (mandate IN ('any_to_sign')),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE team_memberships (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('approver', 'admin', 'member')),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('pending_vetting', 'active', 'removed')),
  approved_by  TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (team_id, user_id)
);
CREATE INDEX idx_team_memberships_user ON team_memberships(user_id);

CREATE TABLE team_invites (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'link')),
  recipient   TEXT,                       -- email or phone; NULL for shareable links
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('approver', 'admin', 'member')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Invite links can only ever join people as Members (QR001).
  CHECK (channel <> 'link' OR role = 'member'),
  CHECK (channel = 'link' OR recipient IS NOT NULL)
);
CREATE INDEX idx_team_invites_team ON team_invites(team_id);

CREATE TABLE device_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token         TEXT NOT NULL UNIQUE,
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);

-- ───────────────────────── 10.2 Events & agenda ─────────────────────────

CREATE TABLE event_series (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  recurrence_rule  TEXT NOT NULL,          -- iCal RRULE
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE events (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  series_id         TEXT REFERENCES event_series(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  start_at          TEXT NOT NULL,
  end_at            TEXT NOT NULL,
  timezone          TEXT NOT NULL,         -- IANA zone, e.g. 'Africa/Lagos'
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'review', 'approved', 'live', 'past')),
  progression_mode  TEXT NOT NULL DEFAULT 'manual' CHECK (progression_mode IN ('auto', 'manual')),
  current_task_id   TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_by        TEXT NOT NULL REFERENCES users(id),
  ended_early_by    TEXT REFERENCES users(id),
  ended_early_at    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_at > start_at)
);
CREATE INDEX idx_events_team_start ON events(team_id, start_at);
CREATE INDEX idx_events_status ON events(status);

CREATE TABLE stages (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- usually the hall name
  venue       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_stages_event ON stages(event_id);

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  stage_id          TEXT REFERENCES stages(id) ON DELETE CASCADE,  -- NULL = runs on all stages
  title             TEXT NOT NULL,
  description       TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  planned_start_at  TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL CHECK (duration_minutes > 0),
  status            TEXT NOT NULL DEFAULT 'upcoming'
                      CHECK (status IN ('upcoming', 'in_progress', 'done', 'skipped')),
  actual_start_at   TEXT,
  actual_end_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tasks_event_stage_order ON tasks(event_id, stage_id, sort_order);

-- ───────────────────────── 10.3 Participants & guests ─────────────────────────

CREATE TABLE event_participants (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_name      TEXT,
  guest_email     TEXT COLLATE NOCASE,
  response        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (response IN ('pending', 'acknowledged', 'declined')),
  decline_reason  TEXT,
  notified_at     TEXT,
  responded_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Exactly one of: a registered user, or a guest (name + email).
  CHECK (
    (user_id IS NOT NULL AND guest_name IS NULL AND guest_email IS NULL)
    OR (user_id IS NULL AND guest_name IS NOT NULL AND guest_email IS NOT NULL)
  ),
  CHECK (response <> 'declined' OR decline_reason IS NOT NULL)
);
CREATE UNIQUE INDEX idx_event_participants_user ON event_participants(event_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_event_participants_guest ON event_participants(event_id, guest_email)
  WHERE guest_email IS NOT NULL;

CREATE TABLE task_assignments (
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  participant_id   TEXT NOT NULL REFERENCES event_participants(id) ON DELETE CASCADE,
  roll_call_order  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_id, participant_id)
);
CREATE INDEX idx_task_assignments_participant ON task_assignments(participant_id);

CREATE TABLE guest_access_links (
  id              TEXT PRIMARY KEY,
  participant_id  TEXT NOT NULL REFERENCES event_participants(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,           -- = event end_at, or earlier if ended early
  revoked_at      TEXT,
  last_opened_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- One active (unrevoked) link per guest.
CREATE UNIQUE INDEX idx_guest_access_links_active ON guest_access_links(participant_id)
  WHERE revoked_at IS NULL;

-- ───────────────────────── 10.4 Review & approval ─────────────────────────

CREATE TABLE event_approvers (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  approved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE event_status_changes (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_status  TEXT CHECK (from_status IN ('draft', 'review', 'approved', 'live', 'past')),
  to_status    TEXT NOT NULL CHECK (to_status IN ('draft', 'review', 'approved', 'live', 'past')),
  changed_by   TEXT REFERENCES users(id),  -- NULL = system (e.g. went Live at start time)
  changed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_event_status_changes_event ON event_status_changes(event_id, changed_at);

-- ───────────────────────── 10.5 Comments ─────────────────────────

CREATE TABLE comments (
  id                    TEXT PRIMARY KEY,
  task_id               TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id             TEXT NOT NULL REFERENCES users(id),
  body                  TEXT NOT NULL,
  event_status_at_post  TEXT NOT NULL
                          CHECK (event_status_at_post IN ('draft', 'review', 'approved', 'live', 'past')),
  edited_at             TEXT,
  deleted_at            TEXT,              -- soft delete only, so history stays complete (QR015)
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_comments_task ON comments(task_id, created_at);

-- ───────────────────────── 10.6 Broadcasts ─────────────────────────

CREATE TABLE broadcasts (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sent_by   TEXT NOT NULL REFERENCES users(id),
  body      TEXT NOT NULL,
  audience  TEXT NOT NULL CHECK (audience IN ('everyone', 'stages', 'participants')),
  sent_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_broadcasts_event ON broadcasts(event_id, sent_at);

CREATE TABLE broadcast_targets (
  id              TEXT PRIMARY KEY,
  broadcast_id    TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  stage_id        TEXT REFERENCES stages(id) ON DELETE CASCADE,
  participant_id  TEXT REFERENCES event_participants(id) ON DELETE CASCADE,
  CHECK ((stage_id IS NULL) <> (participant_id IS NULL))
);
CREATE INDEX idx_broadcast_targets_broadcast ON broadcast_targets(broadcast_id);

CREATE TABLE broadcast_receipts (
  broadcast_id  TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- guests never receive broadcasts
  delivered_at  TEXT,
  response      TEXT NOT NULL DEFAULT 'none'
                  CHECK (response IN ('none', 'acknowledged', 'snoozed', 'done')),
  responded_at  TEXT,
  snooze_until  TEXT,                      -- responded_at + 3 minutes when snoozed
  snooze_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX idx_broadcast_receipts_snooze ON broadcast_receipts(snooze_until)
  WHERE response = 'snoozed';

-- ───────────────────────── 10.7 Notifications ─────────────────────────

CREATE TABLE notifications (
  id                TEXT PRIMARY KEY,
  user_id           TEXT REFERENCES users(id) ON DELETE CASCADE,
  participant_id    TEXT REFERENCES event_participants(id) ON DELETE CASCADE,  -- guests
  type              TEXT NOT NULL CHECK (type IN (
                      'review_requested', 'event_approved', 'assigned_to_event',
                      'broadcast', 'team_invite', 'guest_link', 'password_reset', 'email_verification')),
  channel           TEXT NOT NULL CHECK (channel IN ('push', 'email', 'sms', 'in_app')),
  related_event_id  TEXT REFERENCES events(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at           TEXT,
  read_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (user_id IS NOT NULL OR participant_id IS NOT NULL)
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
