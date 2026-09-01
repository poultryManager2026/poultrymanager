let token = localStorage.getItem("pm");
let me = null;
let batches = [];

const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    Authorization: "Bearer " + token,
    "Content-Type": "application/json"
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

// =====================================================
// LOGIN
// =====================================================

async function login() {
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: $("email").value,
        password: $("password").value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    token = data.token;

    localStorage.setItem("pm", token);

    await init();

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// LOGOUT
// =====================================================

function logout() {
  localStorage.removeItem("pm");
  location.reload();
}

// =====================================================
// INITIALIZE APP
// =====================================================

async function init() {
  try {
    me = await api("/api/me");

    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");

    $("role").textContent = me.role.toUpperCase();

    if (me.role !== "owner") {
      if ($("usersBtn")) {
        $("usersBtn").classList.add("hidden");
      }
    }

    await load();

    show("dashboard");

  } catch (error) {
    logout();
  }
}

// =====================================================
// PAGE NAVIGATION
// =====================================================

function show(id) {
  document
    .querySelectorAll("main section")
    .forEach(section => {
      section.classList.add("hidden");
    });

  const section = $(id);

  if (section) {
    section.classList.remove("hidden");
  }

  if (id === "users") {
    users();
  }

  if (id === "batches") {
    listBatches();
  }

  if (id === "dashboard" && batches.length) {
    report(batches[0].id);
  }
}

// =====================================================
// LOAD BATCHES
// =====================================================

async function load() {
  try {
    batches = await api("/api/batches");

    const options = batches
      .map(batch =>
        `<option value="${batch.id}">
          ${batch.name}
        </option>`
      )
      .join("");

    if ($("dashBatch")) {
      $("dashBatch").innerHTML = options;
    }

    if ($("dBatch")) {
      $("dBatch").innerHTML = options;
    }

    if (batches.length) {
      await report(batches[0].id);
    }

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// DASHBOARD REPORT
// =====================================================

async function report(id) {
  if (!id) return;

  try {
    const r = await api("/api/report/" + id);

    const stats = [
      [
        "Live Birds",
        r.birds_alive
      ],
      [
        "Feed",
        Number(r.totals.total_feed || 0).toFixed(1) + " kg"
      ],
      [
        "Weight",
        Number(r.totals.total_weight || 0).toFixed(1) + " kg"
      ],
      [
        "FCR",
        Number(r.fcr || 0).toFixed(2)
      ],
      [
        "Cost / Kg",
        "₹" + Number(r.cost_per_kg || 0).toFixed(2)
      ],
      [
        "Total Cost",
        "₹" + Number(r.total_cost || 0).toFixed(0)
      ],
      [
        "Sale Value",
        "₹" + Number(r.sales.total_sale || 0).toFixed(0)
      ],
      [
        "Profit",
        "₹" + Number(r.profit || 0).toFixed(0)
      ]
    ];

    $("stats").innerHTML = stats
      .map(item => `
        <div class="stat">
          ${item[0]}
          <b>${item[1]}</b>
        </div>
      `)
      .join("");

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// DASHBOARD BATCH CHANGE
// =====================================================

function dashboardBatchChange() {
  const id = $("dashBatch").value;

  if (id) {
    report(id);
  }
}

// =====================================================
// DAILY ENTRY
// =====================================================

async function daily(event) {
  event.preventDefault();

  try {
    await api("/api/daily", {
      method: "POST",
      body: JSON.stringify({
        batch_id: Number($("dBatch").value),
        date: $("date").value,
        dead: Number($("dead").value || 0),
        weight_kg: Number($("weight").value || 0),
        medicine: Number($("med").value || 0),
        other: Number($("other").value || 0),
        notes: $("notes").value
      })
    });

    alert("Daily entry saved successfully ✅");

    event.target.reset();

    if ($("date")) {
      $("date").value =
        new Date().toISOString().slice(0, 10);
    }

    await load();

    show("dashboard");

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// CREATE BATCH
// =====================================================

async function batch(event) {
  event.preventDefault();

  try {
    await api("/api/batches", {
      method: "POST",
      body: JSON.stringify({
        name: $("bn").value,
        start_date: $("bd").value,
        chicks: Number($("bc").value || 0),
        chick_rate: Number($("br").value || 0),
        sale_rate: Number($("sr").value || 0)
      })
    });

    alert("Batch created successfully ✅");

    event.target.reset();

    await load();

    show("dashboard");

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// BATCH LIST
// =====================================================

function listBatches() {
  if (!$("bl")) return;

  if (!batches.length) {
    $("bl").innerHTML =
      `<div class="row">No batches found</div>`;
    return;
  }

  $("bl").innerHTML = batches
    .map(batch => `
      <div class="row">
        <div>
          <b>${escapeHtml(batch.name)}</b>
          <br>
          <small>
            ${batch.chicks} chicks •
            ${batch.start_date || "No date"}
          </small>
        </div>

        <span>
          ${batch.status === "completed"
            ? "Completed"
            : "Active"}
        </span>
      </div>
    `)
    .join("");
}

// =====================================================
// USERS
// =====================================================

async function users() {
  if (!me || me.role !== "owner") return;

  try {
    const list = await api("/api/users");

    if (!$("ul")) return;

    $("ul").innerHTML = list
      .map(user => `
        <div class="row">
          <span>
            <b>${escapeHtml(user.name)}</b>
            <br>
            ${escapeHtml(user.email)}
          </span>

          <span>
            ${user.role}
            •
            ${user.active ? "Active" : "Off"}
          </span>
        </div>
      `)
      .join("");

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// ADD USER
// =====================================================

async function user(event) {
  event.preventDefault();

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name: $("un").value,
        email: $("ue").value,
        password: $("up").value,
        role: $("ur").value
      })
    });

    alert("User added successfully ✅");

    event.target.reset();

    await users();

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// CLOSE BATCH
// =====================================================

async function closeBatch(id) {
  if (!confirm("Are you sure you want to close this batch?")) {
    return;
  }

  try {
    await api("/api/batches/" + id + "/close", {
      method: "PATCH"
    });

    alert("Batch closed successfully ✅");

    await load();

    listBatches();

  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// HTML SAFETY
// =====================================================

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =====================================================
// SET TODAY DATE
// =====================================================

if ($("date")) {
  $("date").value =
    new Date().toISOString().slice(0, 10);
}

// =====================================================
// START APP
// =====================================================

if (token) {
  init();
}
