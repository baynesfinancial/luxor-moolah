CREATE TABLE "user" (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL, image TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE "session" (
  id TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, token TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX session_user ON "session"(userId);
CREATE TABLE "account" (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT,
  idToken TEXT, accessTokenExpiresAt TEXT, refreshTokenExpiresAt TEXT, scope TEXT, password TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX account_user ON "account"(userId);
CREATE TABLE verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX verification_identifier ON verification(identifier);
CREATE TABLE "rateLimit" (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, lastRequest INTEGER NOT NULL);
