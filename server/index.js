import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";

const app = express();
const httpServer = createServer(app);

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error(
    "SESSION_SECRET wajib diisi dengan secret acak minimal 32 karakter.",
  );
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "codecanvas",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.disable("x-powered-by");

app.use(
  helmet({
    // CSP khusus untuk iframe preview akan diatur pada tahap editor.
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json({ limit: "100kb" }));

const MySQLStore = MySQLStoreFactory(session);

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "codecanvas",
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000,
});

app.use(
  session({
    name: "codecanvas.sid",
    secret: SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

// Pemeriksaan origin untuk request yang mengubah data.
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");

    if (origin && origin !== CLIENT_ORIGIN) {
      return res.status(403).json({
        ok: false,
        error: "Origin tidak diizinkan.",
      });
    }
  }

  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Terlalu banyak percobaan. Coba lagi beberapa menit.",
  },
});

function validateRegistration({ username, email, password }) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return "Username harus 3–30 karakter, hanya huruf, angka, dan underscore.";
  }

  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return "Format email tidak valid.";
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return "Password harus minimal 8 karakter dan maksimal 72 byte.";
  }

  return null;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      ok: false,
      error: "Silakan login terlebih dahulu.",
    });
  }

  next();
}

function parseProjectId(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    return null;
  }

  return value;
}

function validateProjectName(name) {
  if (typeof name !== "string") {
    return "Nama project wajib berupa teks.";
  }

  const trimmed = name.trim();

  if (!trimmed || trimmed.length > 100) {
    return "Nama project harus 1–100 karakter.";
  }

  return null;
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My CodeCanvas Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="container">
    <h1>Hello, CodeCanvas!</h1>
    <p>Your next idea starts here.</p>
    <button id="hello-button">Click me</button>
  </main>
  <script src="script.js"></script>
</body>
</html>`;

const DEFAULT_CSS = `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0b1020;
  color: #eaf2ff;
}

.container {
  width: min(90%, 600px);
  padding: 40px;
  border: 1px solid #263451;
  border-radius: 20px;
  background: #121b30;
  text-align: center;
}

h1 {
  color: #62dcff;
}

button {
  padding: 12px 20px;
  border: 0;
  border-radius: 10px;
  background: #62dcff;
  color: #08111e;
  font-weight: 700;
  cursor: pointer;
}`;

const DEFAULT_JS = `const button = document.querySelector("#hello-button");

button?.addEventListener("click", () => {
  alert("Your CodeCanvas project is working!");
});`;

// =========================
// HEALTH CHECK
// =========================

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "CodeCanvas",
    stage: "project-management",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      server: "ready",
      database: "connected",
      realtime: "initialized",
    });
  } catch {
    res.status(503).json({
      ok: false,
      server: "ready",
      database: "disconnected",
      realtime: "initialized",
    });
  }
});

// =========================
// AUTHENTICATION
// =========================

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const { username, email, password } = req.body ?? {};
    const error = validateRegistration({ username, email, password });

    if (error) {
      return res.status(400).json({ ok: false, error });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();

    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1",
      [normalizedUsername, normalizedEmail],
    );

    if (existing.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "Username atau email sudah digunakan.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash)
       VALUES (?, ?, ?)`,
      [normalizedUsername, normalizedEmail, passwordHash],
    );

    req.session.regenerate((sessionError) => {
      if (sessionError) return next(sessionError);

      req.session.user = {
        id: result.insertId,
        username: normalizedUsername,
        email: normalizedEmail,
      };

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        res.status(201).json({
          ok: true,
          message: "Akun berhasil dibuat.",
          user: req.session.user,
        });
      });
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error: "Username atau email sudah digunakan.",
      });
    }

    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const { identifier, password } = req.body ?? {};

    if (
      typeof identifier !== "string" ||
      typeof password !== "string" ||
      identifier.length > 254 ||
      password.length > 72
    ) {
      return res.status(400).json({
        ok: false,
        error: "Masukkan username/email dan password yang valid.",
      });
    }

    const value = identifier.trim();

    const [rows] = await pool.execute(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [value, value.toLowerCase()],
    );

    const user = rows[0];
    const validPassword = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !validPassword) {
      return res.status(401).json({
        ok: false,
        error: "Username/email atau password salah.",
      });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
      };

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        res.json({
          ok: true,
          message: "Login berhasil.",
          user: req.session.user,
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({
    ok: true,
    user: req.session.user || null,
  });
});

app.post("/api/auth/logout", (req, res, next) => {
  if (!req.session) {
    return res.json({ ok: true, message: "Sudah logout." });
  }

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("codecanvas.sid", {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    });

    res.json({
      ok: true,
      message: "Logout berhasil.",
    });
  });
});

app.get("/api/auth/protected", requireAuth, (req, res) => {
  res.json({
    ok: true,
    message: "Kamu sudah login.",
    user: req.session.user,
  });
});

// =========================
// PROJECT CRUD
// Semua endpoint di sini wajib login.
// Kepemilikan selalu diperiksa melalui user_id.
// =========================

// READ: daftar project milik user yang sedang login.
app.get("/api/projects", requireAuth, async (req, res, next) => {
  try {
    const [projects] = await pool.execute(
      `SELECT id, name, created_at, updated_at
       FROM projects
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [req.session.user.id],
    );

    res.json({
      ok: true,
      projects,
    });
  } catch (error) {
    next(error);
  }
});

// CREATE: buat project dengan starter HTML/CSS/JS.
app.post("/api/projects", requireAuth, async (req, res, next) => {
  try {
    const name =
      req.body?.name === undefined ? "Untitled Project" : req.body.name;

    const validationError = validateProjectName(name);

    if (validationError) {
      return res.status(400).json({
        ok: false,
        error: validationError,
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO projects
       (user_id, name, html_content, css_content, js_content)
       VALUES (?, ?, ?, ?, ?)`,
      [req.session.user.id, name.trim(), DEFAULT_HTML, DEFAULT_CSS, DEFAULT_JS],
    );

    const [rows] = await pool.execute(
      `SELECT id, name, html_content, css_content, js_content,
              created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [result.insertId, req.session.user.id],
    );

    res.status(201).json({
      ok: true,
      message: "Project berhasil dibuat.",
      project: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// READ: detail satu project, hanya jika pemiliknya cocok.
app.get("/api/projects/:id", requireAuth, async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.id);

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error: "ID project tidak valid.",
      });
    }

    const [rows] = await pool.execute(
      `SELECT id, name, html_content, css_content, js_content,
              created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [projectId, req.session.user.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Project tidak ditemukan.",
      });
    }

    res.json({
      ok: true,
      project: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// UPDATE: rename project atau update kode.
// Endpoint ini akan dipakai lagi oleh editor pada tahap berikutnya.
app.patch("/api/projects/:id", requireAuth, async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.id);

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error: "ID project tidak valid.",
      });
    }

    const body = req.body ?? {};
    const allowedFields = ["name", "html_content", "css_content", "js_content"];

    const suppliedFields = allowedFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(body, field),
    );

    if (suppliedFields.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Tidak ada data project yang dikirim.",
      });
    }

    const [existing] = await pool.execute(
      "SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1",
      [projectId, req.session.user.id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Project tidak ditemukan.",
      });
    }

    const updates = [];
    const values = [];

    for (const field of suppliedFields) {
      const value = body[field];

      if (field === "name") {
        const validationError = validateProjectName(value);

        if (validationError) {
          return res.status(400).json({
            ok: false,
            error: validationError,
          });
        }

        updates.push("name = ?");
        values.push(value.trim());
        continue;
      }

      if (typeof value !== "string") {
        return res.status(400).json({
          ok: false,
          error: `${field} harus berupa teks.`,
        });
      }

      if (Buffer.byteLength(value, "utf8") > 30000) {
        return res.status(413).json({
          ok: false,
          error: `Ukuran ${field} maksimal 30 KB pada tahap ini.`,
        });
      }

      // Nama kolom dipilih hanya dari allowlist di atas.
      updates.push(`${field} = ?`);
      values.push(value);
    }

    values.push(projectId, req.session.user.id);

    const [result] = await pool.execute(
      `UPDATE projects
       SET ${updates.join(", ")}
       WHERE id = ? AND user_id = ?`,
      values,
    );

    const [rows] = await pool.execute(
      `SELECT id, name, html_content, css_content, js_content,
              created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [projectId, req.session.user.id],
    );

    res.json({
      ok: true,
      message:
        result.affectedRows > 0
          ? "Project berhasil diperbarui."
          : "Tidak ada perubahan pada project.",
      project: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// DELETE: hanya pemilik project yang bisa menghapusnya.
app.delete("/api/projects/:id", requireAuth, async (req, res, next) => {
  try {
    const projectId = parseProjectId(req.params.id);

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error: "ID project tidak valid.",
      });
    }

    const [result] = await pool.execute(
      "DELETE FROM projects WHERE id = ? AND user_id = ?",
      [projectId, req.session.user.id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        error: "Project tidak ditemukan.",
      });
    }

    res.json({
      ok: true,
      message: "Project berhasil dihapus.",
    });
  } catch (error) {
    next(error);
  }
});

// =========================
// REALTIME
// =========================

const io = new SocketServer(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

io.on("connection", (socket) => {
  socket.emit("server:hello", {
    message: "Connected to CodeCanvas realtime gateway.",
    stage: "project-management",
  });
});

// =========================
// ERROR HANDLING
// Route API harus berada di atas middleware 404 ini.
// =========================

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
  });
});

app.use((err, _req, res, _next) => {
  console.error("Request error:", err.message);

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      error: "Data yang dikirim terlalu besar.",
    });
  }

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      ok: false,
      error: "Format JSON tidak valid.",
    });
  }

  res.status(500).json({
    ok: false,
    error: isProduction ? "Internal server error" : err.message,
  });
});

// =========================
// START & SHUTDOWN
// =========================

async function startServer() {
  const connection = await pool.getConnection();
  connection.release();

  httpServer.listen(PORT, () => {
    console.log(`CodeCanvas API: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`Frontend: ${CLIENT_ORIGIN}`);
    console.log("Stage: Project Management");
  });
}

startServer().catch((error) => {
  console.error("Gagal menghubungkan CodeCanvas ke MySQL:", error.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down...`);

  io.close(() => {
    httpServer.close(async () => {
      await sessionStore.close();
      await pool.end();
      process.exit(0);
    });
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
