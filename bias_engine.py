#!/usr/bin/env python3
"""
FairLens Bias Engine
====================
Standalone fairness metrics computation engine.
Reads CSV data and audit configuration, computes industry-standard
bias metrics (IBM AIF360 / Microsoft Fairlearn compatible), and
outputs structured JSON results.

Usage:
    python3 bias_engine.py '<json_config>'

Config JSON:
    {
        "csv_path": "uploads/abc123.csv",
        "sensitive_attr": "gender",
        "privileged_value": "Male",
        "decision_column": "hired",
        "qualified_column": "qualified",     // optional
        "score_column": "resume_score",      // optional, for mitigation
        "mitigation_pct": 0                  // 0-100, optional
    }

Output: JSON to stdout with metrics, per-group stats, mitigation results.
"""

import sys
import json
import numpy as np
import pandas as pd
from typing import Any


def load_and_validate(config: dict) -> pd.DataFrame:
    """Load CSV and validate required columns exist."""
    csv_path = config["csv_path"]
    df = pd.read_csv(csv_path)

    sensitive = config["sensitive_attr"]
    decision = config["decision_column"]

    if sensitive not in df.columns:
        raise ValueError(f"Sensitive attribute column '{sensitive}' not found. Available: {list(df.columns)}")
    if decision not in df.columns:
        raise ValueError(f"Decision column '{decision}' not found. Available: {list(df.columns)}")

    # Coerce decision column to boolean
    df["_decision"] = df[decision].apply(_to_bool)

    # Mark privileged/unprivileged
    priv_value = config["privileged_value"]
    df["_privileged"] = df[sensitive].astype(str).str.strip() == str(priv_value).strip()

    # Qualified column (optional — if not provided, we can't compute EOD/AAOD accurately)
    qual_col = config.get("qualified_column")
    if qual_col and qual_col in df.columns:
        df["_qualified"] = df[qual_col].apply(_to_bool)
    else:
        # Fallback: treat decision as ground truth (less informative but still works)
        df["_qualified"] = df["_decision"]

    # Score column for mitigation
    score_col = config.get("score_column")
    if score_col and score_col in df.columns:
        df["_score"] = pd.to_numeric(df[score_col], errors="coerce").fillna(0)
    else:
        df["_score"] = 0

    return df


def _to_bool(val) -> bool:
    """Convert various representations to boolean."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val >= 1
    s = str(val).strip().lower()
    return s in ("true", "yes", "1", "y", "approved", "hired", "referred", "accepted")


def compute_metrics(df: pd.DataFrame) -> dict:
    """Compute all fairness metrics from the dataframe."""
    priv = df[df["_privileged"]]
    unpriv = df[~df["_privileged"]]

    n_priv = len(priv)
    n_unpriv = len(unpriv)
    n_total = len(df)

    if n_priv == 0 or n_unpriv == 0:
        raise ValueError("Both privileged and unprivileged groups must have at least one member.")

    # Selection rates
    sel_priv = priv["_decision"].sum() / n_priv
    sel_unpriv = unpriv["_decision"].sum() / n_unpriv

    # Disparate Impact (4/5ths rule)
    di = sel_unpriv / sel_priv if sel_priv > 0 else 0.0

    # Statistical Parity Difference
    spd = sel_unpriv - sel_priv

    # True Positive Rate (recall) per group
    priv_qual = priv[priv["_qualified"]]
    unpriv_qual = unpriv[unpriv["_qualified"]]
    priv_nqual = priv[~priv["_qualified"]]
    unpriv_nqual = unpriv[~unpriv["_qualified"]]

    tpr_priv = priv_qual["_decision"].sum() / len(priv_qual) if len(priv_qual) > 0 else 0.0
    tpr_unpriv = unpriv_qual["_decision"].sum() / len(unpriv_qual) if len(unpriv_qual) > 0 else 0.0

    # False Positive Rate per group
    fpr_priv = priv_nqual["_decision"].sum() / len(priv_nqual) if len(priv_nqual) > 0 else 0.0
    fpr_unpriv = unpriv_nqual["_decision"].sum() / len(unpriv_nqual) if len(unpriv_nqual) > 0 else 0.0

    # Equal Opportunity Difference
    eod = tpr_unpriv - tpr_priv

    # Average Absolute Odds Difference
    aaod = (abs(tpr_unpriv - tpr_priv) + abs(fpr_unpriv - fpr_priv)) / 2

    # Theil Index (generalized entropy index with alpha=1)
    # Measures inequality in benefit distribution
    benefits = df["_decision"].astype(float).values
    mu = benefits.mean()
    if mu > 0 and mu < 1:
        theil = float(np.mean(
            benefits / mu * np.log(np.where(benefits > 0, benefits / mu, 1e-10))
        ))
    else:
        theil = 0.0

    # Overall accuracy (how well decision matches qualification)
    accuracy = (df["_decision"] == df["_qualified"]).sum() / n_total

    # Confusion matrix per group
    def confusion(group_df):
        tp = ((group_df["_decision"]) & (group_df["_qualified"])).sum()
        fp = ((group_df["_decision"]) & (~group_df["_qualified"])).sum()
        tn = ((~group_df["_decision"]) & (~group_df["_qualified"])).sum()
        fn = ((~group_df["_decision"]) & (group_df["_qualified"])).sum()
        return {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)}

    return {
        "disparate_impact": round(float(di), 4),
        "statistical_parity_difference": round(float(spd), 4),
        "equal_opportunity_difference": round(float(eod), 4),
        "avg_absolute_odds_difference": round(float(aaod), 4),
        "theil_index": round(float(theil), 4),
        "overall_accuracy": round(float(accuracy), 4),
        "selection_rate_privileged": round(float(sel_priv), 4),
        "selection_rate_unprivileged": round(float(sel_unpriv), 4),
        "tpr_privileged": round(float(tpr_priv), 4),
        "tpr_unprivileged": round(float(tpr_unpriv), 4),
        "fpr_privileged": round(float(fpr_priv), 4),
        "fpr_unprivileged": round(float(fpr_unpriv), 4),
        "n_privileged": int(n_priv),
        "n_unprivileged": int(n_unpriv),
        "n_total": int(n_total),
        "confusion_privileged": confusion(priv),
        "confusion_unprivileged": confusion(unpriv),
    }


def apply_mitigation(df: pd.DataFrame, pct: float) -> pd.DataFrame:
    """
    Reject-option classification: flip the highest-scoring denied
    unprivileged candidates to approved.
    """
    if pct <= 0:
        return df.copy()

    mitigated = df.copy()

    # Find denied unprivileged candidates, sorted by score descending
    denied_unpriv = mitigated[
        (~mitigated["_privileged"]) & (~mitigated["_decision"])
    ].sort_values("_score", ascending=False)

    flip_count = max(1, int(len(denied_unpriv) * pct / 100))
    flip_indices = denied_unpriv.head(flip_count).index

    mitigated.loc[flip_indices, "_decision"] = True

    return mitigated


def get_data_summary(df: pd.DataFrame, config: dict) -> dict:
    """Generate a summary of the uploaded dataset for the frontend."""
    sensitive = config["sensitive_attr"]
    decision = config["decision_column"]

    groups = df[sensitive].value_counts().to_dict()
    # Convert numpy types to native Python types
    groups = {str(k): int(v) for k, v in groups.items()}

    columns = []
    for col in df.columns:
        if col.startswith("_"):
            continue
        col_info = {
            "name": col,
            "dtype": str(df[col].dtype),
            "unique": int(df[col].nunique()),
            "null_count": int(df[col].isnull().sum()),
        }
        if pd.api.types.is_numeric_dtype(df[col]):
            col_info["min"] = float(df[col].min()) if not df[col].isnull().all() else None
            col_info["max"] = float(df[col].max()) if not df[col].isnull().all() else None
            col_info["mean"] = round(float(df[col].mean()), 2) if not df[col].isnull().all() else None
        columns.append(col_info)

    # Preview rows (first 15)
    preview = df.drop(columns=[c for c in df.columns if c.startswith("_")]).head(15)
    preview_rows = preview.values.tolist()
    preview_headers = list(preview.columns)

    return {
        "row_count": len(df),
        "column_count": len([c for c in df.columns if not c.startswith("_")]),
        "groups": groups,
        "columns": columns,
        "preview_headers": preview_headers,
        "preview_rows": preview_rows,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No config provided. Usage: python3 bias_engine.py '<json>'"}))
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON config: {str(e)}"}))
        sys.exit(1)

    try:
        df = load_and_validate(config)

        # Compute base metrics
        base_metrics = compute_metrics(df)

        # Data summary
        summary = get_data_summary(df, config)

        # Mitigation simulation (sweep from 0% to 100% in steps of 10)
        mitigation_pct = config.get("mitigation_pct", 0)
        mitigation_sweep = {}
        for pct_step in range(0, 101, 10):
            mit_df = apply_mitigation(df, pct_step)
            mit_metrics = compute_metrics(mit_df)
            mitigation_sweep[str(pct_step)] = mit_metrics

        # Single mitigation result if specific pct requested
        if mitigation_pct > 0:
            mit_df = apply_mitigation(df, mitigation_pct)
            mitigated_metrics = compute_metrics(mit_df)
        else:
            mitigated_metrics = base_metrics

        result = {
            "success": True,
            "metrics": base_metrics,
            "mitigated_metrics": mitigated_metrics,
            "mitigation_sweep": mitigation_sweep,
            "data_summary": summary,
            "config": {
                "sensitive_attr": config["sensitive_attr"],
                "privileged_value": config["privileged_value"],
                "decision_column": config["decision_column"],
                "qualified_column": config.get("qualified_column"),
                "mitigation_pct": mitigation_pct,
            },
        }

        print(json.dumps(result, default=str))

    except Exception as e:
        print(json.dumps({"error": str(e), "success": False}))
        sys.exit(1)


if __name__ == "__main__":
    main()
