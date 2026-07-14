-- D1 SQL Schema for user accounts
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  sessions TEXT NOT NULL
);
