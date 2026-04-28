/**
 * FairLens — AI Fairness Auditor Backend
 * =======================================
 * Express.js server providing:
 *  - CSV file upload with validation
 *  - Python bias engine integration (subprocess)
 *  - Gemini API proxy (secure, key server-side)
 *  - SQLite audit persistence
 *  - Demo dataset generation
 *  - Rate limiting & security
 */

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "10", 10);
const UPLOAD_TTL = parseInt(process.env.UPLOAD_TTL_MINUTES || "60", 10);

// ══════ DIRECTORIES ══════════════════════════════════════════════
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_DIR = path.join(__dirname, "db");
const DEMO_DIR = path.join(__dirname, "demo_data");

[UPLOAD_DIR, DB_DIR, DEMO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ══════ DATABASE ═════════════════════════════════════════════════
const db = new Database(path.join(DB_DIR, "fairlens.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Initialize schema
const schema = fs.readFileSync(path.join(DB_DIR, "init.sql"), "utf-8");
db.exec(schema);

// Prepared statements
const stmtInsertAudit = db.prepare(`
  INSERT INTO audits (id, domain, filename, sensitive_attr, privileged_value, decision_column, row_count, config, metrics, gemini_analysis, mitigation, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateAudit = db.prepare(`
  UPDATE audits SET metrics = ?, mitigation = ?, status = ? WHERE id = ?
`);
const stmtUpdateGemini = db.prepare(`
  UPDATE audits SET gemini_analysis = ? WHERE id = ?
`);
const stmtGetAudit = db.prepare(`SELECT * FROM audits WHERE id = ?`);
const stmtListAudits = db.prepare(
  `SELECT id, domain, filename, created_at, status, sensitive_attr, row_count FROM audits ORDER BY created_at DESC LIMIT 50`
);

// ══════ MIDDLEWARE ════════════════════════════════════════════════
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment." },
});
app.use("/api/", apiLimiter);

// Gemini endpoint stricter rate limit
const geminiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: "Gemini rate limit reached. Wait 1 minute." },
});

// ══════ FILE UPLOAD CONFIG ═══════════════════════════════════════
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv") {
      return cb(new Error("Only CSV files are accepted."), false);
    }
    cb(null, true);
  },
});

// ══════ HELPER: Run Python Bias Engine ═══════════════════════════
function runBiasEngine(config) {
  return new Promise((resolve, reject) => {
    const configStr = JSON.stringify(config);
    execFile(
      "python3",
      [path.join(__dirname, "bias_engine.py"), configStr],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Bias engine error:", stderr || error.message);
          return reject(
            new Error(stderr || error.message || "Bias engine failed")
          );
        }
        try {
          const result = JSON.parse(stdout);
          if (result.error) return reject(new Error(result.error));
          resolve(result);
        } catch (e) {
          reject(new Error("Failed to parse bias engine output"));
        }
      }
    );
  });
}

// ══════ HELPER: Generate Demo CSV ════════════════════════════════
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDemoCSV(domain) {
  const filePath = path.join(DEMO_DIR, `${domain}_demo.csv`);
  if (fs.existsSync(filePath)) return filePath;

  const rand = mulberry32(domain === "hiring" ? 42 : domain === "lending" ? 137 : 89);
  const rows = [];

  for (let i = 0; i < 240; i++) {
    const privileged = i % 2 === 0;
    if (domain === "hiring") {
      const exp = Math.floor(rand() * 12) + 1;
      const score = Math.floor(rand() * 51) + 50;
      const qualified = score >= 70 && exp >= 3;
      const decision = privileged ? score >= 70 : score >= 87;
      rows.push(
        `${i + 1},${privileged ? "Male" : "Female"},${exp},${score},${qualified},${decision}`
      );
    } else if (domain === "lending") {
      const credit = Math.floor(rand() * 241) + 580;
      const income = Math.floor(rand() * 91) + 28;
      const debt = (rand() * 0.55).toFixed(2);
      const qualified = credit >= 680 && parseFloat(debt) < 0.4;
      const decision = privileged ? credit >= 680 : credit >= 724;
      rows.push(
        `${i + 1},${privileged ? "Group A" : "Group B"},${credit},${income},${debt},${qualified},${decision}`
      );
    } else {
      const severity = Math.floor(rand() * 101);
      const spend = privileged
        ? Math.floor(rand() * 8000) + 3000
        : Math.floor(rand() * 5000) + 1000;
      const qualified = severity >= 60;
      const decision = spend >= 4000;
      rows.push(
        `${i + 1},${privileged ? "Reference" : "Underserved"},${severity},${spend},${qualified},${decision}`
      );
    }
  }

  const headers = {
    hiring: "id,gender,exp_yrs,resume_score,qualified,hired",
    lending: "id,group,credit_score,income_k,debt_ratio,qualified,approved",
    healthcare: "id,group,severity,prior_spend,qualified,referred",
  };

  fs.writeFileSync(filePath, headers[domain] + "\n" + rows.join("\n"), "utf-8");
  return filePath;
}

// ══════ ROUTES ═══════════════════════════════════════════════════

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" });
});

// ── Upload CSV ──────────────────────────────────────────────────
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Quick validation: read first few lines
    const content = fs.readFileSync(req.file.path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "CSV must have at least a header row and one data row." });
    }

    const headers = lines[0].split(",").map((h) => h.trim());
    if (headers.length < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "CSV must have at least 2 columns." });
    }

    res.json({
      success: true,
      file_id: path.basename(req.file.path, ".csv"),
      filename: req.file.originalname,
      headers: headers,
      row_count: lines.length - 1,
      file_path: req.file.path,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Run Audit ───────────────────────────────────────────────────
app.post("/api/audit", async (req, res) => {
  try {
    const {
      file_id,
      file_path,
      filename,
      sensitive_attr,
      privileged_value,
      decision_column,
      qualified_column,
      score_column,
      domain,
    } = req.body;

    if (!sensitive_attr || !privileged_value || !decision_column) {
      return res.status(400).json({
        error: "Missing required fields: sensitive_attr, privileged_value, decision_column",
      });
    }

    // Determine CSV path
    let csvPath = file_path;
    if (!csvPath && file_id) {
      csvPath = path.join(UPLOAD_DIR, `${file_id}.csv`);
    }
    if (!csvPath || !fs.existsSync(csvPath)) {
      return res.status(404).json({ error: "CSV file not found." });
    }

    const auditId = uuidv4();
    const config = {
      csv_path: csvPath,
      sensitive_attr,
      privileged_value,
      decision_column,
      qualified_column: qualified_column || null,
      score_column: score_column || null,
      mitigation_pct: 0,
    };

    // Insert pending audit
    stmtInsertAudit.run(
      auditId,
      domain || "custom",
      filename || path.basename(csvPath),
      sensitive_attr,
      privileged_value,
      decision_column,
      null,
      JSON.stringify(config),
      null,
      null,
      null,
      "processing"
    );

    // Run bias engine
    const result = await runBiasEngine(config);

    // Update audit with results
    stmtUpdateAudit.run(
      JSON.stringify(result.metrics),
      JSON.stringify(result.mitigation_sweep),
      "complete",
      auditId
    );

    res.json({
      success: true,
      audit_id: auditId,
      ...result,
    });
  } catch (err) {
    console.error("Audit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Demo Audit ──────────────────────────────────────────────────
app.get("/api/demo/:domain", async (req, res) => {
  try {
    const domain = req.params.domain;
    if (!["hiring", "lending", "healthcare"].includes(domain)) {
      return res.status(400).json({ error: "Invalid domain. Use: hiring, lending, healthcare" });
    }

    const csvPath = generateDemoCSV(domain);

    const domainConfigs = {
      hiring: {
        sensitive_attr: "gender",
        privileged_value: "Male",
        decision_column: "hired",
        qualified_column: "qualified",
        score_column: "resume_score",
      },
      lending: {
        sensitive_attr: "group",
        privileged_value: "Group A",
        decision_column: "approved",
        qualified_column: "qualified",
        score_column: "credit_score",
      },
      healthcare: {
        sensitive_attr: "group",
        privileged_value: "Reference",
        decision_column: "referred",
        qualified_column: "qualified",
        score_column: "severity",
      },
    };

    const config = {
      csv_path: csvPath,
      ...domainConfigs[domain],
      mitigation_pct: 0,
    };

    const result = await runBiasEngine(config);

    res.json({
      success: true,
      domain,
      ...result,
    });
  } catch (err) {
    console.error("Demo error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Mitigate ────────────────────────────────────────────────────
app.post("/api/mitigate", async (req, res) => {
  try {
    const { file_path, file_id, sensitive_attr, privileged_value, decision_column, qualified_column, score_column, mitigation_pct, domain } = req.body;

    let csvPath = file_path;
    if (!csvPath && file_id) {
      csvPath = path.join(UPLOAD_DIR, `${file_id}.csv`);
    }
    if (!csvPath && domain && ["hiring", "lending", "healthcare"].includes(domain)) {
      csvPath = generateDemoCSV(domain);
    }

    if (!csvPath || !fs.existsSync(csvPath)) {
      return res.status(404).json({ error: "CSV file not found." });
    }

    const config = {
      csv_path: csvPath,
      sensitive_attr,
      privileged_value,
      decision_column,
      qualified_column: qualified_column || null,
      score_column: score_column || null,
      mitigation_pct: mitigation_pct || 0,
    };

    const result = await runBiasEngine(config);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Gemini Proxy ────────────────────────────────────────────────
app.post("/api/gemini", geminiLimiter, async (req, res) => {
  try {
    const { domain, metrics, audit_id } = req.body;

    // Try server-side key first, then allow client-provided key
    const apiKey = process.env.GEMINI_API_KEY || req.body.api_key;
    if (!apiKey) {
      return res.status(400).json({
        error: "No Gemini API key configured. Set GEMINI_API_KEY in .env or provide api_key in request.",
        demo: true,
      });
    }

    const domainNames = {
      hiring: "Hiring",
      lending: "Lending",
      healthcare: "Healthcare",
      custom: "Custom Dataset",
    };

    const m = metrics;
    const prompt = `You are FairLens, a senior AI fairness auditor.

Domain: ${domainNames[domain] || domain}
Records audited: ${m.n_total}
Sensitive attribute: ${m.sensitive_attr || "protected attribute"}
Privileged group (n=${m.n_privileged}) — Selection rate: ${(m.selection_rate_privileged * 100).toFixed(1)}%
Disadvantaged group (n=${m.n_unprivileged}) — Selection rate: ${(m.selection_rate_unprivileged * 100).toFixed(1)}%

Fairness metrics:
- Disparate Impact: ${m.disparate_impact}  (EEOC threshold ≥ 0.80)
- Statistical Parity Difference: ${m.statistical_parity_difference}
- Equal Opportunity Difference: ${m.equal_opportunity_difference}
- Avg Absolute Odds Difference: ${m.avg_absolute_odds_difference}
- Theil Index: ${m.theil_index}
- TPR Privileged: ${(m.tpr_privileged * 100).toFixed(1)}%
- TPR Unprivileged: ${(m.tpr_unprivileged * 100).toFixed(1)}%
- Overall accuracy: ${(m.overall_accuracy * 100).toFixed(1)}%

Write a structured audit briefing with EXACTLY these four sections. Use markdown headings (##). Max 300 words total.

## Diagnosis
2–3 sentences on what the numbers show.

## Who is harmed
1–2 sentences naming the group and the type of harm (allocative, representational, or quality-of-service).

## Likely root cause
3 bullet points with domain-specific causes.

## Mitigation playbook
4 numbered steps: one pre-processing, one in-processing, one post-processing, one governance/audit action.`;

    // Retry logic with model fallback
    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    let response;
    for (let attempt = 0; attempt < models.length; attempt++) {
      const model = models[attempt];
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );

      if (response.ok) break;
      if (response.status === 503 || response.status === 429) {
        const wait = (attempt + 1) * 2000;
        console.log(`Gemini ${model} returned ${response.status}, trying next model in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        break;
      }
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const analysis =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Save to audit if audit_id provided
    if (audit_id) {
      stmtUpdateGemini.run(analysis, audit_id);
    }

    res.json({ success: true, analysis, model: "gemini-2.5-flash" });
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Audit History ───────────────────────────────────────────────
app.get("/api/audits", (req, res) => {
  const audits = stmtListAudits.all();
  res.json({ success: true, audits });
});

app.get("/api/audit/:id", (req, res) => {
  const audit = stmtGetAudit.get(req.params.id);
  if (!audit) {
    return res.status(404).json({ error: "Audit not found." });
  }
  // Parse JSON fields
  if (audit.metrics) audit.metrics = JSON.parse(audit.metrics);
  if (audit.config) audit.config = JSON.parse(audit.config);
  if (audit.mitigation) audit.mitigation = JSON.parse(audit.mitigation);
  res.json({ success: true, audit });
});

// ── Upload cleanup (auto-delete old files) ──────────────────────
function cleanupUploads() {
  try {
    const cutoff = Date.now() - UPLOAD_TTL * 60 * 1000;
    if (!fs.existsSync(UPLOAD_DIR)) return;
    fs.readdirSync(UPLOAD_DIR).forEach((file) => {
      try {
        const filePath = path.join(UPLOAD_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Cleaned up: ${file}`);
        }
      } catch (err) {
        console.error(`Failed to clean up file ${file}:`, err.message);
      }
    });
  } catch (err) {
    console.error("Cleanup interval error:", err.message);
  }
}
setInterval(cleanupUploads, 10 * 60 * 1000); // Every 10 minutes

// ══════ ERROR HANDLER ════════════════════════════════════════════
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `File too large. Max ${MAX_UPLOAD_MB}MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === "Only CSV files are accepted.") {
    return res.status(400).json({ error: err.message });
  }
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ══════ SAFETY NET ═════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

// ══════ START SERVER ═════════════════════════════════════════════
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║   FairLens — AI Fairness Auditor              ║
  ║   Server running on http://localhost:${PORT}      ║
  ║   Gemini API: ${process.env.GEMINI_API_KEY ? "✅ Configured" : "⚠️  Not set (demo mode)"}          ║
  ╚═══════════════════════════════════════════════╝
  `);
});
