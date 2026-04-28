# ⚖️ FairLens — AI Fairness Auditor

**FairLens** is a full-stack AI-powered platform that detects, explains, and simulates fixes for algorithmic bias in automated decision-making systems across hiring, lending, and healthcare.

> 🏆 Built for **Google for Developers · Hack2Skill PromptWars 2026** — Unbiased AI Decision track

![FairLens](https://img.shields.io/badge/Powered%20by-Gemini%202.5%20Flash-blue?logo=google&logoColor=white)
![Node.js](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-green?logo=node.js)
![Python](https://img.shields.io/badge/Engine-Python%20%2B%20Pandas-yellow?logo=python)
![SQLite](https://img.shields.io/badge/Database-SQLite-lightgrey?logo=sqlite)

---

## 🎯 Problem Statement

AI systems making critical decisions about people's lives are trained on historically biased data:

| Domain | Evidence | Impact |
|--------|----------|--------|
| **Hiring** | Amazon's résumé screener penalised the word "women's" | Systematic gender discrimination |
| **Lending** | 80% higher rejection for Black applicants (The Markup, 2021) | $5T allocated by biased models annually |
| **Healthcare** | Optum algorithm under-referred 200M+ Black patients | Used cost as proxy for need (Obermeyer et al., Science 2019) |

**FairLens solves this** by providing an accessible, end-to-end fairness auditing tool that any developer or compliance officer can use — no ML expertise required.

---

## ✨ Key Features

### 1. 🔬 Industry-Standard Bias Metrics
Computes **5 fairness metrics** using a Python engine (pandas + numpy):
- **Disparate Impact** — EEOC 4/5ths rule compliance
- **Statistical Parity Difference** — Selection rate gap
- **Equal Opportunity Difference** — True Positive Rate gap
- **Average Absolute Odds Difference** — Combined error rate disparity
- **Theil Index** — Information-theoretic inequality measure

### 2. 🤖 Gemini 2.5 Flash AI Analysis
- Generates **structured audit briefings** with diagnosis, harm identification, root cause analysis, and a 4-step mitigation playbook
- Secure server-side proxy — API keys never touch the browser
- Smart model fallback with retry logic for high availability

### 3. 🛠️ Interactive Mitigation Simulator
- **Reject-option classification** — flip top-scoring denied candidates from disadvantaged groups
- Real-time slider shows fairness vs. accuracy trade-offs
- Demonstrates that fairness often *improves* accuracy when baseline models incorrectly deny qualified candidates

### 4. 📊 Upload Any Dataset
- Drag-and-drop CSV upload with automatic column detection
- Dynamic column mapping — choose your sensitive attribute, decision column, and qualification labels
- Works with any tabular decision dataset

### 5. 🎭 Built-in Demo Datasets
Three pre-configured domains with realistic synthetic data:
- **Hiring** — Gender bias in résumé screening (threshold: score ≥ 87 for women vs ≥ 70 for men)
- **Lending** — Racial proxy bias in loan approval (credit ≥ 724 for Group B vs ≥ 680 for Group A)
- **Healthcare** — Cost-as-proxy bias in care referrals (mirrors the Obermeyer et al. finding)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS)                  │
│  Hero → Demo Tabs → Upload Zone → Results → Mitigation   │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────┐
│               Node.js / Express Backend                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Upload   │  │  Gemini   │  │   Audit History      │  │
│  │  Handler  │  │  Proxy    │  │   (SQLite WAL)       │  │
│  └──────────┘  └───────────┘  └──────────────────────┘  │
│           │                                              │
│  ┌────────▼─────────────────────────────────────────┐   │
│  │         Python Bias Engine (subprocess)           │   │
│  │  pandas · numpy · 5 metrics · reject-option ROC   │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/upload` | Upload CSV file |
| `POST` | `/api/audit` | Run bias audit on uploaded CSV |
| `GET` | `/api/demo/:domain` | Run demo audit (hiring/lending/healthcare) |
| `POST` | `/api/gemini` | Generate AI analysis via Gemini proxy |
| `POST` | `/api/mitigate` | Run mitigation simulation |
| `GET` | `/api/audits` | List audit history |
| `GET` | `/api/audit/:id` | Get specific audit details |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **Python 3** with `pandas` and `numpy`
- **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Setup

```bash
# Clone the repository
git clone https://github.com/SohanRaidev/Fairlens.git
cd Fairlens

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

---

## 📁 Project Structure

```
Fairlens/
├── server.js           # Express backend (API routes, Gemini proxy, SQLite)
├── bias_engine.py      # Python fairness computation engine
├── package.json        # Node.js dependencies
├── requirements.txt    # Python dependencies (pandas, numpy)
├── .env.example        # Environment template
├── .gitignore
├── public/
│   └── index.html      # Full-stack frontend (served by Express)
├── index.html          # Standalone frontend (client-side only)
├── db/
│   └── init.sql        # SQLite schema
├── demo_data/          # Auto-generated demo CSVs
├── sample_csvs/        # Sample CSV files for testing
│   ├── hiring_bias.csv
│   ├── lending_bias.csv
│   └── healthcare_bias.csv
└── uploads/            # Temporary upload storage (auto-cleaned)
```

---

## 🧪 Sample CSV Files

The `sample_csvs/` directory contains ready-to-upload datasets for testing:

| File | Rows | Sensitive Attr | Decision Col | Bias Pattern |
|------|------|---------------|-------------|--------------|
| `hiring_bias.csv` | 500 | `gender` | `hired` | Women need score ≥ 85 vs ≥ 65 for men |
| `lending_bias.csv` | 500 | `race` | `approved` | Minority needs credit ≥ 740 vs ≥ 680 |
| `healthcare_bias.csv` | 500 | `ethnicity` | `referred` | Uses cost proxy, disadvantaging low-income patients |

---

## 🔒 Security

- **API keys server-side only** — Gemini key stored in `.env`, never exposed to browser
- **File validation** — CSV-only uploads with size limits (10MB default)
- **Parameterized SQL** — No injection vulnerabilities
- **Rate limiting** — 60 req/min API, 10 req/min Gemini
- **Auto-cleanup** — Uploaded files deleted after 60 minutes
- **CORS configured** — Restricted cross-origin access

---

## 📊 Fairness Metrics Explained

| Metric | Formula | Fair Threshold | What it measures |
|--------|---------|---------------|-----------------|
| **Disparate Impact** | P(ŷ=1\|unpriv) ÷ P(ŷ=1\|priv) | ≥ 0.80 | EEOC 4/5ths rule compliance |
| **Statistical Parity Diff** | P(ŷ=1\|unpriv) − P(ŷ=1\|priv) | \|SPD\| ≤ 0.05 | Selection rate gap |
| **Equal Opportunity Diff** | TPR(unpriv) − TPR(priv) | \|EOD\| ≤ 0.05 | Qualified candidates denied unfairly |
| **Avg Abs Odds Diff** | (|ΔTPR| + |ΔFPR|) / 2 | ≤ 0.05 | Combined error rate disparity |
| **Theil Index** | Entropy-based inequality | Lower is fairer | Overall distributional unfairness |

---

## 🛡️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Vanilla HTML/CSS/JS | Premium editorial UI with custom typography |
| Backend | Node.js + Express | REST API, file handling, Gemini proxy |
| AI Engine | Python (pandas, numpy) | Fairness metric computation |
| AI Analysis | Google Gemini 2.5 Flash | Natural language bias explanations |
| Database | SQLite (WAL mode) | Audit history persistence |
| Security | Rate limiting, multer, dotenv | Input validation and key protection |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ for unbiased AI decisions<br>
  <strong>Google for Developers · Hack2Skill PromptWars 2026</strong>
</p>
