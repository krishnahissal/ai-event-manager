/* ==========================================================================
   auth.js — login and signup, for real this time
   ========================================================================== */

const authForm = document.getElementById("auth-form");
const authNotice = document.getElementById("auth-notice");
const authMode = authForm.dataset.mode; /* "login" or "register" */
const authBtn = authForm.querySelector("button[type=submit]");

/* If you were sent here from a page that needs a login, go back to it. */
const nextPage = getQueryParam("next") || "dashboard.html";

/* Already logged in? Nothing to do here. */
loadMe().then((me) => {
  if (me) window.location.href = nextPage;
});

authForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  const body = {
    email: authForm.email.value.trim(),
    password: authForm.password.value
  };

  if (authMode === "register") {
    body.name = authForm.name.value.trim();

    /* Checked here so you get told instantly, and checked again on the
       server because this check can be bypassed. */
    if (body.password !== authForm.confirm.value) {
      return show("Those two passwords do not match.");
    }
    if (body.password.length < 8) {
      return show("Use at least 8 characters for the password.");
    }
  }

  authBtn.disabled = true;
  authBtn.textContent = authMode === "register" ? "Creating..." : "Logging in...";

  try {
    const endpoint =
      authMode === "register" ? "/api/auth/register" : "/api/auth/login";

    await api(endpoint, postJson(body));

    /* The server set a cookie on that response. The browser will now send
       it automatically with every request from here on — you never touch it. */
    window.location.href = nextPage;
  } catch (err) {
    authBtn.disabled = false;
    authBtn.textContent = authMode === "register" ? "Create account" : "Log in";
    show(err.message);
  }
});

function show(message) {
  authNotice.classList.remove("hidden");
  authNotice.textContent = message;
}
