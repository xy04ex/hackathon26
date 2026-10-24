#!/usr/bin/env python3
"""
fetch_cdc.py — download CDC PLACES "short sleep duration among adults" for
Massachusetts counties, once, and commit the small result as static JSON.

Source: CDC PLACES (data.cdc.gov), dataset swc5-untb, measure
"Short sleep duration among adults" (share of adults sleeping < 7 hours),
crude prevalence. Used only as neutral context on the insights page, never as
a judgement of the user.

Writes:
    data/cdc-short-sleep-ma.json  (committed; public CDC data, not personal)

Standard library only (urllib). Run once; re-run to refresh.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

BASE = "https://data.cdc.gov/resource/swc5-untb.json"

PARAMS = {
    "$select": (
        "year,locationname,data_value,low_confidence_limit,"
        "high_confidence_limit,totalpopulation"
    ),
    "stateabbr": "MA",
    "measure": "Short sleep duration among adults",
    "data_value_type": "Crude prevalence",
    "$limit": "50",
}

CITATION = (
    "CDC PLACES: Local Data for Better Health, County Data 2024 release "
    "(measure: short sleep duration among adults, crude prevalence, 2022). "
    "https://data.cdc.gov/resource/swc5-untb"
)


def fetch():
    url = BASE + "?" + urllib.parse.urlencode(PARAMS)
    req = urllib.request.Request(url, headers={"User-Agent": "huifan/1.0"})

    # Use a proper verified TLS context. On some macOS Python builds the system
    # roots aren't wired up; if `certifi` is installed, use its bundle. We never
    # silently disable verification.
    ctx = None
    try:
        import ssl
        import certifi  # optional; pip install certifi if TLS fails
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = None  # fall back to Python's default verified context

    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        raw = json.load(resp)
    return raw


def normalize(raw):
    """Keep the counties, coerce numerics, sort by county name."""
    counties = []
    for r in raw:
        name = r.get("locationname")
        val = r.get("data_value")
        if name is None or val is None:
            continue
        counties.append({
            "county": name,
            "year": int(r["year"]) if r.get("year") else None,
            "pct_short_sleep": float(val),
            "ci_low": _f(r.get("low_confidence_limit")),
            "ci_high": _f(r.get("high_confidence_limit")),
            "population": int(r["totalpopulation"]) if r.get("totalpopulation") else None,
        })
    counties.sort(key=lambda c: c["county"])
    return counties


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def main():
    try:
        raw = fetch()
    except Exception as e:  # network/endpoint issues
        print(f"Failed to fetch CDC data: {e}", file=sys.stderr)
        return 1

    counties = normalize(raw)
    out = {
        "measure": "Short sleep duration among adults (< 7 hours)",
        "state": "Massachusetts",
        "data_value_type": "Crude prevalence",
        "citation": CITATION,
        "counties": counties,
    }

    os.makedirs("data", exist_ok=True)
    out_path = os.path.join("data", "cdc-short-sleep-ma.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(counties)} MA counties to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
