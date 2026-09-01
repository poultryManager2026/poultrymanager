const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const db = new Database("poultry.db");

const SECRET = process.env.JWT_SECRET || "poultry-manager-secret-change-this";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =========================
// DATABASE TABLES
// =========================

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT,
  chicks INTEGER DEFAULT 0,
  chick_rate REAL DEFAULT 0,
  sale_rate REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  feed_kg REAL DEFAULT 0,
  dead INTEGER DEFAULT 0,
  weight_kg REAL DEFAULT 0,
  medicine REAL DEFAULT 0,
  other REAL DEFAULT 0,
  notes TEXT,
  user_id INTEGER,
  FOREIGN KEY(batch_id) REFERENCES batches(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// =========================
// DEFAULT OWNER
// =========================

const ownerExists = db
  .prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1")
  .get();

if (!ownerExists) {
  const passwordHash = bcrypt.hashSync("123456", 10);

  db.prepare(`
    INSERT INTO users (name, email, password, role, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "Owner",
    "owner@poultry.local",
    passwordHash,
    "owner",
    1
  );
}

// =========================
// AUTH MIDDLEWARE
// =========================

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Login required"
      });
    }

    const token = header.replace("Bearer ", "");
    req.user = jwt.verify(token, SECRET);

    next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired login"
    });
  }
}

function ownerOnly(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({
      error: "Owner access required"
    });
  }

  next();
}

// =========================
// LOGIN
// =========================

app.post("/api/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password required"
      });
    }

    const user = db
      .prepare(
        "SELECT * FROM users WHERE email = ? AND active = 1"
      )
      .get(email);

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const ok = bcrypt.compareSync(password, user.password);

    if (!ok) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// CURRENT USER
// =========================

app.get("/api/me", auth, (req, res) => {
  res.json(req.user);
});

// =========================
// USERS
// =========================

app.get("/api/users", auth, ownerOnly, (req, res) => {
  const users = db
    .prepare(`
      SELECT id, name, email, role, active
      FROM users
      ORDER BY id DESC
    `)
    .all();

  res.json(users);
});

app.post("/api/users", auth, ownerOnly, (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email and password required"
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const result = db
      .prepare(`
        INSERT INTO users
        (name, email, password, role)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        name,
        email,
        passwordHash,
        role || "worker"
      );

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

app.patch("/api/users/:id", auth, ownerOnly, (req, res) => {
  try {
    const { active, role } = req.body;

    db.prepare(`
      UPDATE users
      SET
        active = COALESCE(?, active),
        role = COALESCE(?, role)
      WHERE id = ?
    `).run(
      active,
      role,
      req.params.id
    );

    res.json({
      success: true
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// =========================
// BATCHES
// =========================

app.get("/api/batches", auth, (req, res) => {
  const batches = db
    .prepare(`
      SELECT *
      FROM batches
      ORDER BY id DESC
    `)
    .all();

  res.json(batches);
});

app.post("/api/batches", auth, (req, res) => {
  try {
    const {
      name,
      start_date,
      chicks,
      chick_rate,
      sale_rate
    } = req.body;

    if (!name) {
      return res.status(400).json({
        error: "Batch name required"
      });
    }

    const result = db
      .prepare(`
        INSERT INTO batches
        (name, start_date, chicks, chick_rate, sale_rate)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        name,
        start_date || "",
        Number(chicks || 0),
        Number(chick_rate || 0),
        Number(sale_rate || 0)
      );

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// =========================
// DAILY DATA
// =========================

app.post("/api/daily", auth, (req, res) => {
  try {
    const {
      batch_id,
      date,
      feed_kg,
      dead,
      weight_kg,
      medicine,
      other,
      notes
    } = req.body;

    if (!batch_id || !date) {
      return res.status(400).json({
        error: "Batch and date required"
      });
    }

    const result = db
      .prepare(`
        INSERT INTO daily
        (
          batch_id,
          date,
          feed_kg,
          dead,
          weight_kg,
          medicine,
          other,
          notes,
          user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(batch_id),
        date,
        Number(feed_kg || 0),
        Number(dead || 0),
        Number(weight_kg || 0),
        Number(medicine || 0),
        Number(other || 0),
        notes || "",
        req.user.id
      );

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

// =========================
// BATCH REPORT
// =========================

app.get("/api/report/:id", auth, (req, res) => {
  try {
    const batch = db
      .prepare("SELECT * FROM batches WHERE id = ?")
      .get(req.params.id);

    if (!batch) {
      return res.status(404).json({
        error: "Batch not found"
      });
    }

    const daily = db
      .prepare(`
        SELECT *
        FROM daily
        WHERE batch_id = ?
        ORDER BY date ASC, id ASC
      `)
      .all(req.params.id);

    const totals = db
      .prepare(`
        SELECT
          COALESCE(SUM(feed_kg), 0) AS total_feed,
          COALESCE(SUM(dead), 0) AS total_dead,
          COALESCE(SUM(weight_kg), 0) AS total_weight,
          COALESCE(SUM(medicine), 0) AS total_medicine,
          COALESCE(SUM(other), 0) AS total_other
        FROM daily
        WHERE batch_id = ?
      `)
      .get(req.params.id);

    const birdsAlive =
      Number(batch.chicks || 0) -
      Number(totals.total_dead || 0);

    const fcr =
      Number(totals.total_weight) > 0
        ? Number(totals.total_feed) /
          Number(totals.total_weight)
        : 0;

    const chickCost =
      Number(batch.chicks || 0) *
      Number(batch.chick_rate || 0);

    const feedCost = 0;

    const totalCost =
      chickCost +
      feedCost +
      Number(totals.total_medicine || 0) +
      Number(totals.total_other || 0);

    const costPerKg =
      Number(totals.total_weight) > 0
        ? totalCost / Number(totals.total_weight)
        : 0;

    const estimatedSale =
      Number(totals.total_weight || 0) *
      Number(batch.sale_rate || 0);

    const estimatedProfit =
      estimatedSale - totalCost;

    res.json({
      batch,
      daily,
      totals,
      birds_alive: birdsAlive,
      fcr: Number(fcr.toFixed(2)),
      total_cost: Number(totalCost.toFixed(2)),
      cost_per_kg: Number(costPerKg.toFixed(2)),
      estimated_sale: Number(estimatedSale.toFixed(2)),
      estimated_profit: Number(estimatedProfit.toFixed(2))
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// HOME
// =========================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// =========================
// SERVER
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Poultry Manager running on port ${PORT}`);
});
