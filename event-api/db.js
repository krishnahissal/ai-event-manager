/* ==========================================================================
   db.js — the database

   Creates gather.db in this folder the first time it runs. That single
   file IS your database: back it up by copying it, reset it by deleting it.

   SQLite needs no server and no setup. Postgres is what you would use for
   a busy production site, but the SQL you write here is nearly identical,
   so nothing you learn now is wasted.
   ========================================================================== */

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const db = new Database(path.join(__dirname, "gather.db"));

/* Lets reads happen while a write is in progress. Sensible default. */
db.pragma("journal_mode = WAL");

/* Makes SQLite actually enforce the REFERENCES lines below. It ignores
   them unless you switch this on, which surprises everyone once. */
db.pragma("foreign_keys = ON");

/* ==========================================================================
   Schema

   Runs on every startup, but IF NOT EXISTS means it only does something
   the first time. Compare this to the tables sketched at the very start —
   it is the same shape, now written in SQL.
   ========================================================================== */

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL UNIQUE,
    passwordHash TEXT    NOT NULL,
    role         TEXT    NOT NULL DEFAULT 'attendee',
    isBanned     INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hostId      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'Community',
    startsAt    TEXT    NOT NULL,
    endsAt      TEXT    NOT NULL,
    venue       TEXT    NOT NULL,
    city        TEXT    NOT NULL DEFAULT 'Pune',
    price       INTEGER NOT NULL DEFAULT 0,
    capacity    INTEGER NOT NULL,
    color       TEXT    NOT NULL DEFAULT '#2f2bbf',
    createdAt   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    userId     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticketCode TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'confirmed',
    createdAt  TEXT    NOT NULL DEFAULT (datetime('now')),

    /* The database itself refuses a second booking by the same person for
       the same event. Your code checks this too, but code has bugs and
       two requests can arrive at the same instant. This is the backstop
       that cannot be raced. */
    UNIQUE (eventId, userId)
  );

  CREATE INDEX IF NOT EXISTS idx_events_starts ON events(startsAt);
  CREATE INDEX IF NOT EXISTS idx_reg_event     ON registrations(eventId);
  CREATE INDEX IF NOT EXISTS idx_reg_user      ON registrations(userId);
`);

/* ==========================================================================
   Seed — only if the database is empty
   ========================================================================== */

const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, passwordHash, role)
    VALUES (?, ?, ?, ?)
  `);

  const admin = insertUser.run(
    "Site admin",
    "admin@gather.test",
    bcrypt.hashSync("admin1234", 10),
    "admin"
  );

  const insertEvent = db.prepare(`
    INSERT INTO events
      (hostId, title, description, category, startsAt, endsAt, venue, price, capacity, color)
    VALUES
      (@hostId, @title, @description, @category, @startsAt, @endsAt, @venue, @price, @capacity, @color)
  `);

  const starters = [
    {
      hostId: admin.lastInsertRowid,
      title: "Sunday morning run: Vetal Tekdi loop",
      description: "An easy 7km trail loop from the Panchavati gate. Bring water.",
      category: "Outdoors",
      startsAt: "2026-08-23T06:00",
      endsAt: "2026-08-23T08:30",
      venue: "Vetal Tekdi, Panchavati gate",
      price: 0,
      capacity: 40,
      color: "#2f2bbf"
    },
    {
      hostId: admin.lastInsertRowid,
      title: "Open mic night — poetry and stand-up",
      description: "Eight minute slots, sign up at the door from 7pm.",
      category: "Music",
      startsAt: "2026-09-05T19:00",
      endsAt: "2026-09-05T22:00",
      venue: "The Backyard Cafe, Koregaon Park",
      price: 200,
      capacity: 60,
      color: "#a03858"
    },
    {
      hostId: admin.lastInsertRowid,
      title: "Book swap and quiet reading hour",
      description: "Bring one book you have finished, leave with one you have not.",
      category: "Community",
      startsAt: "2026-09-14T16:00",
      endsAt: "2026-09-14T18:00",
      venue: "Pagdandi Books Chai Cafe, Baner",
      price: 0,
      capacity: 30,
      color: "#3d3a52"
    }
  ];

  starters.forEach((e) => insertEvent.run(e));

  console.log("Database created and seeded.");
}

module.exports = db;
