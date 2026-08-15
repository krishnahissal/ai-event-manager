/* ==========================================================================
   main.js — helpers shared by every page.
   ========================================================================== */

/* Every request to your own API goes through here.

   fetch() only rejects when the network itself fails. A 404 or a 500 is
   still a "successful" fetch as far as the browser is concerned, so you
   have to check response.ok yourself. Doing it once, here, means no page
   has to remember to. */
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

/* Send an object to the server as JSON. */
function postJson(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

/* Turn "2026-08-23T06:00" into the pieces the ticket stub needs. */
function splitDate(isoString) {
  const d = new Date(isoString);
  return {
    day: d.getDate(),
    month: d.toLocaleDateString("en-IN", { month: "short" }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    full: d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    })
  };
}

function formatPrice(price) {
  return price === 0 ? "Free" : "\u20B9" + price;
}

function seatsLeft(event) {
  return event.capacity - event.registered;
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* Escape anything that came from a form before putting it in the page. */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ==========================================================================
   Who is logged in

   The page cannot read the login cookie — it is httpOnly on purpose. So we
   ask the server instead. Every page calls this on load and redraws the nav
   from the answer. Nothing here is a security check: hiding a link stops
   nobody. The real checks are the ones on the server routes.
   ========================================================================== */

let ME = null;

async function loadMe() {
  try {
    ME = await api("/api/auth/me");
  } catch (err) {
    ME = null;
  }
  drawNav();
  return ME;
}

function drawNav() {
  const nav = document.querySelector(".site-nav");
  if (!nav) return;

  const page = window.location.pathname.split("/").pop() || "index.html";
  const link = (href, label) =>
    `<a href="${href}"${page === href ? ' class="active"' : ""}>${label}</a>`;

  if (!ME) {
    nav.innerHTML =
      link("index.html", "Browse") +
      link("login.html", "Log in") +
      '<a class="btn" href="register.html">Sign up</a>';
    return;
  }

  nav.innerHTML =
    link("index.html", "Browse") +
    link("create-event.html", "Host an event") +
    link("dashboard.html", "Dashboard") +
    (ME.role === "admin" ? link("admin.html", "Admin") : "") +
    `<span class="muted" style="font-size:0.85rem">${escapeHtml(ME.name)}</span>` +
    '<a class="btn btn-ghost" href="#" id="logout-link">Log out</a>';

  document.getElementById("logout-link").addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/api/auth/logout", postJson({}));
    window.location.href = "index.html";
  });
}

/* Send anyone who is not logged in to the login page, remembering where
   they were headed so we can bounce them back afterwards. */
async function requireLogin() {
  const me = await loadMe();
  if (!me) {
    const here = window.location.pathname.split("/").pop();
    window.location.href = "login.html?next=" + encodeURIComponent(here);
    return null;
  }
  return me;
}

function ticketCardHtml(event) {
  const date = splitDate(event.startsAt);
  const left = seatsLeft(event);

  let statusTag = "";
  if (left <= 0) {
    statusTag = '<span class="tag tag-full">Sold out</span>';
  } else if (event.price === 0) {
    statusTag = '<span class="tag tag-free">Free</span>';
  }

  return `
    <a class="ticket" data-category="${escapeHtml(event.category)}"
       href="event.html?id=${event.id}">
      <div class="ticket-stub">
        <div class="day">${date.day}</div>
        <div class="month">${date.month}</div>
        <div class="time">${date.time}</div>
      </div>
      <div class="ticket-body">
        <h3>${escapeHtml(event.title)}</h3>
        <p class="muted" style="font-size:0.9rem">${escapeHtml(event.venue)}</p>
        <div class="ticket-meta">
          <span class="tag">${escapeHtml(event.category)}</span>
          ${statusTag}
          <span>${formatPrice(event.price)}</span>
          <span>&middot;</span>
          <span>${left > 0 ? left + " seats left" : "no seats left"}</span>
        </div>
      </div>
    </a>
  `;
}

/* ==========================================================================
   Header on scroll

   The header is transparent over the top of the page and grows a border and
   a shadow once there is content behind it. Doing this in CSS alone is not
   possible, but it is three lines here.

   passive: true tells the browser we will never call preventDefault, so it
   can keep scrolling smoothly instead of waiting on this handler.
   ========================================================================== */

(function watchScroll() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const sync = () => header.classList.toggle("scrolled", window.scrollY > 8);

  sync();
  window.addEventListener("scroll", sync, { passive: true });
})();
