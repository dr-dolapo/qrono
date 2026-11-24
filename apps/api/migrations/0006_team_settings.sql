-- Team-wide settings. The time zone new events use is now a team setting,
-- not chosen per event. Existing teams take the zone of their latest event.
ALTER TABLE teams ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

UPDATE teams
   SET timezone = COALESCE(
     (SELECT e.timezone FROM events e WHERE e.team_id = teams.id ORDER BY e.created_at DESC LIMIT 1),
     'UTC'
   );
