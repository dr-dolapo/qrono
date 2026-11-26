-- Deleted accounts: the row stays (programs, comments and approvals still point at it)
-- but every personal detail is wiped and it can never log in again.
ALTER TABLE users ADD COLUMN deleted_at TEXT;
