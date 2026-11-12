CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(20) UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎬',
  color_a TEXT NOT NULL DEFAULT '#0f2027',
  color_b TEXT NOT NULL DEFAULT '#2c5364',
  caption TEXT NOT NULL DEFAULT '',
  music TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'All',
  likes_base INT NOT NULL DEFAULT 0,
  video_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at DESC);
CREATE TABLE IF NOT EXISTS likes (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  PRIMARY KEY (user_id, target)
);
CREATE INDEX IF NOT EXISTS follows_target ON follows (target);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  parent_id INT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, created_at);
