-- Counters for limiting repeated attempts (failed logins, reset emails, ...).
-- One row per key, e.g. "login:email:ada@example.com" or "login:ip:203.0.113.7".

CREATE TABLE rate_limits (
  key            TEXT PRIMARY KEY,
  count          INTEGER NOT NULL,
  window_start   TEXT NOT NULL,       -- when the current counting window began
  blocked_until  TEXT                 -- set once the limit is reached
);
