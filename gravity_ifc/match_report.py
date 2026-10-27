"""Summarise how well the matcher did across one or more extracted JSON files.

    python match_report.py out/*.json [--csv out/match_report.csv]

Counts each distinct (material, thickness) layer once per model, weighted by
how many element instances use it, so the hit rate reflects what an engineer
would actually click through.
"""
import argparse
import csv
import json
from collections import Counter, defaultdict

STATUSES = ["matched", "suggested", "ambiguous", "no_db_row", "placeholder", "unknown"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--csv")
    ap.add_argument("--db", help="re-run the matcher on the stored layers (fast loop while tuning RULES)")
    ap.add_argument("--show", help="also list layers of this status (e.g. matched) for checking")
    a = ap.parse_args()

    matcher = None
    if a.db:
        from dl_db import load_db
        from matcher import Matcher
        matcher = Matcher(load_db(a.db))

    rows = []
    for path in a.files:
        data = json.load(open(path, encoding="utf-8"))
        model = data["source"]["file"]
        if matcher:
            for t in data["types"]:
                kind = "floor" if t["kind"] in ("floor", "roof", "ceiling") else "wall"
                for l in t["layers"]:
                    l["match"] = matcher.match(l["material"], l["thickness_in"], t["name"], kind,
                                               single_layer=len(t["layers"]) == 1).to_dict()
        seen = {}
        for t in data["types"]:
            for l in t["layers"]:
                m = l.get("match") or {}
                key = (l["material"], l["thickness_in"])
                r = seen.setdefault(key, {"model": model, "material": l["material"], "thickness_in": l["thickness_in"],
                                          "status": m.get("status"), "class": m.get("material_class"), "row": m.get("row_id"),
                                          "psf": m.get("psf"), "candidates": len(m.get("candidates") or []),
                                          "note": m.get("note"), "types": 0, "instances": 0, "example_type": t["name"]})
                r["types"] += 1
                r["instances"] += t["instances"]
        rows += seen.values()

        by_status = Counter()
        by_status_w = Counter()
        for r in seen.values():
            by_status[r["status"]] += 1
            by_status_w[r["status"]] += r["instances"]
        n, nw = sum(by_status.values()), sum(by_status_w.values())
        print(f"\n=== {model}: {n} distinct layers")
        for s in STATUSES:
            print(f"  {s:12s} {by_status[s]:4d} ({100 * by_status[s] / n:4.0f}%)   instance-weighted {100 * by_status_w[s] / nw:4.0f}%")

    print("\n=== not resolved (no pick), most used first")
    for r in sorted((r for r in rows if r["status"] in ("ambiguous", "no_db_row", "unknown", "placeholder")),
                    key=lambda r: -r["instances"])[:60]:
        t = f'{r["thickness_in"]:.3g}"' if r["thickness_in"] else "?"
        print(f'  {r["status"]:11s} {r["instances"]:5d}  {r["material"][:55]:55s} {t:>7s}  {r["class"] or "":24s} {r["note"] or ""}'[:190])

    if a.show:
        print(f"\n=== {a.show}")
        for r in sorted((r for r in rows if r["status"] == a.show), key=lambda r: (r["class"] or "", -r["instances"])):
            t = f'{r["thickness_in"]:.3g}"' if r["thickness_in"] else "?"
            print(f'  {r["instances"]:5d}  {r["material"][:50]:50s} {t:>7s} -> {r["class"] or "":22s} {r["row"] or "":5s} {r["psf"]!s:>6s} psf  {r["note"] or ""}'[:200])

    if a.csv:
        with open(a.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print("\nwrote", a.csv)


if __name__ == "__main__":
    main()
