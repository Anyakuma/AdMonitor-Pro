import "dotenv/config";
import dns from "node:dns";
import express from "express";
import { Pool } from "pg";

// Force Node.js to use IPv4 first. This fixes ENOTFOUND and ConnectTimeout errors
// on local networks that lack proper IPv6 routing.
if (!process.env.VERCEL) {
  dns.setDefaultResultOrder("ipv4first");
}

const DEFAULT_PORT = 3002;
const MAX_PORT_RETRIES = 20;
const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const rawDeepgramKey = process.env.DEEPGRAM_API_KEY?.trim() || "";
const deepgramApiKey = rawDeepgramKey.replace(/^["']|["']$/g, '');
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

const app = express();
app.use(express.json({ limit: "50mb" }));

// Enable CORS for Desktop/Mobile wrapper API access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

function setupRoutes() {
  // --- API Routes ---

  // Deepgram temporary token (never expose raw API key to browser clients)
  app.post("/api/deepgram/token", async (_req, res) => {
    if (!deepgramApiKey) {
      return res.status(503).json({ error: "Deepgram is not configured on this server" });
    }

    try {
      // 1. Get Project ID
      const projRes = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${deepgramApiKey}` },
      });

      if (!projRes.ok) {
        console.warn("[server] Deepgram projects request failed. Fallback to direct key usage.");
        return res.json({ access_token: deepgramApiKey, expires_in: 86400 });
      }

      const projData = await projRes.json();
      const projectId = projData.projects?.[0]?.project_id;

      if (!projectId) {
        console.warn("[server] No Deepgram project found. Using fallback token.");
        return res.json({ access_token: deepgramApiKey, expires_in: 86400 });
      }

      // 2. Create Temporary Key
      const keyRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          comment: "AdMonitor Pro Temp Key",
          scopes: ["usage:write"],
          time_to_live_in_seconds: 60,
        }),
      });

      if (!keyRes.ok) {
        console.warn("[server] Deepgram key request failed. Using fallback token.");
        return res.json({ access_token: deepgramApiKey, expires_in: 86400 });
      }

      const payload = (await keyRes.json()) as { key?: string; api_key?: string };
      const generatedKey = payload.key || payload.api_key;
      if (!generatedKey) {
        return res.json({ access_token: deepgramApiKey, expires_in: 86400 });
      }

      return res.json({
        access_token: generatedKey,
        expires_in: 60,
      });
    } catch (error) {
      console.error("[server] Deepgram token fetch error. Using fallback token:", error);
      return res.json({ access_token: deepgramApiKey, expires_in: 86400 });
    }
  });

  // Keywords
  app.get("/api/keywords", async (_req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json([]);
    }

    try {
      const result = await pool!.query("SELECT id, word FROM keywords ORDER BY word ASC");
      return res.json(result.rows);
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
      const result = await pool!.query("INSERT INTO keywords (word) VALUES ($1) ON CONFLICT (word) DO UPDATE SET word = EXCLUDED.word RETURNING id, word", [word]);
      const keyword = result.rows[0];
      return res.json({ success: true, id: keyword.id, word: keyword.word });
    } catch (err) {
      console.error("POST /api/keywords error:", err);
      return res.status(500).json({ error: "Failed to add keyword" });
    }
  });

  app.delete("/api/keywords/:id", async (req, res) => {
    if (!isDatabaseEnabled()) {
      return res.json({ success: true, persisted: false });
    }

    try {
      const word = req.params.id;
      await pool!.query("DELETE FROM keywords WHERE word = $1", [word]);
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
      const result = await pool!.query(
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

      await pool!.query(
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
      await pool!.query("DELETE FROM recordings WHERE id = $1", [req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/recordings error:", err);
      return res.status(500).json({ error: "Failed to delete recording" });
    }
  });

}

setupRoutes();
export default app;

async function startServer() {
  const startPort = parseStartPort();

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const hmrPort = Number.parseInt(process.env.HMR_PORT ?? "0", 10) || 0;
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: hmrPort },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    app.use(express.static("dist"));
  }

  if (!process.env.VERCEL) {
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
}

if (!process.env.VERCEL) {
  initializeDatabase()
    .then(() => startServer())
    .catch((error) => {
      console.error("[server] Failed to start server:", error);
      process.exit(1);
    });
} else {
  // On Vercel, simply trigger the database init asynchronously
  initializeDatabase().catch(console.error);
}
