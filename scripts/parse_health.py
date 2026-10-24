#!/usr/bin/env python3
"""
parse_health.py — turn an Apple Health export into a small daily.json.

Usage:
    python3 scripts/parse_health.py export.zip
    python3 scripts/parse_health.py apple_health_export/export.xml
    python3 scripts/parse_health.py            # auto-find export.zip or export.xml

Input (one of):
    - export.zip      : the file the iPhone Health app produces
    - export.xml      : already-unzipped Apple Health export

Output:
    data/daily.json   : a list of
        { "date": "YYYY-MM-DD",
          "hrv":  number|null,   # HRV SDNN (ms), daily mean
          "rhr":  number|null,   # resting heart rate (bpm), daily mean
          "resp": number|null,   # respiratory rate (breaths/min), daily mean
          "sleep_h": number|null # hours asleep that night, overlaps merged
        }
      sorted by date. Missing values are null, never 0.

Standard library only. export.xml can be hundreds of MB, so we stream it with
iterparse and clear each element as we go — we never hold the whole file.
Real exports must never be committed; see .gitignore.
"""

import sys
import os
import json
import zipfile
from datetime import datetime, date
from xml.etree.ElementTree import iterparse

# Apple Health record type identifiers.
HRV_TYPE = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
RHR_TYPE = "HKQuantityTypeIdentifierRestingHeartRate"
RESP_TYPE = "HKQuantityTypeIdentifierRespiratoryRate"
SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis"

# Sleep category values that count as "asleep". We ignore InBed and Awake.
# Newer exports use the "AsleepCore/Deep/REM" split; older ones use "Asleep".
ASLEEP_VALUES = {
    "HKCategoryValueSleepAnalysisAsleep",
    "HKCategoryValueSleepAnalysisAsleepCore",
    "HKCategoryValueSleepAnalysisAsleepDeep",
    "HKCategoryValueSleepAnalysisAsleepREM",
    "HKCategoryValueSleepAnalysisAsleepUnspecified",
}

# Hour-of-day cutoff for assigning a sleep interval to a night. An interval
# whose end time is at or before 18:00 is treated as a nap/belonging to that
# same calendar day's "wake"; anything ending after 18:00 is assigned to the
# next calendar day (you wake up the next morning). In practice Apple already
# gives end times in the morning, so the end date is the wake date for normal
# overnight sleep. We assign by the interval's END (wake) date.


def parse_apple_datetime(s):
    """Parse an Apple Health timestamp like '2024-03-01 07:30:00 -0500'.

    Returns a timezone-aware datetime. Raises ValueError on bad input so the
    caller can skip the record rather than crash the whole parse.
    """
    # Format is always "%Y-%m-%d %H:%M:%S %z" in Apple exports.
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S %z")


def merge_intervals(intervals):
    """Merge overlapping (start, end) datetime intervals.

    Input need not be sorted. Returns total non-overlapping duration in
    seconds, so sleep recorded by two sources (watch + phone) is not
    double-counted.
    """
    if not intervals:
        return 0.0
    intervals = sorted(intervals, key=lambda iv: iv[0])
    total = 0.0
    cur_start, cur_end = intervals[0]
    for start, end in intervals[1:]:
        if start <= cur_end:
            # Overlapping or touching — extend the current block.
            if end > cur_end:
                cur_end = end
        else:
            total += (cur_end - cur_start).total_seconds()
            cur_start, cur_end = start, end
    total += (cur_end - cur_start).total_seconds()
    return total


def sleep_night_date(start_dt, end_dt):
    """Decide which calendar date a sleep interval belongs to (wake date).

    We assign by the end (wake) time: the date you woke up. A short daytime
    nap ending before 18:00 stays on its own day; overnight sleep ending in
    the morning is naturally assigned to that morning's date.
    """
    return end_dt.date()


def resolve_input(arg):
    """Return a readable file object + a flag saying whether it's a zip member.

    Accepts an explicit path, or auto-detects export.zip / export.xml in the
    current directory. Raises FileNotFoundError with a clear message if nothing
    is found.
    """
    candidates = []
    if arg:
        candidates = [arg]
    else:
        # Auto-detect in common locations.
        candidates = [
            "export.zip",
            "export.xml",
            os.path.join("apple_health_export", "export.xml"),
        ]

    for path in candidates:
        if os.path.exists(path):
            return path
    raise FileNotFoundError(
        "Could not find an Apple Health export. Pass a path, e.g.\n"
        "    python3 scripts/parse_health.py export.zip\n"
        f"Looked for: {', '.join(candidates)}"
    )


def open_xml_stream(path):
    """Yield a file-like object for the export.xml, whether zipped or not.

    Returns (stream, close_fn). The caller must call close_fn when done.
    """
    if path.endswith(".zip"):
        zf = zipfile.ZipFile(path)
        # Find the export.xml inside; Apple nests it under apple_health_export/.
        member = None
        for name in zf.namelist():
            if name.endswith("export.xml"):
                member = name
                break
        if member is None:
            zf.close()
            raise ValueError(f"No export.xml found inside {path}")
        stream = zf.open(member)
        return stream, (lambda: (stream.close(), zf.close()))
    else:
        stream = open(path, "rb")
        return stream, stream.close


def parse(path):
    """Stream the export and build per-day aggregates.

    Returns a dict keyed by 'YYYY-MM-DD' with raw accumulators we later
    reduce to single values.
    """
    # Per-day accumulators for the three quantity metrics (lists of floats).
    hrv_vals = {}
    rhr_vals = {}
    resp_vals = {}
    # Per-day list of (start, end) sleep intervals, merged later.
    sleep_intervals = {}

    stream, close_fn = open_xml_stream(path)
    try:
        # iterparse with "end" events: process each Record when it closes,
        # then clear it so memory does not grow with the file.
        context = iterparse(stream, events=("end",))
        for event, elem in context:
            if elem.tag != "Record":
                continue
            rtype = elem.get("type")

            try:
                if rtype == HRV_TYPE:
                    _accumulate_quantity(elem, hrv_vals)
                elif rtype == RHR_TYPE:
                    _accumulate_quantity(elem, rhr_vals)
                elif rtype == RESP_TYPE:
                    _accumulate_quantity(elem, resp_vals)
                elif rtype == SLEEP_TYPE:
                    _accumulate_sleep(elem, sleep_intervals)
            except (ValueError, TypeError):
                # Skip malformed records rather than aborting the whole parse.
                pass

            # Free the element (and any children) to keep memory flat.
            elem.clear()
    finally:
        close_fn()

    return hrv_vals, rhr_vals, resp_vals, sleep_intervals


def _accumulate_quantity(elem, store):
    """Record a numeric quantity value under its start-date day."""
    value = float(elem.get("value"))
    start = parse_apple_datetime(elem.get("startDate"))
    day = start.date().isoformat()
    store.setdefault(day, []).append(value)


def _accumulate_sleep(elem, store):
    """Record a sleep interval under its wake-date day, asleep stages only."""
    if elem.get("value") not in ASLEEP_VALUES:
        return
    start = parse_apple_datetime(elem.get("startDate"))
    end = parse_apple_datetime(elem.get("endDate"))
    if end <= start:
        return
    day = sleep_night_date(start, end).isoformat()
    store.setdefault(day, []).append((start, end))


def mean_or_none(values):
    """Daily mean of a list, or None if empty. Never returns 0 for 'missing'."""
    return round(sum(values) / len(values), 2) if values else None


def build_daily(hrv_vals, rhr_vals, resp_vals, sleep_intervals):
    """Reduce accumulators into the sorted daily.json list."""
    all_days = set()
    all_days.update(hrv_vals, rhr_vals, resp_vals, sleep_intervals)

    rows = []
    for day in sorted(all_days):
        sleep_seconds = merge_intervals(sleep_intervals.get(day, []))
        sleep_h = round(sleep_seconds / 3600.0, 2) if sleep_seconds > 0 else None
        rows.append(
            {
                "date": day,
                "hrv": mean_or_none(hrv_vals.get(day, [])),
                "rhr": mean_or_none(rhr_vals.get(day, [])),
                "resp": mean_or_none(resp_vals.get(day, [])),
                "sleep_h": sleep_h,
            }
        )
    return rows


def main(argv):
    arg = argv[1] if len(argv) > 1 else None
    try:
        path = resolve_input(arg)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    print(f"Reading {path} ...", file=sys.stderr)
    hrv_vals, rhr_vals, resp_vals, sleep_intervals = parse(path)
    rows = build_daily(hrv_vals, rhr_vals, resp_vals, sleep_intervals)

    out_dir = "data"
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "daily.json")
    with open(out_path, "w") as f:
        json.dump(rows, f, indent=2)
        f.write("\n")

    print(
        f"Wrote {len(rows)} days to {out_path} "
        f"(HRV days: {len(hrv_vals)}, RHR: {len(rhr_vals)}, "
        f"resp: {len(resp_vals)}, sleep nights: {len(sleep_intervals)})",
        file=sys.stderr,
    )
    print("Reminder: data/daily.json is git-ignored — it is your real data.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
