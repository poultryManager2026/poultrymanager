const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const db = new Database("poultry.db");

const SECRET =
  process.env.JWT_SECRET ||
  "poultry-manager-secret-change-this";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

db.pragma("foreign_keys = ON");

// =====================================================
// DATABASE
// =====================================================

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
  sale_rate REAL DEFAULT 0,
  status TEXT DEFAULT 'active'
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

CREATE TABLE IF NOT EXISTS feed_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_name TEXT NOT NULL UNIQUE,
  bags REAL DEFAULT 0,
  price_per_bag REAL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feed_purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_name TEXT NOT NULL,
  date TEXT NOT NULL,
  bags REAL NOT NULL DEFAULT 0,
  price_per_bag REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  supplier TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  user_id INTEGER
);

CREATE TABLE IF NOT EXISTS feed_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  feed_name TEXT NOT NULL,
  bags REAL NOT NULL DEFAULT 0,
  kg REAL NOT NULL DEFAULT 0,
  price_per_bag REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  user_id INTEGER,
  FOREIGN KEY(batch_id) REFERENCES batches(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  party_name TEXT NOT NULL,
  vehicle_no TEXT DEFAULT '',
  rate_per_kg REAL NOT NULL DEFAULT 0,
  kg REAL NOT NULL DEFAULT 0,
  nang INTEGER NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  user_id INTEGER,
  FOREIGN KEY(batch_id) REFERENCES batches(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// =====================================================
// SAFE MIGRATION
// =====================================================

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(
    `PRAGMA table_info(${table})`
  ).all();

  const exists = columns.some(
    (c) => c.name === column
  );

  if (!exists) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

try {
  addColumnIfMissing(
    "batches",
    "status",
    "TEXT DEFAULT 'active'"
  );

  addColumnIfMissing(
    "daily",
    "feed_kg",
    "REAL DEFAULT 0"
  );

} catch (e) {
  console.log("Migration:", e.message);
}

// =====================================================
// INITIAL FEED TYPES
// =====================================================

const feedTypes = [
  "Pre-Starter",
  "Starter",
  "Finisher"
];

for (const feedName of feedTypes) {
  db.prepare(`
    INSERT OR IGNORE INTO feed_stock
    (feed_name, bags, price_per_bag)
    VALUES (?, 0, 0)
  `).run(feedName);
}

// =====================================================
// DEFAULT OWNER
// =====================================================

const ownerExists = db
  .prepare(`
    SELECT id
    FROM users
    WHERE role = 'owner'
    LIMIT 1
  `)
  .get();

if (!ownerExists) {
  const passwordHash =
    bcrypt.hashSync("123456", 10);

  db.prepare(`
    INSERT INTO users
    (name, email, password, role, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "Owner",
    "owner@poultry.local",
    passwordHash,
    "owner",
    1
  );
}

// =====================================================
// AUTH
// =====================================================

function auth(req, res, next) {
  try {
    const header =
      req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Login required"
      });
    }

    const token =
      header.replace("Bearer ", "");

    req.user =
      jwt.verify(token, SECRET);

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

// =====================================================
// LOGIN
// =====================================================

app.post("/api/login", (req, res) => {
  try {
    const email =
      String(req.body.email || "")
        .trim()
        .toLowerCase();

    const password =
      String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password required"
      });
    }

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE LOWER(email) = ?
      AND active = 1
    `).get(email);

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const ok =
      bcrypt.compareSync(
        password,
        user.password
      );

    if (!ok) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const token =
      jwt.sign(
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

// =====================================================
// CURRENT USER
// =====================================================

app.get("/api/me", auth, (req, res) => {
  res.json(req.user);
});

// =====================================================
// USERS
// =====================================================

app.get(
  "/api/users",
  auth,
  ownerOnly,
  (req, res) => {

    const users = db.prepare(`
      SELECT id, name, email, role, active
      FROM users
      ORDER BY id DESC
    `).all();

    res.json(users);
  }
);

app.post(
  "/api/users",
  auth,
  ownerOnly,
  (req, res) => {

    try {
      const name =
        String(req.body.name || "").trim();

      const email =
        String(req.body.email || "")
          .trim()
          .toLowerCase();

      const password =
        String(req.body.password || "");

      const role =
        req.body.role || "worker";

      if (!name || !email || !password) {
        return res.status(400).json({
          error:
            "Name, email and password required"
        });
      }

      const passwordHash =
        bcrypt.hashSync(password, 10);

      const result =
        db.prepare(`
          INSERT INTO users
          (name, email, password, role, active)
          VALUES (?, ?, ?, ?, 1)
        `).run(
          name,
          email,
          passwordHash,
          role
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
  }
);

app.patch(
  "/api/users/:id",
  auth,
  ownerOnly,
  (req, res) => {

    try {
      const active =
        req.body.active === undefined
          ? null
          : Number(req.body.active);

      const role =
        req.body.role === undefined
          ? null
          : req.body.role;

      db.prepare(`
        UPDATE users
        SET
          active = COALESCE(?, active),
          role = COALESCE(?, role)
        WHERE id = ?
      `).run(
        active,
        role,
        Number(req.params.id)
      );

      res.json({
        success: true
      });

    } catch (err) {
      res.status(400).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// BATCHES
// =====================================================

app.get(
  "/api/batches",
  auth,
  (req, res) => {

    const batches = db.prepare(`
      SELECT *
      FROM batches
      ORDER BY id DESC
    `).all();

    res.json(batches);
  }
);

app.post(
  "/api/batches",
  auth,
  (req, res) => {

    try {
      const name =
        String(req.body.name || "").trim();

      const startDate =
        req.body.start_date || "";

      const chicks =
        Number(req.body.chicks || 0);

      const chickRate =
        Number(req.body.chick_rate || 0);

      const saleRate =
        Number(req.body.sale_rate || 0);

      if (!name) {
        return res.status(400).json({
          error: "Batch name required"
        });
      }

      const result =
        db.prepare(`
          INSERT INTO batches
          (
            name,
            start_date,
            chicks,
            chick_rate,
            sale_rate,
            status
          )
          VALUES (?, ?, ?, ?, ?, 'active')
        `).run(
          name,
          startDate,
          chicks,
          chickRate,
          saleRate
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
  }
);

// =====================================================
// DAILY ENTRY - CREATE
// =====================================================

app.post(
  "/api/daily",
  auth,
  (req, res) => {

    try {
      const batchId =
        Number(req.body.batch_id || 0);

      const date =
        String(req.body.date || "").trim();

      const feedKg =
        Number(req.body.feed_kg || 0);

      const dead =
        Number(req.body.dead || 0);

      const weightKg =
        Number(req.body.weight_kg || 0);

      const medicine =
        Number(req.body.medicine || 0);

      const other =
        Number(req.body.other || 0);

      const notes =
        String(req.body.notes || "");

      if (!batchId || !date) {
        return res.status(400).json({
          error:
            "Batch and date required"
        });
      }

      if (
        feedKg < 0 ||
        dead < 0 ||
        weightKg < 0 ||
        medicine < 0 ||
        other < 0
      ) {
        return res.status(400).json({
          error:
            "Values cannot be negative"
        });
      }

      const result =
        db.prepare(`
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
        `).run(
          batchId,
          date,
          feedKg,
          dead,
          weightKg,
          medicine,
          other,
          notes,
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
  }
);

// =====================================================
// DAILY ENTRY - LIST ALL
// =====================================================

app.get(
  "/api/daily",
  auth,
  (req, res) => {

    try {
      const rows =
        db.prepare(`
          SELECT
            daily.*,
            batches.name AS batch_name
          FROM daily
          LEFT JOIN batches
            ON batches.id = daily.batch_id
          ORDER BY
            daily.date DESC,
            daily.id DESC
        `).all();

      res.json(rows);

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// DAILY ENTRY - LIST BY BATCH
// =====================================================

app.get(
  "/api/daily/:batchId",
  auth,
  (req, res) => {

    try {
      const rows =
        db.prepare(`
          SELECT
            daily.*,
            batches.name AS batch_name
          FROM daily
          LEFT JOIN batches
            ON batches.id = daily.batch_id
          WHERE daily.batch_id = ?
          ORDER BY
            daily.date DESC,
            daily.id DESC
        `).all(
          Number(req.params.batchId)
        );

      res.json(rows);

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// DAILY ENTRY - GET ONE
// =====================================================

app.get(
  "/api/daily-entry/:id",
  auth,
  (req, res) => {

    try {
      const row =
        db.prepare(`
          SELECT
            daily.*,
            batches.name AS batch_name
          FROM daily
          LEFT JOIN batches
            ON batches.id = daily.batch_id
          WHERE daily.id = ?
        `).get(
          Number(req.params.id)
        );

      if (!row) {
        return res.status(404).json({
          error: "Daily entry not found"
        });
      }

      res.json(row);

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// DAILY ENTRY - EDIT / UPDATE
// =====================================================

app.patch(
  "/api/daily/:id",
  auth,
  (req, res) => {

    try {
      const id =
        Number(req.params.id);

      const existing =
        db.prepare(`
          SELECT *
          FROM daily
          WHERE id = ?
        `).get(id);

      if (!existing) {
        return res.status(404).json({
          error: "Daily entry not found"
        });
      }

      const batchId =
        req.body.batch_id === undefined
          ? existing.batch_id
          : Number(req.body.batch_id);

      const date =
        req.body.date === undefined
          ? existing.date
          : String(req.body.date).trim();

      const feedKg =
        req.body.feed_kg === undefined
          ? existing.feed_kg
          : Number(req.body.feed_kg);

      const dead =
        req.body.dead === undefined
          ? existing.dead
          : Number(req.body.dead);

      const weightKg =
        req.body.weight_kg === undefined
          ? existing.weight_kg
          : Number(req.body.weight_kg);

      const medicine =
        req.body.medicine === undefined
          ? existing.medicine
          : Number(req.body.medicine);

      const other =
        req.body.other === undefined
          ? existing.other
          : Number(req.body.other);

      const notes =
        req.body.notes === undefined
          ? existing.notes
          : String(req.body.notes);

      if (!batchId || !date) {
        return res.status(400).json({
          error:
            "Batch and date required"
        });
      }

      if (
        feedKg < 0 ||
        dead < 0 ||
        weightKg < 0 ||
        medicine < 0 ||
        other < 0
      ) {
        return res.status(400).json({
          error:
            "Values cannot be negative"
        });
      }

      db.prepare(`
        UPDATE daily
        SET
          batch_id = ?,
          date = ?,
          feed_kg = ?,
          dead = ?,
          weight_kg = ?,
          medicine = ?,
          other = ?,
          notes = ?
        WHERE id = ?
      `).run(
        batchId,
        date,
        feedKg,
        dead,
        weightKg,
        medicine,
        other,
        notes,
        id
      );

      res.json({
        success: true,
        message:
          "Daily entry updated successfully"
      });

    } catch (err) {
      res.status(400).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// FEED STOCK
// 1 BAG = 50 KG
// =====================================================

app.get(
  "/api/feed-stock",
  auth,
  (req, res) => {

    const stock =
      db.prepare(`
        SELECT
          feed_name,
          bags,
          bags * 50 AS kg,
          price_per_bag,
          bags * price_per_bag AS stock_value
        FROM feed_stock
        ORDER BY id ASC
      `).all();

    res.json(stock);
  }
);

// =====================================================
// FEED PURCHASE
// =====================================================

app.post(
  "/api/feed-purchase",
  auth,
  (req, res) => {

    try {
      const feedName =
        String(
          req.body.feed_name || ""
        ).trim();

      const date =
        String(
          req.body.date || ""
        ).trim();

      const bags =
        Number(req.body.bags || 0);

      const price =
        Number(
          req.body.price_per_bag || 0
        );

      const supplier =
        String(
          req.body.supplier || ""
        );

      const notes =
        String(
          req.body.notes || ""
        );

      if (
        !feedName ||
        !date ||
        bags <= 0
      ) {
        return res.status(400).json({
          error:
            "Feed, date and bags are required"
        });
      }

      const total =
        bags * price;

      const transaction =
        db.transaction(() => {

          db.prepare(`
            INSERT INTO feed_purchase
            (
              feed_name,
              date,
              bags,
              price_per_bag,
              total_amount,
              supplier,
              notes,
              user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            feedName,
            date,
            bags,
            price,
            total,
            supplier,
            notes,
            req.user.id
          );

          db.prepare(`
            INSERT INTO feed_stock
            (
              feed_name,
              bags,
              price_per_bag
            )
            VALUES (?, ?, ?)

            ON CONFLICT(feed_name)
            DO UPDATE SET
              bags =
                feed_stock.bags
                + excluded.bags,

              price_per_bag =
                excluded.price_per_bag,

              updated_at =
                CURRENT_TIMESTAMP
          `).run(
            feedName,
            bags,
            price
          );
        });

      transaction();

      res.json({
        success: true,
        bags,
        kg: bags * 50,
        total
      });

    } catch (err) {
      res.status(400).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// FEED USAGE
// =====================================================

app.post(
  "/api/feed-usage",
  auth,
  (req, res) => {

    try {
      const batchId =
        Number(req.body.batch_id || 0);

      const date =
        String(
          req.body.date || ""
        ).trim();

      const feedName =
        String(
          req.body.feed_name || ""
        ).trim();

      const bags =
        Number(req.body.bags || 0);

      if (
        !batchId ||
        !date ||
        !feedName ||
        bags <= 0
      ) {
        return res.status(400).json({
          error:
            "Batch, date, feed and bags are required"
        });
      }

      const stock =
        db.prepare(`
          SELECT *
          FROM feed_stock
          WHERE feed_name = ?
        `).get(feedName);

      if (!stock) {
        return res.status(400).json({
          error:
            "Feed type not found"
        });
      }

      if (
        Number(stock.bags) < bags
      ) {
        return res.status(400).json({
          error:
            `Insufficient ${feedName} stock. ` +
            `Available: ${stock.bags} bags`
        });
      }

      const kg =
        bags * 50;

      const price =
        Number(
          stock.price_per_bag || 0
        );

      const totalCost =
        bags * price;

      const transaction =
        db.transaction(() => {

          db.prepare(`
            INSERT INTO feed_usage
            (
              batch_id,
              date,
              feed_name,
              bags,
              kg,
              price_per_bag,
              total_cost,
              user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            batchId,
            date,
            feedName,
            bags,
            kg,
            price,
            totalCost,
            req.user.id
          );

          db.prepare(`
            UPDATE feed_stock
            SET
              bags = bags - ?,
              updated_at =
                CURRENT_TIMESTAMP
            WHERE feed_name = ?
          `).run(
            bags,
            feedName
          );

          /*
            Feed used through feed-usage
            is also added to the matching
            daily entry.
          */

          db.prepare(`
            UPDATE daily
            SET feed_kg =
              COALESCE(feed_kg, 0) + ?
            WHERE id = (
              SELECT id
              FROM daily
              WHERE batch_id = ?
              AND date = ?
              ORDER BY id DESC
              LIMIT 1
            )
          `).run(
            kg,
            batchId,
            date
          );
        });

      transaction();

      res.json({
        success: true,
        feed_name: feedName,
        bags,
        kg,
        total_cost: totalCost
      });

    } catch (err) {
      res.status(400).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// FEED USAGE HISTORY
// =====================================================

app.get(
  "/api/feed-usage/:batchId",
  auth,
  (req, res) => {

    const rows =
      db.prepare(`
        SELECT *
        FROM feed_usage
        WHERE batch_id = ?
        ORDER BY date ASC, id ASC
      `).all(
        Number(req.params.batchId)
      );

    res.json(rows);
  }
);

// =====================================================
// SALES
// =====================================================

app.post(
  "/api/sales",
  auth,
  (req, res) => {

    try {
      const batchId =
        Number(req.body.batch_id || 0);

      const date =
        String(req.body.date || "").trim();

      const partyName =
        String(
          req.body.party_name || ""
        ).trim();

      const vehicleNo =
        String(
          req.body.vehicle_no || ""
        ).trim();

      const rate =
        Number(
          req.body.rate_per_kg || 0
        );

      const kg =
        Number(req.body.kg || 0);

      const nang =
        Number(req.body.nang || 0);

      const notes =
        String(req.body.notes || "");

      if (
        !batchId ||
        !date ||
        !partyName ||
        kg <= 0
      ) {
        return res.status(400).json({
          error:
            "Batch, date, party name and KG are required"
        });
      }

      const total =
        rate * kg;

      const result =
        db.prepare(`
          INSERT INTO sales
          (
            batch_id,
            date,
            party_name,
            vehicle_no,
            rate_per_kg,
            kg,
            nang,
            total_amount,
            notes,
            user_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          batchId,
          date,
          partyName,
          vehicleNo,
          rate,
          kg,
          nang,
          total,
          notes,
          req.user.id
        );

      res.json({
        success: true,
        id: result.lastInsertRowid,
        total_amount: total
      });

    } catch (err) {
      res.status(400).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// SALES LIST
// =====================================================

app.get(
  "/api/sales/:batchId",
  auth,
  (req, res) => {

    const sales =
      db.prepare(`
        SELECT *
        FROM sales
        WHERE batch_id = ?
        ORDER BY date ASC, id ASC
      `).all(
        Number(req.params.batchId)
      );

    res.json(sales);
  }
);

// =====================================================
// REPORT
// =====================================================

app.get(
  "/api/report/:id",
  auth,
  (req, res) => {

    try {
      const batchId =
        Number(req.params.id);

      const batch =
        db.prepare(`
          SELECT *
          FROM batches
          WHERE id = ?
        `).get(batchId);

      if (!batch) {
        return res.status(404).json({
          error: "Batch not found"
        });
      }

      const daily =
        db.prepare(`
          SELECT *
          FROM daily
          WHERE batch_id = ?
          ORDER BY date ASC, id ASC
        `).all(batchId);

      const totals =
        db.prepare(`
          SELECT
            COALESCE(
              SUM(feed_kg), 0
            ) AS total_feed,

            COALESCE(
              SUM(dead), 0
            ) AS total_dead,

            COALESCE(
              SUM(weight_kg), 0
            ) AS total_weight,

            COALESCE(
              SUM(medicine), 0
            ) AS total_medicine,

            COALESCE(
              SUM(other), 0
            ) AS total_other

          FROM daily
          WHERE batch_id = ?
        `).get(batchId);

      const feedCost =
        db.prepare(`
          SELECT
            COALESCE(
              SUM(total_cost), 0
            ) AS total_feed_cost
          FROM feed_usage
          WHERE batch_id = ?
        `).get(batchId);

      const sales =
        db.prepare(`
          SELECT
            COALESCE(
              SUM(kg), 0
            ) AS total_sale_kg,

            COALESCE(
              SUM(nang), 0
            ) AS total_sale_nang,

            COALESCE(
              SUM(total_amount), 0
            ) AS total_sale

          FROM sales
          WHERE batch_id = ?
        `).get(batchId);

      const birdsAlive =
        Math.max(
          0,
          Number(batch.chicks || 0) -
          Number(totals.total_dead || 0)
        );

      const totalFeed =
        Number(
          totals.total_feed || 0
        );

      const totalWeight =
        Number(
          totals.total_weight || 0
        );

      const fcr =
        totalWeight > 0
          ? totalFeed / totalWeight
          : 0;

      const chickCost =
        Number(batch.chicks || 0) *
        Number(batch.chick_rate || 0);

      const totalCost =
        chickCost +
        Number(
          feedCost.total_feed_cost || 0
        ) +
        Number(
          totals.total_medicine || 0
        ) +
        Number(
          totals.total_other || 0
        );

      const costPerKg =
        totalWeight > 0
          ? totalCost / totalWeight
          : 0;

      const totalSale =
        Number(
          sales.total_sale || 0
        );

      const profit =
        totalSale - totalCost;

      res.json({

        batch,

        daily,

        /*
          New clean field names
          for frontend.
        */

        live: birdsAlive,

        feed: Number(
          totalFeed.toFixed(2)
        ),

        weight: Number(
          totalWeight.toFixed(2)
        ),

        fcr: Number(
          fcr.toFixed(2)
        ),

        costKg: Number(
          costPerKg.toFixed(2)
        ),

        totalCost: Number(
          totalCost.toFixed(2)
        ),

        sale: Number(
          totalSale.toFixed(2)
        ),

        profit: Number(
          profit.toFixed(2)
        ),

        birds_alive: birdsAlive,

        totals: {
          total_feed: Number(
            totalFeed.toFixed(2)
          ),

          total_dead: Number(
            totals.total_dead || 0
          ),

          total_weight: Number(
            totalWeight.toFixed(2)
          ),

          total_medicine: Number(
            totals.total_medicine || 0
          ),

          total_other: Number(
            totals.total_other || 0
          )
        },

        feed_cost: Number(
          Number(
            feedCost.total_feed_cost || 0
          ).toFixed(2)
        ),

        fcr: Number(
          fcr.toFixed(2)
        ),

        chick_cost: Number(
          chickCost.toFixed(2)
        ),

        total_cost: Number(
          totalCost.toFixed(2)
        ),

        cost_per_kg: Number(
          costPerKg.toFixed(2)
        ),

        sales: {
          total_sale_kg: Number(
            sales.total_sale_kg || 0
          ),

          total_sale_nang: Number(
            sales.total_sale_nang || 0
          ),

          total_sale: Number(
            totalSale.toFixed(2)
          )
        },

        profit: Number(
          profit.toFixed(2)
        )
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// CLOSE BATCH
// =====================================================

app.patch(
  "/api/batches/:id/close",
  auth,
  ownerOnly,
  (req, res) => {

    try {
      db.prepare(`
        UPDATE batches
        SET status = 'completed'
        WHERE id = ?
      `).run(
        Number(req.params.id)
      );

      res.json({
        success: true,
        status: "completed"
      });

    } catch (err) {
      res.status(400).json({
        error: err.message
      });
    }
  }
);

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

// =====================================================
// SERVER
// =====================================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Poultry Manager running on port ${PORT}`
  );
});
