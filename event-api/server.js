/* ==========================================================================
   server.js — Gather backend, now on PostgreSQL (Supabase)

   npm install express express-session bcryptjs pg dotenv
   node server.js   →   http://localhost:3000

   The routes, the middleware and the permission checks are unchanged from
   the SQLite version. What changed is that every database call is now
   asynchronous — Postgres is a server across a network, not a file on disk,
   so nothing comes back instantly. Hence async/await everywhere.
   ========================================================================== */

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool, init } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

/* Hosts set NODE_ENV=production for you. Locally it is undefined, which is
   what you want — the strict cookie rules below would stop logins working
   over plain http://localhost. */
const isProd = process.env.NODE_ENV === "production";

/* A deployed app sits behind the host's proxy, which terminates HTTPS and
   forwards plain http. Without this Express thinks the connection is
   insecure, refuses to set a `secure` cookie, and nobody can ever log in. */
if (isProd) app.set("trust proxy", 1);

/* Falling back to a hard-coded secret in production would mean anyone who
   has read this file can forge a session cookie. Better to refuse to start. */
if (isProd && !process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET must be set in production.");
  process.exit(1);
}

app.use(express.json());

app.use(
  session({
    /* Sessions live in Postgres, not in this process's memory.

       The default MemoryStore logs everyone out on every restart, and free
       hosting tiers restart often — they sleep after idle and cold-start on
       the next request. It also grows forever, because nothing ever removes
       expired sessions. Both problems go away by putting them in the
       database that is already running. */
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 60 // sweep expired rows hourly
    }),
    secret: process.env.SESSION_SECRET || "dev-only-local-secret",
    resave: false,
    saveUninitialized: false,
    proxy: isProd,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      /* HTTPS-only once deployed; off locally so http://localhost works. */
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(path.join(__dirname, "..", "frontend")));

/* ==========================================================================
   Queries

   $1, $2 are Postgres placeholders — the equivalent of SQLite's ?. The
   important part is unchanged: values travel separately from the SQL text,
   so a person typing  '; DROP TABLE users; --  into a form is stored as a
   silly event title instead of being run as a command. Never build SQL with
   + or template strings.

   Note the "quoted" aliases. Postgres lowercases any identifier you do not
   quote, so starts_at AS startsAt would come back as `startsat` and the
   frontend would render "Invalid Date". The quotes are what keep the JSON
   shape identical to before.
   ========================================================================== */

/* Every event query needs the host's name and a live count of who has
   signed up, so both are computed here rather than stored on the row. A
   stored count would drift the moment a cancellation went wrong.

   ::int matters: Postgres COUNT returns a 64-bit integer, which the driver
   hands back as the *string* "7" to avoid losing precision. Without the
   cast, `event.registered++` on the frontend would produce "71". */
const EVENT_SELECT = `
  SELECT
    e.id,
    e.host_id     AS "hostId",
    e.title,
    e.description,
    e.category,
    e.starts_at   AS "startsAt",
    e.ends_at     AS "endsAt",
    e.venue,
    e.city,
    e.price,
    e.capacity,
    e.color,
    e.created_at  AS "createdAt",
    u.name        AS "hostName",
    (SELECT COUNT(*)::int FROM registrations r
      WHERE r.event_id = e.id AND r.status = 'confirmed') AS registered
  FROM events e
  JOIN users u ON u.id = e.host_id
`;

const USER_SELECT = `
  SELECT id, name, email, password_hash AS "passwordHash",
         role, is_banned AS "isBanned"
  FROM users
`;

const q = {
  userByEmail: (email) => one(USER_SELECT + " WHERE email = $1", [email]),
  userById: (id) => one(USER_SELECT + " WHERE id = $1", [id]),

  insertUser: (name, email, passwordHash, role) =>
    one(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, email, passwordHash, role]
    ),

  allUsers: () =>
    many(
      `SELECT id, name, email, role, is_banned AS "isBanned"
       FROM users ORDER BY id`
    ),

  updateUser: (role, isBanned, id) =>
    pool.query("UPDATE users SET role = $1, is_banned = $2 WHERE id = $3", [
      role,
      isBanned,
      id
    ]),

  promoteToHost: (id) =>
    pool.query(
      "UPDATE users SET role = 'host' WHERE id = $1 AND role = 'attendee'",
      [id]
    ),

  eventById: (id) => one(EVENT_SELECT + " WHERE e.id = $1", [id]),

  /* ILIKE is Postgres' case-insensitive LIKE, so the lower() wrapping the
     old query needed is gone. */
  eventsFiltered: (search, category) =>
    many(
      EVENT_SELECT +
        `
      WHERE ($1 = '' OR
             e.title       ILIKE '%' || $1 || '%' OR
             e.venue       ILIKE '%' || $1 || '%' OR
             e.description ILIKE '%' || $1 || '%')
        AND ($2 = 'all' OR e.category = $2)
      ORDER BY e.starts_at
    `,
      [search, category]
    ),

  eventsByHost: (hostId) =>
    many(EVENT_SELECT + " WHERE e.host_id = $1 ORDER BY e.starts_at", [hostId]),

  rawEventById: (id) =>
    one(
      `SELECT id, host_id AS "hostId", capacity, starts_at AS "startsAt"
       FROM events WHERE id = $1`,
      [id]
    ),

  insertEvent: (e) =>
    one(
      `INSERT INTO events
         (host_id, title, description, category, starts_at, ends_at,
          venue, city, price, capacity, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        e.hostId, e.title, e.description, e.category, e.startsAt, e.endsAt,
        e.venue, e.city, e.price, e.capacity, e.color
      ]
    ),

  deleteEvent: (id) => pool.query("DELETE FROM events WHERE id = $1", [id]),

  deleteRegistration: (eventId, userId) =>
    pool.query("DELETE FROM registrations WHERE event_id = $1 AND user_id = $2", [
      eventId,
      userId
    ]),

  myRegistrations: (userId) =>
    many(
      `SELECT id, event_id AS "eventId", ticket_code AS "ticketCode", status
       FROM registrations WHERE user_id = $1 ORDER BY id DESC`,
      [userId]
    ),

  attendeesFor: (eventId) =>
    many(
      `SELECT r.ticket_code AS "ticketCode", r.status, u.name, u.email
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1
       ORDER BY r.id`,
      [eventId]
    ),

  stats: () =>
    one(`
      SELECT
        (SELECT COUNT(*)::int FROM users)         AS users,
        (SELECT COUNT(*)::int FROM events)        AS events,
        (SELECT COUNT(*)::int FROM registrations) AS registrations
    `)
};

/* ==========================================================================
   Helpers
   ========================================================================== */

/* better-sqlite3 had .get() and .all(). These are the two-line equivalents,
   so the route bodies below stay readable. */
async function one(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0]; // undefined when nothing matched, same as .get()
}

async function many(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Log in to do that" });

  const user = await q.userById(req.session.userId);
  if (!user) return res.status(401).json({ error: "Log in to do that" });

  /* isBanned is a real boolean now, not SQLite's 0/1. */
  if (user.isBanned) return res.status(403).json({ error: "Your account is suspended" });

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admins only" });
  next();
}

function makeTicketCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return "GTHR-" + code;
}

/* Postgres reports a violated UNIQUE constraint as SQLSTATE 23505. Matching
   on the error text, the way the SQLite version did, is fragile. */
const UNIQUE_VIOLATION = "23505";

/* ==========================================================================
   Auth
   ========================================================================== */

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (await q.userByEmail(cleanEmail)) {
    return res.status(409).json({ error: "That email is already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const row = await q.insertUser(String(name).trim(), cleanEmail, passwordHash, "attendee");
    req.session.userId = row.id;
    res.status(201).json(publicUser(await q.userById(row.id)));
  } catch (err) {
    /* The UNIQUE constraint fired — two signups raced for the same email.
       The check above misses this; the database does not. */
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "That email is already registered" });
    }
    throw err;
  }
});

app.post("/api/auth/login", async (req, res) => {
  const user = await q.userByEmail(String(req.body.email || "").trim().toLowerCase());

  const ok = user && (await bcrypt.compare(req.body.password || "", user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Email or password is incorrect" });
  if (user.isBanned) return res.status(403).json({ error: "Your account is suspended" });

  req.session.userId = user.id;
  res.json(publicUser(user));
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) return res.json(null);
  const user = await q.userById(req.session.userId);
  res.json(user ? publicUser(user) : null);
});

/* ==========================================================================
   Events
   ========================================================================== */

app.get("/api/events", async (req, res) => {
  res.json(
    await q.eventsFiltered(
      String(req.query.search || ""),
      req.query.category || "all"
    )
  );
});

app.get("/api/events/:id", async (req, res) => {
  const event = await q.eventById(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });
  res.json(event);
});

app.post("/api/events", requireAuth, async (req, res) => {
  const body = req.body;

  if (!body.title || !body.startsAt || !body.endsAt || !body.venue) {
    return res.status(400).json({ error: "Title, dates and venue are required" });
  }
  if (new Date(body.endsAt) <= new Date(body.startsAt)) {
    return res.status(400).json({ error: "The end time must be after the start time" });
  }
  const capacity = Number(body.capacity);
  if (!capacity || capacity < 1) {
    return res.status(400).json({ error: "Capacity must be at least 1" });
  }

  const row = await q.insertEvent({
    hostId: req.user.id,
    title: String(body.title).trim(),
    description: String(body.description || "").trim(),
    category: body.category || "Community",
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    venue: String(body.venue).trim(),
    city: String(body.city || "Pune").trim(),
    price: Number(body.price) || 0,
    capacity,
    color: "#2f2bbf"
  });

  await q.promoteToHost(req.user.id);

  res.status(201).json(await q.eventById(row.id));
});

app.delete("/api/events/:id", requireAuth, async (req, res) => {
  const event = await q.rawEventById(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });

  if (event.hostId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "That is not your event" });
  }

  /* ON DELETE CASCADE in the schema removes that event's registrations for
     us, so there are no orphaned rows left behind. */
  await q.deleteEvent(event.id);
  res.json({ ok: true });
});

app.get("/api/events/:id/registrations", requireAuth, async (req, res) => {
  const event = await q.rawEventById(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });

  if (event.hostId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "That is not your event" });
  }

  res.json(await q.attendeesFor(event.id));
});

/* ==========================================================================
   Registrations
   ========================================================================== */

/* The seat check and the insert must happen together, with nothing able to
   slip between them.

   SQLite could rely on a plain transaction because it lets exactly one
   writer in at a time. Postgres runs writers concurrently, so a transaction
   alone is NOT enough — two people could both read "39 of 40 taken" and
   both insert. SELECT ... FOR UPDATE takes a lock on that one event row, so
   the second booker waits until the first has committed and then reads the
   true count. Other events are unaffected. */
async function bookSeat(eventId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const locked = await client.query(
      "SELECT capacity FROM events WHERE id = $1 FOR UPDATE",
      [eventId]
    );
    if (locked.rowCount === 0) {
      const err = new Error("No event with that id");
      err.status = 404;
      throw err;
    }

    /* Checked before capacity, otherwise someone already holding a ticket
       for a full event is told "sold out" — confusing, since they have a
       seat. The UNIQUE constraint still backs this up if two of their
       clicks arrive at once. */
    const existing = await client.query(
      "SELECT 1 FROM registrations WHERE event_id = $1 AND user_id = $2",
      [eventId, userId]
    );
    if (existing.rowCount > 0) {
      const err = new Error("You are already registered");
      err.status = 409;
      throw err;
    }

    const taken = await client.query(
      `SELECT COUNT(*)::int AS n FROM registrations
       WHERE event_id = $1 AND status = 'confirmed'`,
      [eventId]
    );
    if (taken.rows[0].n >= locked.rows[0].capacity) {
      const err = new Error("This event is sold out");
      err.status = 409;
      throw err;
    }

    const ticketCode = makeTicketCode();
    await client.query(
      "INSERT INTO registrations (event_id, user_id, ticket_code) VALUES ($1, $2, $3)",
      [eventId, userId, ticketCode]
    );

    await client.query("COMMIT");
    return { eventId, ticketCode, status: "confirmed" };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    /* Miss this and the pool leaks a connection per booking, until the app
       hangs waiting for one that will never come back. */
    client.release();
  }
}

app.post("/api/events/:id/register", requireAuth, async (req, res) => {
  const event = await q.rawEventById(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });

  if (new Date(event.startsAt) < new Date()) {
    return res.status(400).json({ error: "That event has already started" });
  }

  try {
    res.status(201).json(await bookSeat(event.id, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });

    /* The UNIQUE (event_id, user_id) constraint rejected a double booking. */
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "You are already registered" });
    }

    console.error(err);
    res.status(500).json({ error: "Could not book that seat" });
  }
});

app.delete("/api/events/:id/register", requireAuth, async (req, res) => {
  const result = await q.deleteRegistration(Number(req.params.id), req.user.id);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "You are not registered" });
  }
  res.json({ ok: true });
});

app.get("/api/me/registrations", requireAuth, async (req, res) => {
  const regs = await q.myRegistrations(req.user.id);

  /* One query per registration was fine against a local file. Against a
     network database it is N round trips, so the events are fetched in
     parallel instead of one after another. */
  const events = await Promise.all(regs.map((reg) => q.eventById(reg.eventId)));

  res.json(regs.map((reg, i) => ({ ...reg, event: events[i] || null })));
});

app.get("/api/me/events", requireAuth, async (req, res) => {
  res.json(await q.eventsByHost(req.user.id));
});

/* ==========================================================================
   Admin
   ========================================================================== */

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  res.json(await q.allUsers());
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const user = await q.userById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "No user with that id" });

  if (user.id === req.user.id) {
    return res.status(400).json({ error: "You cannot change your own account here" });
  }

  const role = ["attendee", "host", "admin"].includes(req.body.role)
    ? req.body.role
    : user.role;

  const isBanned =
    typeof req.body.isBanned === "boolean" ? req.body.isBanned : user.isBanned;

  await q.updateUser(role, isBanned, user.id);
  res.json({ ...publicUser(await q.userById(user.id)), isBanned });
});

app.get("/api/admin/stats", requireAuth, requireAdmin, async (req, res) => {
  res.json(await q.stats());
});

/* ==========================================================================
   Errors and startup
   ========================================================================== */

/* Express 5 forwards a rejected promise from an async route to here. Without
   this the request would hang and the reason would never be printed. */
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

/* The tables have to exist before the first request arrives, and creating
   them is async, so the server only starts listening once that is done. */
init()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Gather running at http://localhost:" + PORT);
      console.log("Admin login: admin@gather.test / admin1234");
    });
  })
  .catch((err) => {
    console.error("Could not start — database setup failed:");
    console.error(err.message);
    process.exit(1);
  });
