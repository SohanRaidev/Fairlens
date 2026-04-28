-- FairLens Audit Database Schema
-- SQLite3

CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    filename TEXT,
    sensitive_attr TEXT,
    privileged_value TEXT,
    decision_column TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER,
    config TEXT,          -- JSON: full audit configuration
    metrics TEXT,         -- JSON: computed fairness metrics
    gemini_analysis TEXT, -- Gemini AI analysis text
    mitigation TEXT,      -- JSON: mitigation simulation results
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','complete','error'))
);

CREATE INDEX IF NOT EXISTS idx_audits_created ON audits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_domain ON audits(domain);
