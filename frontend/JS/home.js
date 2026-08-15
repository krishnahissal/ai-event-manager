/* ==========================================================================
   home.js — the event list, now coming from the server
   ========================================================================== */

const grid = document.getElementById("event-grid");
const searchBox = document.getElementById("search");
const categoryBox = document.getElementById("category");
const countLabel = document.getElementById("result-count");

let searchTimer = null;

/* Fetch everything once, just to learn which categories exist. */
async function fillCategories() {
  try {
    const all = await api("/api/events");
    const seen = [];
    all.forEach(function (e) {
      if (seen.indexOf(e.category) === -1) seen.push(e.category);
    });
    seen.sort().forEach(function (c) {
      const option = document.createElement("option");
      option.value = c;
      option.textContent = c;
      categoryBox.appendChild(option);
    });
  } catch (err) {
    console.error("Could not load categories:", err);
  }
}

async function render() {
  countLabel.textContent = "Loading";

  /* Build "?search=run&category=Sport" safely. URLSearchParams handles
     spaces and symbols so you never have to think about encoding. */
  const params = new URLSearchParams();
  if (searchBox.value.trim() !== "") params.set("search", searchBox.value.trim());
  if (categoryBox.value !== "all") params.set("category", categoryBox.value);

  try {
    const events = await api("/api/events?" + params.toString());

    if (events.length === 0) {
      grid.innerHTML =
        '<div class="empty">' +
        "<h3>Nothing matches that</h3>" +
        '<p class="muted">Try a different word, or clear the category filter.</p>' +
        "</div>";
    } else {
      grid.innerHTML = events.map(ticketCardHtml).join("");
    }

    countLabel.textContent =
      events.length + (events.length === 1 ? " event" : " events");
  } catch (err) {
    /* Say what went wrong and what to do, not just "error". */
    grid.innerHTML =
      '<div class="empty">' +
      "<h3>Could not reach the server</h3>" +
      '<p class="muted">Check that <code>node server.js</code> is still running, ' +
      "then refresh.</p>" +
      "</div>";
    countLabel.textContent = "";
    console.error(err);
  }
}

fillCategories();
render();

/* Wait until typing pauses before asking the server. Without this you
   fire a request per keystroke — five requests to type "music". */
searchBox.addEventListener("input", function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 250);
});

categoryBox.addEventListener("change", render);
