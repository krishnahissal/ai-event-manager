/* ==========================================================================
   event.js — one event, fetched by the ?id= in the address bar,
   with a Join button that actually books a seat.
   ========================================================================== */

const container = document.getElementById("event-detail");

async function loadEvent() {
  const id = getQueryParam("id");

  try {
    const currentEvent = await api("/api/events/" + id);
    draw(currentEvent);
  } catch (err) {
    container.innerHTML =
      '<div class="empty">' +
      "<h3>No such event</h3>" +
      '<p class="muted">' + escapeHtml(err.message) + "</p>" +
      '<p style="margin-top:16px"><a class="btn" href="index.html">Back to all events</a></p>' +
      "</div>";
  }
}

function draw(currentEvent) {
  const date = splitDate(currentEvent.startsAt);
  const ends = splitDate(currentEvent.endsAt);
  const left = seatsLeft(currentEvent);

  document.title = currentEvent.title + " — Gather";

  const paragraphs = currentEvent.description
    .split("\n")
    .filter(function (line) { return line.trim() !== ""; })
    .map(function (line) { return "<p>" + escapeHtml(line.trim()) + "</p>"; })
    .join("");

  container.innerHTML = `
    <div class="poster" style="background:${currentEvent.color}">
      ${escapeHtml(currentEvent.category)} &middot; ${escapeHtml(currentEvent.city)}
    </div>

    <div class="detail-layout">
      <div class="detail-body">
        <p class="eyebrow">${date.full}</p>
        <h1 style="margin-top:8px">${escapeHtml(currentEvent.title)}</h1>
        ${paragraphs}

        <h2 style="margin-top:36px">Hosted by</h2>
        <p class="muted">${escapeHtml(currentEvent.hostName)}</p>
      </div>

      <aside class="panel">
        <dl>
          <dt>Starts</dt>
          <dd>${date.full}, ${date.time}</dd>
          <dt>Ends</dt>
          <dd>${ends.time}</dd>
          <dt>Where</dt>
          <dd>${escapeHtml(currentEvent.venue)}, ${escapeHtml(currentEvent.city)}</dd>
          <dt>Price</dt>
          <dd>${formatPrice(currentEvent.price)}</dd>
          <dt>Seats</dt>
          <dd id="seats-left">${left > 0 ? left + " of " + currentEvent.capacity + " left" : "Sold out"}</dd>
        </dl>

        <button class="btn btn-block" id="join-btn" ${left <= 0 ? "disabled" : ""}>
          ${left > 0 ? "Join this event" : "Sold out"}
        </button>

        <div class="notice hidden" id="join-notice"></div>
      </aside>
    </div>
  `;

  const joinBtn = document.getElementById("join-btn");
  const joinNotice = document.getElementById("join-notice");
  const seatsLabel = document.getElementById("seats-left");

  if (left <= 0) return;

  joinBtn.addEventListener("click", async function () {
    /* Turn the button off immediately. Otherwise an impatient double-click
       sends two requests and books two seats. */
    joinBtn.disabled = true;
    joinBtn.textContent = "Booking...";

    try {
      const registration = await api(
        "/api/events/" + currentEvent.id + "/register",
        postJson({})
      );

      joinBtn.textContent = "You're in";
      joinNotice.classList.remove("hidden");
      joinNotice.innerHTML =
        "<strong>Booked.</strong> Your ticket code is " +
        '<span class="tag">' + registration.ticketCode + "</span>. " +
        "It's on your dashboard too.";

      /* Update the seat count without reloading the whole page. */
      currentEvent.registered++;
      const nowLeft = seatsLeft(currentEvent);
      seatsLabel.textContent =
        nowLeft > 0 ? nowLeft + " of " + currentEvent.capacity + " left" : "Sold out";
    } catch (err) {
      /* The server refused. Show its reason and let them try again. */
      joinBtn.disabled = false;
      joinBtn.textContent = "Join this event";
      joinNotice.classList.remove("hidden");
      joinNotice.textContent = err.message;
    }
  });
}

loadEvent();
