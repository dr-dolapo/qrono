-- The team's running list of people for agendas (the new agenda editor's "Who").
-- Team members come from team_memberships; everyone else typed into an agenda is a
-- contact here. Contacts may start with a name only; an email is needed before the
-- program they're on is approved, which is when they're invited to join the team.

CREATE TABLE team_contacts (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT COLLATE NOCASE,         -- NULL until someone adds it
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_at  TEXT,                        -- when their team invitation was sent
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_team_contacts_team ON team_contacts(team_id);
CREATE UNIQUE INDEX idx_team_contacts_email ON team_contacts(team_id, email) WHERE email IS NOT NULL;

-- Which contact a guest participant is. A guest without an email yet is stored with
-- guest_email = '' (the table's CHECK requires a value, and rebuilding the table on D1
-- would cascade-delete its assignments). The API treats '' as "no email yet".
ALTER TABLE event_participants ADD COLUMN contact_id TEXT REFERENCES team_contacts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_event_participants_contact ON event_participants(event_id, contact_id) WHERE contact_id IS NOT NULL;
DROP INDEX idx_event_participants_guest;
CREATE UNIQUE INDEX idx_event_participants_guest ON event_participants(event_id, guest_email)
  WHERE guest_email IS NOT NULL AND guest_email <> '';

-- Start the list with every guest the team has already had.
INSERT INTO team_contacts (id, team_id, name, email, created_at)
SELECT lower(hex(randomblob(12))), e.team_id, MIN(p.guest_name), lower(p.guest_email), MIN(p.created_at)
  FROM event_participants p JOIN events e ON e.id = p.event_id
 WHERE p.user_id IS NULL AND p.guest_email IS NOT NULL AND p.guest_email <> ''
 GROUP BY e.team_id, lower(p.guest_email);

UPDATE event_participants
   SET contact_id = (
     SELECT c.id FROM team_contacts c JOIN events e ON e.team_id = c.team_id
      WHERE e.id = event_participants.event_id AND c.email = event_participants.guest_email
   )
 WHERE user_id IS NULL AND guest_email <> '';
