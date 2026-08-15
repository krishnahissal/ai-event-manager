/* ==========================================================================
   server.js — Gather backend, now storing everything in SQLite

   npm install express bcryptjs express-session better-sqlite3
   node server.js   →   http://localhost:3000

   Compare this to the previous version: the routes, the middleware and
   the permission checks are unchanged. Only the lines that touched data
   are different. That is what a good separation looks like.
   ========================================================================== */

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = 3000;

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-local-secret",,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(path.join(__dirname, "..", "frontend")));

/* ==========================================================================
   Prepared statements

   Written once, reused forever. The ? and @name placeholders are the
   important part: values go in separately from the SQL text, so a person
   typing  '; DROP TABLE users; --  into a form is stored as a silly event
   title instead of being run as a command. Never build SQL with + or
   template strings.
   ========================================================================== */

/* Every event query needs the host's name and a live count of who has
   signed up, so both are computed here rather than stored on the row.
   A stored count would drift the moment a cancellation went wrong. */
const EVENT_SELECT = `
  SELECT
    e.*,
    u.name AS hostName,
    (SELECT COUNT(*) FROM registrations r
      WHERE r.eventId = e.id AND r.status = 'confirmed') AS registered
  FROM events e
  JOIN users u ON u.id = e.hostId
`;

const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  insertUser: db.prepare(
    "INSERT INTO users (name, email, passwordHash, role) VALUES (?, ?, ?, ?)"
  ),
  allUsers: db.prepare(
    "SELECT id, name, email, role, isBanned FROM users ORDER BY id"
  ),
  updateUser: db.prepare("UPDATE users SET role = ?, isBanned = ? WHERE id = ?"),
  promoteToHost: db.prepare(
    "UPDATE users SET role = 'host' WHERE id = ? AND role = 'attendee'"
  ),

  eventById: db.prepare(EVENT_SELECT + " WHERE e.id = ?"),
  eventsFiltered: db.prepare(
    EVENT_SELECT +
      `
    WHERE (@search = '' OR
           lower(e.title)       LIKE '%' || @search || '%' OR
           lower(e.venue)       LIKE '%' || @search || '%' OR
           lower(e.description) LIKE '%' || @search || '%')
      AND (@category = 'all' OR e.category = @category)
    ORDER BY e.startsAt
  `
  ),
  eventsByHost: db.prepare(EVENT_SELECT + " WHERE e.hostId = ? ORDER BY e.startsAt"),
  rawEventById: db.prepare("SELECT * FROM events WHERE id = ?"),
  insertEvent: db.prepare(`
    INSERT INTO events
      (hostId, title, description, category, startsAt, endsAt, venue, city, price, capacity, color)
    VALUES
      (@hostId, @title, @description, @category, @startsAt, @endsAt, @venue, @city, @price, @capacity, @color)
  `),
  deleteEvent: db.prepare("DELETE FROM events WHERE id = ?"),

  confirmedCount: db.prepare(
    "SELECT COUNT(*) AS n FROM registrations WHERE eventId = ? AND status = 'confirmed'"
  ),
  insertRegistration: db.prepare(
    "INSERT INTO registrations (eventId, userId, ticketCode) VALUES (?, ?, ?)"
  ),
  deleteRegistration: db.prepare(
    "DELETE FROM registrations WHERE eventId = ? AND userId = ?"
  ),
  myRegistrations: db.prepare(
    "SELECT * FROM registrations WHERE userId = ? ORDER BY id DESC"
  ),
  attendeesFor: db.prepare(`
    SELECT r.ticketCode, r.status, u.name, u.email
    FROM registrations r
    JOIN users u ON u.id = r.userId
    WHERE r.eventId = ?
    ORDER BY r.id
  `),

  stats: {
    users: db.prepare("SELECT COUNT(*) AS n FROM users"),
    events: db.prepare("SELECT COUNT(*) AS n FROM events"),
    registrations: db.prepare("SELECT COUNT(*) AS n FROM registrations")
  }
};

/* ==========================================================================
   Helpers
   ========================================================================== */

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Log in to do that" });

  const user = q.userById.get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Log in to do that" });

  /* SQLite has no boolean type — 0 and 1 stand in for false and true. */
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
  if (q.userByEmail.get(cleanEmail)) {
    return res.status(409).json({ error: "That email is already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = q.insertUser.run(
      String(name).trim(),
      cleanEmail,
      passwordHash,
      "attendee"
    );
    req.session.userId = result.lastInsertRowid;
    res.status(201).json(publicUser(q.userById.get(result.lastInsertRowid)));
  } catch (err) {
    /* The UNIQUE constraint fired — two signups raced for the same email.
       The check above misses this; the database does not. */
    res.status(409).json({ error: "That email is already registered" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const user = q.userByEmail.get(String(req.body.email || "").trim().toLowerCase());

  const ok = user && (await bcrypt.compare(req.body.password || "", user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Email or password is incorrect" });
  if (user.isBanned) return res.status(403).json({ error: "Your account is suspended" });

  req.session.userId = user.id;
  res.json(publicUser(user));
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.json(null);
  const user = q.userById.get(req.session.userId);
  res.json(user ? publicUser(user) : null);
});

/* ==========================================================================
   Events
   ========================================================================== */

app.get("/api/events", (req, res) => {
  const rows = q.eventsFiltered.all({
    search: String(req.query.search || "").toLowerCase(),
    category: req.query.category || "all"
  });
  res.json(rows);
});

app.get("/api/events/:id", (req, res) => {
  const event = q.eventById.get(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });
  res.json(event);
});

app.post("/api/events", requireAuth, (req, res) => {
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

  const result = q.insertEvent.run({
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

  q.promoteToHost.run(req.user.id);

  res.status(201).json(q.eventById.get(result.lastInsertRowid));
});

app.delete("/api/events/:id", requireAuth, (req, res) => {
  const event = q.rawEventById.get(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });

  if (event.hostId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "That is not your event" });
  }

  /* ON DELETE CASCADE in the schema removes that event's registrations
     for us, so there are no orphaned rows left behind. */
  q.deleteEvent.run(event.id);
  res.json({ ok: true });
});

app.get("/api/events/:id/registrations", requireAuth, (req, res) => {
  const event = q.rawEventById.get(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });

  if (event.hostId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "That is not your event" });
  }

  res.json(q.attendeesFor.all(event.id));
});

/* ==========================================================================
   Registrations
   ========================================================================== */

/* The seat check and the insert must happen together, with nothing able to
   slip between them. db.transaction wraps them so either both happen or
   neither does — this is what stops two people taking the last seat. */
const bookSeat = db.transaction((event, userId) => {
  const taken = q.confirmedCount.get(event.id).n;
  if (taken >= event.capacity) {
    const err = new Error("This event is sold out");
    err.status = 409;
    throw err;
  }

  const ticketCode = makeTicketCode();
  q.insertRegistration.run(event.id, userId, ticketCode);
  return { eventId: event.id, ticketCode, status: "confirmed" };
});

app.post("/api/events/:id/register", requireAuth, (req, res) => {
  const event = q.rawEventById.get(Number(req.params.id));
  if (!event) return res.status(404).json({ error: "No event with that id" });

  if (new Date(event.startsAt) < new Date()) {
    return res.status(400).json({ error: "That event has already started" });
  }

  try {
    res.status(201).json(bookSeat(event, req.user.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });

    /* The UNIQUE (eventId, userId) constraint rejected a double booking. */
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "You are already registered" });
    }

    console.error(err);
    res.status(500).json({ error: "Could not book that seat" });
  }
});

app.delete("/api/events/:id/register", requireAuth, (req, res) => {
  const result = q.deleteRegistration.run(Number(req.params.id), req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "You are not registered" });
  }
  res.json({ ok: true });
});

app.get("/api/me/registrations", requireAuth, (req, res) => {
  const mine = q.myRegistrations.all(req.user.id).map((reg) => ({
    ...reg,
    event: q.eventById.get(reg.eventId)
  }));
  res.json(mine);
});

app.get("/api/me/events", requireAuth, (req, res) => {
  res.json(q.eventsByHost.all(req.user.id));
});

/* ==========================================================================
   Admin
   ========================================================================== */

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json(q.allUsers.all());
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const user = q.userById.get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "No user with that id" });

  if (user.id === req.user.id) {
    return res.status(400).json({ error: "You cannot change your own account here" });
  }

  const role = ["attendee", "host", "admin"].includes(req.body.role)
    ? req.body.role
    : user.role;

  const isBanned =
    typeof req.body.isBanned === "boolean" ? (req.body.isBanned ? 1 : 0) : user.isBanned;

  q.updateUser.run(role, isBanned, user.id);
  res.json({ ...publicUser(q.userById.get(user.id)), isBanned });
});

app.get("/api/admin/stats", requireAuth, requireAdmin, (req, res) => {
  res.json({
    users: q.stats.users.get().n,
    events: q.stats.events.get().n,
    registrations: q.stats.registrations.get().n
  });
});

app.listen(PORT, () => {
  console.log("Gather running at http://localhost:" + PORT);
  console.log("Admin login: admin@gather.test / admin1234");
});
