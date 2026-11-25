function readCookie(name) {
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { "x-csrf-token": readCookie("csrf_token") } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function showMessage(message, isError = false, selector = "#form-message") {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("message-error", isError);
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.querySelector("#register-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await apiRequest("/api/auth/register", { method: "POST", body: formValues(form) });
    form.reset();
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await apiRequest("/api/auth/login", { method: "POST", body: formValues(event.currentTarget) });
    window.location.assign("/dashboard");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#forgot-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await apiRequest("/api/auth/forgot-password", {
      method: "POST",
      body: formValues(event.currentTarget),
    });
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#resend-verification-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await apiRequest("/api/auth/resend-verification", {
      method: "POST",
      body: formValues(event.currentTarget),
    });
    showMessage(result.message, false, "#resend-message");
  } catch (error) {
    showMessage(error.message, true, "#resend-message");
  }
});

document.querySelector("#reset-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) {
    showMessage("This password reset link is invalid or expired.", true);
    return;
  }
  try {
    const result = await apiRequest("/api/auth/reset-password", {
      method: "POST",
      body: { ...formValues(event.currentTarget), token },
    });
    event.currentTarget.reset();
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, true);
  }
});

if (window.location.pathname === "/verify-email") {
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) {
    showMessage("This verification link is invalid or expired.", true);
  } else {
    apiRequest("/api/auth/verify-email", { method: "POST", body: { token } })
      .then((result) => showMessage(result.message))
      .catch((error) => showMessage(error.message, true));
  }
}

if (window.location.pathname === "/dashboard") {
  apiRequest("/api/auth/me")
    .then(({ user }) => {
      document.querySelector("#welcome-name").textContent = user.name;
      document.querySelector("#account-name").textContent = user.email;
      if (!user.emailVerified) {
        showMessage("Verify your email to use account features.", true, "#account-message");
      }
    })
    .catch((error) => {
      if (error.message === "Authentication required") {
        window.location.assign("/login");
      } else {
        showMessage(error.message, true, "#account-message");
      }
    });

  document.querySelector("#logout-button")?.addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      window.location.assign("/login");
    } catch (error) {
      showMessage(error.message, true, "#account-message");
    }
  });
}
