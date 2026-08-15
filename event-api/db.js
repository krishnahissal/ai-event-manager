/* ==========================================================================
   db.js — the database (PostgreSQL / Supabase)

   Connects using DATABASE_URL from .env. That connection string IS your
   database now: there is no local file to back up or delete any more.

   npm install pg dotenv
   ========================================================================== */

require("dotenv").config();

const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it to event-api/.env");
  process.exit(1);
}

/* A pool, not a single connection. Postgres is a real server, so requests
   borrow a connection, use it, and hand it back. Opening a fresh one per
   query is the classic way to make a fast app slow. */
/* Supabase requires TLS, and its pooler presents a certificate that is not
   in Node's default trust store, so verification is relaxed. A Postgres you
   run on your own machine has no TLS at all, so it is switched off there —
   otherwise the connection is refused before it starts. */
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

/* Without this an unreachable database takes the whole process down —
   which is exactly the "it just stops" behaviour you were seeing. */
pool.on("error", (err) => {
  console.error("Idle Postgres client error:", err.message);
});

/* ==========================================================================
   Schema

   Two things changed shape moving off SQLite:

   - Column names are snake_case. Unquoted identifiers get folded to
     lowercase by Postgres, so "hostId" would silently become "hostid".
     Rather than quote every identifier forever, the columns are named the
     Postgres way and aliased back to camelCase in the SELECTs, so the JSON
     the frontend receives is unchanged.

   - isBanned is a real BOOLEAN instead of 0/1. SQLite had no boolean type;
     Postgres does.

   startsAt / endsAt stay TEXT on purpose. They hold the exact
   "2026-08-23T06:00" string the date input produces. Switching them to
   timestamptz would make Postgres reinterpret them in UTC and every event
   would jump by 5.5 hours.
   ========================================================================== */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'attendee',
    is_banned     BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    host_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'Community',
    starts_at   TEXT    NOT NULL,
    ends_at     TEXT    NOT NULL,
    venue       TEXT    NOT NULL,
    city        TEXT    NOT NULL DEFAULT 'Pune',
    price       INTEGER NOT NULL DEFAULT 0,
    capacity    INTEGER NOT NULL,
    color       TEXT    NOT NULL DEFAULT '#2f2bbf',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_code TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'confirmed',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    /* The database itself refuses a second booking by the same person for
       the same event. Your code checks this too, but code has bugs and two
       requests can arrive at the same instant. This is the backstop that
       cannot be raced. */
    UNIQUE (event_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
  CREATE INDEX IF NOT EXISTS idx_reg_event     ON registrations(event_id);
  CREATE INDEX IF NOT EXISTS idx_reg_user      ON registrations(user_id);
`;

/* ==========================================================================
   Seed — only if the database is empty
   ========================================================================== */

const STARTERS = [
  {
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

/* Called once at startup, before the server accepts requests. Creating
   tables is async now, so this cannot happen at require() time the way it
   did with SQLite. */
async function init() {
  await pool.query(SCHEMA);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (rows[0].n > 0) return;

  const admin = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ["Site admin", "admin@gather.test", bcrypt.hashSync("admin1234", 10), "admin"]
  );
  const hostId = admin.rows[0].id;

  for (const e of STARTERS) {
    await pool.query(
      `INSERT INTO events
         (host_id, title, description, category, starts_at, ends_at,
          venue, price, capacity, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        hostId, e.title, e.description, e.category, e.startsAt,
        e.endsAt, e.venue, e.price, e.capacity, e.color
      ]
    );
  }

  console.log("Database created and seeded.");
}

module.exports = { pool, init };
