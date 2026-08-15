/* ==========================================================================
   admin.js — the admin panel

   This page hides itself from non-admins, but that is only politeness.
   Anyone can type admin.html into the address bar. What actually protects
   the data is requireAdmin on every /api/admin route — the page would load
   and every table would come back empty with a 403.
   ========================================================================== */

const statsRow = document.getElementById("stats");
const usersBody = document.getElementById("users-body");
const eventsBody = document.getElementById("admin-events-body");

async function start() {
  const me = await requireLogin();
  if (!me) return;

  if (me.role !== "admin") {
    document.querySelector("main").innerHTML =
      '<div class="wrap"><div class="empty">' +
      "<h3>Admins only</h3>" +
      '<p class="muted">Your account does not have access to this page.</p>' +
      '<p style="margin-top:16px"><a class="btn" href="index.html">Back to events</a></p>' +
      "</div></div>";
    return;
  }

  loadStats();
  loadUsers();
  loadEvents();
}

async function loadStats() {
  try {
    const stats = await api("/api/admin/stats");
    statsRow.innerHTML = [
      ["Users", stats.users],
      ["Events", stats.events],
      ["Registrations", stats.registrations]
    ]
      .map(
        ([label, value]) => `
          <div class="panel" style="flex:1">
            <p class="eyebrow">${label}</p>
            <p style="font-family:var(--mono);font-size:2rem;font-weight:700">${value}</p>
          </div>
        `
      )
      .join("");
  } catch (err) {
    statsRow.innerHTML = '<p class="muted">Could not load stats.</p>';
  }
}

async function loadUsers() {
  try {
    const users = await api("/api/admin/users");

    usersBody.innerHTML = users
      .map(
        (u) => `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td class="muted">${escapeHtml(u.email)}</td>
          <td><span class="tag">${escapeHtml(u.role)}</span></td>
          <td>${u.isBanned ? '<span class="tag tag-full">Banned</span>' : "Active"}</td>
          <td>
            <button class="btn btn-ghost" data-ban="${u.id}" data-banned="${u.isBanned}">
              ${u.isBanned ? "Unban" : "Ban"}
            </button>
          </td>
        </tr>
      `
      )
      .join("");
  } catch (err) {
    usersBody.innerHTML = '<tr><td colspan="5" class="muted">' + err.message + "</td></tr>";
  }
}

async function loadEvents() {
  try {
    const events = await api("/api/events");

    eventsBody.innerHTML = events
      .map((e) => {
        const date = splitDate(e.startsAt);
        return `
          <tr>
            <td><a href="event.html?id=${e.id}">${escapeHtml(e.title)}</a></td>
            <td>${escapeHtml(e.hostName)}</td>
            <td>${date.full}</td>
            <td>${e.registered} of ${e.capacity}</td>
            <td><button class="btn btn-ghost" data-delete="${e.id}">Delete</button></td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    eventsBody.innerHTML = '<tr><td colspan="5" class="muted">' + err.message + "</td></tr>";
  }
}

document.addEventListener("click", async function (e) {
  const banId = e.target.dataset && e.target.dataset.ban;
  const deleteId = e.target.dataset && e.target.dataset.delete;

  if (banId) {
    const currentlyBanned = e.target.dataset.banned === "true";
    try {
      await api("/api/admin/users/" + banId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBanned: !currentlyBanned })
      });
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  if (deleteId) {
    if (!confirm("Delete this event and everyone's bookings for it?")) return;
    try {
      await api("/api/events/" + deleteId, { method: "DELETE" });
      loadEvents();
      loadStats();
    } catch (err) {
      alert(err.message);
    }
  }
});

start();
