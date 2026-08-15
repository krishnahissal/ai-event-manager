/* ==========================================================================
   dashboard.js — your bookings and your events, and nobody else's
   ========================================================================== */

const ticketsBody = document.getElementById("tickets-body");
const hostedBody = document.getElementById("hosted-body");

async function start() {
  const me = await requireLogin();
  if (!me) return; /* requireLogin already redirected */

  loadTickets();
  loadHosted();
}

async function loadTickets() {
  try {
    const registrations = await api("/api/me/registrations");

    if (registrations.length === 0) {
      ticketsBody.innerHTML =
        '<tr><td colspan="5" class="muted">Nothing booked yet. ' +
        '<a href="index.html">Find something</a>.</td></tr>';
      return;
    }

    ticketsBody.innerHTML = registrations
      .map(function (reg) {
        if (!reg.event) return "";
        const date = splitDate(reg.event.startsAt);
        return `
          <tr>
            <td><a href="event.html?id=${reg.event.id}">${escapeHtml(reg.event.title)}</a></td>
            <td>${date.full}, ${date.time}</td>
            <td><span class="tag">${escapeHtml(reg.ticketCode)}</span></td>
            <td>${escapeHtml(reg.status)}</td>
            <td><button class="btn btn-ghost" data-cancel="${reg.event.id}">Cancel</button></td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    ticketsBody.innerHTML =
      '<tr><td colspan="5" class="muted">Could not load your tickets.</td></tr>';
    console.error(err);
  }
}

async function loadHosted() {
  try {
    const mine = await api("/api/me/events");

    if (mine.length === 0) {
      hostedBody.innerHTML =
        '<tr><td colspan="5" class="muted">You are not hosting anything yet. ' +
        '<a href="create-event.html">Put one up</a>.</td></tr>';
      return;
    }

    hostedBody.innerHTML = mine
      .map(function (event) {
        const date = splitDate(event.startsAt);
        return `
          <tr>
            <td><a href="event.html?id=${event.id}">${escapeHtml(event.title)}</a></td>
            <td>${date.full}</td>
            <td>${event.registered} of ${event.capacity}</td>
            <td>${seatsLeft(event) > 0 ? "Open" : "Sold out"}</td>
            <td>
              <button class="btn btn-ghost" data-attendees="${event.id}">Who's coming</button>
            </td>
          </tr>
          <tr id="attendees-${event.id}" style="display:none">
            <td colspan="5"></td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    hostedBody.innerHTML =
      '<tr><td colspan="5" class="muted">Could not load your events.</td></tr>';
    console.error(err);
  }
}

/* One listener on the page instead of one per button. The rows are built
   after this runs, so attaching to each button directly would miss them. */
document.addEventListener("click", async function (e) {
  const cancelId = e.target.dataset && e.target.dataset.cancel;
  const attendeesId = e.target.dataset && e.target.dataset.attendees;

  if (cancelId) {
    if (!confirm("Give up your seat for this event?")) return;
    try {
      await api("/api/events/" + cancelId + "/register", { method: "DELETE" });
      loadTickets();
      loadHosted();
    } catch (err) {
      alert(err.message);
    }
  }

  if (attendeesId) {
    const row = document.getElementById("attendees-" + attendeesId);
    const cell = row.querySelector("td");

    if (row.style.display !== "none") {
      row.style.display = "none";
      return;
    }

    row.style.display = "";
    cell.textContent = "Loading...";

    try {
      const list = await api("/api/events/" + attendeesId + "/registrations");
      if (list.length === 0) {
        cell.innerHTML = '<span class="muted">Nobody has signed up yet.</span>';
        return;
      }
      cell.innerHTML =
        '<ul style="margin:0;padding-left:18px">' +
        list
          .map(
            (a) =>
              "<li>" +
              escapeHtml(a.name) +
              ' <span class="muted">' +
              escapeHtml(a.email) +
              '</span> <span class="tag">' +
              escapeHtml(a.ticketCode) +
              "</span></li>"
          )
          .join("") +
        "</ul>";
    } catch (err) {
      cell.textContent = err.message;
    }
  }
});

start();
