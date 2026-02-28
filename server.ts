import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { Pool } from "pg";

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Initialize database tables
async function initializeDatabase() {
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
        confidence TEXT DEFAULT 'Strong'
      );
    `);

    // Insert default keywords if not initialized
    const initResult = await pool.query("SELECT value FROM settings WHERE key = 'initialized'");
    if (initResult.rows.length === 0) {
      const defaults = ['Guinness', 'Hennessy', 'Promotion', 'Sale'];
      for (const word of defaults) {
        try {
          await pool.query("INSERT INTO keywords (word) VALUES ($1) ON CONFLICT DO NOTHING", [word]);
        } catch (e) {
          // Ignore duplicate key errors
        }
      }
      await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ['initialized', 'true']);
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    console.error('⚠️  Note: If this is a network error in development, it will work fine on Vercel (which has internet access)');
    console.error('🔗 Continuing startup anyway for development...');
    // Don't throw - let server continue anyway for dev
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3002;

  // Increase payload limit for audio base64 uploads
  app.use(express.json({ limit: '50mb' }));

  // --- API Routes ---

  // Keywords
  app.get("/api/keywords", async (req, res) => {
    try {
      const result = await pool.query("SELECT word FROM keywords ORDER BY word ASC");
      res.json(result.rows.map(r => r.word));
    } catch (err) {
      console.error('GET /api/keywords error:', err);
      res.status(500).json({ error: "Failed to fetch keywords" });
    }
  });

  app.post("/api/keywords", async (req, res) => {
    try {
      const { word } = req.body;
      if (!word) return res.status(400).json({ error: "Word is required" });
      await pool.query("INSERT INTO keywords (word) VALUES ($1) ON CONFLICT DO NOTHING", [word]);
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/keywords error:', err);
      res.status(500).json({ error: "Failed to add keyword" });
    }
  });

  app.delete("/api/keywords/:word", async (req, res) => {
    try {
      await pool.query("DELETE FROM keywords WHERE word = $1", [req.params.word]);
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/keywords error:', err);
      res.status(500).json({ error: "Failed to delete keyword" });
    }
  });

  // Recordings
  app.get("/api/recordings", async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, triggerWord, duration, timestamp, audioBase64, size, confidence FROM recordings ORDER BY timestamp DESC"
      );
      res.json(result.rows);
    } catch (err) {
      console.error('GET /api/recordings error:', err);
      res.status(500).json({ error: "Failed to fetch recordings" });
    }
  });

  app.post("/api/recordings", async (req, res) => {
    try {
      const { id, triggerWord, duration, timestamp, audioBase64, size, confidence } = req.body;
      await pool.query(
        "INSERT INTO recordings (id, triggerWord, duration, timestamp, audioBase64, size, confidence) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, triggerWord, duration, timestamp, audioBase64, size, confidence || 'Strong']
      );
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/recordings error:', err);
      res.status(500).json({ error: "Failed to save recording" });
    }
  });

  app.delete("/api/recordings/:id", async (req, res) => {
    try {
      await pool.query("DELETE FROM recordings WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/recordings error:', err);
      res.status(500).json({ error: "Failed to delete recording" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

// Initialize database and start server
initializeDatabase()
  .then(() => startServer())
  .catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
