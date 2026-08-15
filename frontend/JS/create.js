/* ==========================================================================
   create.js — the host's form, now saving to the server
   ========================================================================== */

const createForm = document.getElementById("create-form");
const createNotice = document.getElementById("create-notice");
const submitBtn = createForm.querySelector("button[type=submit]");

createForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  const newEvent = {
    title: createForm.title.value.trim(),
    description: createForm.description.value.trim(),
    category: createForm.category.value,
    startsAt: createForm.startsAt.value,
    endsAt: createForm.endsAt.value,
    venue: createForm.venue.value.trim(),
    city: createForm.city.value.trim(),
    price: Number(createForm.price.value),
    capacity: Number(createForm.capacity.value)
  };

  /* Notice there is no "id" and no "registered". The server decides those.
     If the browser could set the id, two people could pick the same one. */

  submitBtn.disabled = true;
  submitBtn.textContent = "Publishing...";

  try {
    const saved = await api("/api/events", postJson(newEvent));

    /* The server sent the finished event back, including its new id,
       so we can go straight to its page. */
    window.location.href = "event.html?id=" + saved.id;
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Publish event";
    createNotice.classList.remove("hidden");
    createNotice.textContent = err.message;
    createNotice.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});
