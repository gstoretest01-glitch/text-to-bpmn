-- D1 SQL Schema for user accounts
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  sessions TEXT NOT NULL
);

-- Table to store AI responses and syntax verification errors
CREATE TABLE IF NOT EXISTS bpmn_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  error_type TEXT, -- 'invalid_xml' or 'syntax_error' or 'api_error' or 'success'
  error_message TEXT,
  prompt TEXT,
  ai_response TEXT,
  xml TEXT,
  model TEXT
);
