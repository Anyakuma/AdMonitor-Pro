import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { Pool } from "pg";

const DEFAULT_PORT = 3002;
const MAX_PORT_RETRIES = 20;
const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const isProduction = process.env.NODE_ENV === "production";

type RecordingPayload = {
  id: string;
  triggerWord: string;
  duration: number;
  timestamp: string;
  audioBase64: string;
  size: number;
  confidence?: string;
  transcript?: string;
  voteScore?: number;
  matchVariant?: string;
};

type ParsedRecordingPayload =
  | { status: "ok"; data: RecordingPayload }
  | { status: "error"; error: string };

function normalizeDatabaseUrl(value: string): string {
  // Some users paste credentials with square brackets around password; strip them safely.
  return value.replace(/:\[([^\]]+)\]@/, ":$1@");
}

const databaseUrl = rawDatabaseUrl ? normalizeDatabaseUrl(rawDatabaseUrl) : undefined;

// PostgreSQL connection pool (only when DATABASE_URL is configured)
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    })
  : null;

function isDatabaseEnabled(): boolean {
  return pool !== null;
}

function validateDatabaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql:// protocol.");
  }
}

function parseWordFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("word" in body)) return null;
  const rawWord = (body as { word?: unknown }).word;
  if (typeof rawWord !== "string") return null;
  const word = rawWord.trim();
  return word.length > 0 ? word : null;
}

function parseRecordingPayload(body: unknown): ParsedRecordingPayload {
  if (!body || typeof body !== "object") {
    return { status: "error", error: "Invalid request body" };
  }

  const b = body as Record<string, unknown>;
  const requiredStringFields = ["id", "triggerWord", "timestamp", "audioBase64"] as const;

  for (const field of requiredStringFields) {
    if (typeof b[field] !== "string" || (b[field] as string).trim() === "") {
      return { status: "error", error: `${field} is required` };
    }
  }

  if (typeof b.duration !== "number" || Number.isNaN(b.duration) || b.duration <= 0) {
    return { status: "error", error: "duration must be a positive number" };
  }

  if (typeof b.size !== "number" || Number.isNaN(b.size) || b.size < 0) {
    return { status: "error", error: "size must be a non-negative number" };
  }

  return {
    status: "ok",
    data: {
      id: (b.id as string).trim(),
      triggerWord: (b.triggerWord as string).trim(),
      duration: b.duration,
      timestamp: (b.timestamp as string).trim(),
      audioBase64: b.audioBase64 as string,
      size: b.size,
      confidence: typeof b.confidence === "string" ? b.confidence : "Strong",
      transcript: typeof b.transcript === "string" ? b.transcript : "",
      voteScore: typeof b.voteScore === "number" && !Number.isNaN(b.voteScore) ? b.voteScore : 0,
      matchVariant: typeof b.matchVariant === "string" ? b.matchVariant : "",
    },
  };
}

// Initialize database tables
async function initializeDatabase() {
  if (!pool) {
    if (isProduction) {
      throw new Error("DATABASE_URL is required in production.");
    }

    console.warn("[server] DATABASE_URL not set. API persistence is disabled in local development.");
    return;
  }

  validateDatabaseUrl(databaseUrl!);
  pool.on("error", (error) => {
    console.error("[server] Unexpected PostgreSQL pool error:", error);
  });

  try {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id SERIAL PRIMARY KEY,
        word TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        triggerWord TEXT NOT NULL,
        duration REAL NOT NULL,
        timestamp TEXT NOT NULL,
        audioBase64 TEXT NOT NULL,
        size INTEGER NOT NULL,
        confidence TEXT DEFAULT 'Strong',
        transcript TEXT,
        voteScore REAL,
        matchVariant TEXT
      );

      ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS transcript TEXT,
      ADD COLUMN IF NOT EXISTS voteScore REAL,
      ADD COLUMN IF NOT EXISTS matchVariant TEXT;
    `);

    // Insert default keywords if not initialized
    const initResult = await pool.query("SELECT value FROM settings WHERE key = 'initialized'");
    if (initResult.rows.length === 0) {
      const defaults = ["Guinness", "Hennessy", "Promotion", "Sale"];
      for (const word of defaults) {
        try {
          await pool.query("INSERT INTO keywords (word) VALUES ($1) ON CONFLICT DO NOTHING", [word]);
        } catch {
          // Ignore duplicate key errors
        }
      }
      await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ["initialized", "true"]);
    }

    console.log("[server] Database initialized successfully");
  } catch (error) {
    if (isProduction) {
      throw error;
    }

    console.error("[server] Database initialization warning:", error);
    console.error("[server] Continuing startup without DB persistence in development.");
  }
}

function parseStartPort(): number {
  const parsed = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  return Number.isNaN(parsed) ? DEFAULT_PORT : parsed;
}

function listenWithPortRetry(app: express.Express, host: string, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, retriesLeft: number) => {
      const server = app.listen(port, host, () => resolve(port));

      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && retriesLeft > 0) {
          const nextPort = port + 1;
          console.warn(`[server] Port ${port} is in use, retrying on ${nextPort}...`);
          tryListen(nextPort, retriesLeft - 1);
          return;
        }

        reject(error);
      });
    };

    tryListen(startPort, MAX_PORT_RETRIES);
  });
}

async function startServer() {
  const app = express();
  const startPort = parseStartPort();

  // Increase payload limit for audio base64 uploads
  app.use(express.json({ limit: "50mb" }));

  // --- API Routes ---

  // Keywords
  app.get("/api/keywords", async (_req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json([]);
    }

    try {
      const result = await pool.query("SELECT word FROM keywords ORDER BY word ASC");
      return res.json(result.rows.map((r) => r.word));
    } catch (err) {
      console.error("GET /api/keywords error:", err);
      return res.status(500).json({ error: "Failed to fetch keywords" });
    }
  });

  app.post("/api/keywords", async (req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json({ success: true, persisted: false });
    }

    try {
      const word = parseWordFromBody(req.body);
      if (!word) {
        return res.status(400).json({ error: "Word is required" });
      }
      await pool.query("INSERT INTO keywords (word) VALUES ($1) ON CONFLICT DO NOTHING", [word]);
      return res.json({ success: true });
    } catch (err) {
      console.error("POST /api/keywords error:", err);
      return res.status(500).json({ error: "Failed to add keyword" });
    }
  });

  app.delete("/api/keywords/:word", async (req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json({ success: true, persisted: false });
    }

    try {
      await pool.query("DELETE FROM keywords WHERE word = $1", [req.params.word]);
      return res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/keywords error:", err);
      return res.status(500).json({ error: "Failed to delete keyword" });
    }
  });

  // Recordings
  app.get("/api/recordings", async (_req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json([]);
    }

    try {
      const result = await pool.query(
        "SELECT id, triggerWord, duration, timestamp, audioBase64, size, confidence, transcript, voteScore, matchVariant FROM recordings ORDER BY timestamp DESC"
      );
      return res.json(result.rows);
    } catch (err) {
      console.error("GET /api/recordings error:", err);
      return res.status(500).json({ error: "Failed to fetch recordings" });
    }
  });

  app.post("/api/recordings", async (req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json({ success: true, persisted: false });
    }

    try {
      const parsed = parseRecordingPayload(req.body);
      if (parsed.status === "error") {
        return res.status(400).json({ error: parsed.error });
      }
      const { id, triggerWord, duration, timestamp, audioBase64, size, confidence, transcript, voteScore, matchVariant } = parsed.data;

      await pool.query(
        "INSERT INTO recordings (id, triggerWord, duration, timestamp, audioBase64, size, confidence, transcript, voteScore, matchVariant) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [id, triggerWord, duration, timestamp, audioBase64, size, confidence || "Strong", transcript || "", voteScore || 0, matchVariant || ""]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("POST /api/recordings error:", err);
      return res.status(500).json({ error: "Failed to save recording" });
    }
  });

  app.delete("/api/recordings/:id", async (req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json({ success: true, persisted: false });
    }

    try {
      await pool.query("DELETE FROM recordings WHERE id = $1", [req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/recordings error:", err);
      return res.status(500).json({ error: "Failed to delete recording" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const hmrPort = Number.parseInt(process.env.HMR_PORT ?? "0", 10) || 0;
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: hmrPort },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  const boundPort = await listenWithPortRetry(app, "0.0.0.0", startPort);
  console.log(`[server] Running on http://localhost:${boundPort}`);

  process.on("SIGTERM", async () => {
    try {
      await pool?.end();
    } finally {
      process.exit(0);
    }
  });
}

// Initialize database and start server
initializeDatabase()
  .then(() => startServer())
  .catch((error) => {
    console.error("[server] Failed to start server:", error);
    process.exit(1);
  });
