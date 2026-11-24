-- Team-wide settings (Settings page). Defaults keep today's behaviour.

-- Team profile
ALTER TABLE teams ADD COLUMN logo_data TEXT;                  -- small image as a data: URL, shown on emails and the guest view
ALTER TABLE teams ADD COLUMN default_venue TEXT;

-- Time and region
ALTER TABLE teams ADD COLUMN clock_format TEXT NOT NULL DEFAULT '12h' CHECK (clock_format IN ('12h', '24h'));
ALTER TABLE teams ADD COLUMN week_start TEXT NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday'));

-- Program defaults
ALTER TABLE teams ADD COLUMN default_start_time TEXT;          -- "18:00", prefilled on new events
ALTER TABLE teams ADD COLUMN default_progression TEXT NOT NULL DEFAULT 'manual' CHECK (default_progression IN ('auto', 'manual'));

-- Approval rules
ALTER TABLE teams ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teams ADD COLUMN allow_self_approval INTEGER NOT NULL DEFAULT 1;

-- Reminders to everyone on a program, minutes before the start
ALTER TABLE teams ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teams ADD COLUMN reminder_offsets TEXT NOT NULL DEFAULT '[1440,60]';

-- Invites
ALTER TABLE teams ADD COLUMN invite_default_role TEXT NOT NULL DEFAULT 'member' CHECK (invite_default_role IN ('admin', 'member'));
ALTER TABLE teams ADD COLUMN invite_expiry_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE teams ADD COLUMN invite_link_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teams ADD COLUMN link_requires_approval INTEGER NOT NULL DEFAULT 1;

-- Live screen
ALTER TABLE teams ADD COLUMN live_warning_minutes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teams ADD COLUMN live_show_names INTEGER NOT NULL DEFAULT 1;

-- Each person's own choice, per team: reminder emails on or off.
ALTER TABLE team_memberships ADD COLUMN reminder_emails INTEGER NOT NULL DEFAULT 1;

-- Approvers pre-selected when a program is sent for review.
CREATE TABLE team_default_approvers (
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

-- Agenda library: "What" suggestions the team has hidden, and pinned templates.
CREATE TABLE hidden_suggestions (
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title    TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (team_id, title)
);
CREATE TABLE pinned_templates (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (team_id, event_id)
);

-- Reminders already sent, so each goes out once.
CREATE TABLE reminders_sent (
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,
  sent_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, offset_minutes)
);
