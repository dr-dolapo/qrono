-- A draft item can be just a title: its length (and who runs it) can come later.
-- duration_set = 0 marks an item with no length yet; its duration_minutes then holds a
-- placeholder the schedule ignores. (A new column rather than a nullable one: making
-- duration_minutes nullable means rebuilding tasks, and the tables that point at it.)
-- Every item needs a length before the program is sent for approval or published.
ALTER TABLE tasks ADD COLUMN duration_set INTEGER NOT NULL DEFAULT 1;
