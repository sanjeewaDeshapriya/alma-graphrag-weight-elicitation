"""
Build study material from LIVE LiteAPI data.

Pulls real Colombo hotels (image, facilities, description, price, reviews,
coordinates), derives the five ALMA composite sub-scores from those real
attributes, and assembles best-of-5 tasks whose option sets are curated to
force genuine trade-offs (no option dominating on every dimension).

Output: studies/weight-elicitation/material/study_material_v1.json (versioned).

Run (needs LITEAPI_KEY in the repo .env):
    .venv/Scripts/python.exe studies/weight-elicitation/generator/build_material.py

The five sub-scores here are derived from real attributes with a documented,
city-relative heuristic — see components(). This keeps the study self-contained
(no Neo4j) while staying faithful to what each ALMA dimension means. Swap in
graph-computed components later without changing the app.
"""
from __future__ import annotations

import argparse
import html
import json
import math
import random
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

import httpx  # noqa: E402

from src.config import LITEAPI_BASE_URL, LITEAPI_KEY  # noqa: E402
from src.ingest.liteapi import LiteApiClient  # noqa: E402

# Colombo Fort / Galle Face — the reference "city centre".
CENTER_LAT, CENTER_LNG = 6.9271, 79.8612

OUT_DEFAULT = Path(__file__).resolve().parents[1] / "material" / "study_material_v1.json"

# Facilities we surface as chips (real LiteAPI names → short label), in priority order.
FACILITY_CHIPS = [
    ("Swimming pool", "Pool"), ("Outdoor pool", "Pool"), ("Rooftop pool", "Rooftop pool"),
    ("Spa", "Spa"), ("Spa and wellness", "Spa"),
    ("Free WiFi", "Free WiFi"), ("WiFi available", "WiFi"),
    ("Fitness center", "Gym"), ("Fitness facilities", "Gym"),
    ("Restaurant", "Restaurant"), ("Bar", "Bar"), ("Room service", "Room service"),
    ("Free Parking", "Free parking"), ("Parking", "Parking"),
    ("Airport shuttle", "Airport shuttle"), ("Family rooms", "Family rooms"),
    ("Non-smoking rooms", "Non-smoking"), ("Breakfast", "Breakfast"),
    ("Air conditioning", "AC"), ("Beachfront", "Beachfront"), ("Pet friendly", "Pet friendly"),
]

SCENARIOS = [
    ("budget_backpacker", "Budget backpacker", "economic",
     "You are a solo backpacker travelling on a tight budget. You mainly need a cheap, "
     "safe place to sleep and don't mind basic facilities or being a short ride from the "
     "centre. Which hotel would you book?"),
    ("business_accessibility", "Business traveller", "accessibility",
     "You are in Colombo for two days of back-to-back meetings in the Fort business "
     "district. You want to reach your meetings quickly with the shortest, most reliable "
     "travel. Which hotel would you book?"),
    ("family_facility", "Family on holiday", "facility",
     "You are travelling with your family and young children for a short holiday. Good "
     "facilities matter most — a pool, space and amenities. Your budget is comfortable but "
     "not unlimited. Which hotel would you book?"),
    ("quiet_seeker", "Light sleeper", "disruption",
     "You are a light sleeper who dislikes traffic noise and crowds. You want a calm, "
     "peaceful stay away from the busy, noisy areas — even if it is a little further out. "
     "Which hotel would you book?"),
    ("sightseer", "City sightseer", "spatial",
     "You are a tourist who wants to be central and close to Colombo's main attractions and "
     "the seafront. Being in the middle of the action matters most. Which hotel would you "
     "book?"),
]

DIMENSIONS = ["spatial", "accessibility", "facility", "economic", "disruption"]


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #
def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_details(hotel_id: str) -> Dict[str, Any]:
    """GET /data/hotel — description + full facilities + images."""
    try:
        r = httpx.get(
            f"{LITEAPI_BASE_URL}/data/hotel",
            params={"hotelId": hotel_id},
            headers={"X-API-Key": LITEAPI_KEY, "Accept": "application/json"},
            timeout=30,
        )
        if r.status_code != 200:
            return {}
        data = r.json().get("data", {})
        return data[0] if isinstance(data, list) and data else (data or {})
    except httpx.RequestError:
        return {}


def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def short_area(address: str) -> str:
    m = re.search(r"Colombo\s*\d{1,2}", address or "", re.I)
    if m:
        return m.group(0)
    return (address or "Colombo").split(",")[0][:28]


def pick_chips(facility_names: List[str], limit: int = 6) -> List[str]:
    present = {f.strip().lower() for f in facility_names}
    chips: List[str] = []
    for real, label in FACILITY_CHIPS:
        if real.lower() in present and label not in chips:
            chips.append(label)
        if len(chips) >= limit:
            break
    return chips


def fetch_pool(city: str, fetch_n: int, pool_n: int) -> List[Dict[str, Any]]:
    client = LiteApiClient()
    try:
        body = client.search_rates(city, max_results=fetch_n)
        meta = {h.get("id"): h for h in (body.get("hotels") or []) if h.get("id")}
        rows: List[Dict[str, Any]] = []
        for entry in body.get("data") or []:
            hid = entry.get("hotelId")
            m = meta.get(hid)
            if not hid or not m:
                continue
            plans = client._extract_room_types(entry.get("roomTypes") or [])
            price = min((p["price"] for p in plans if p.get("price")), default=0)
            lat, lng = m.get("latitude"), m.get("longitude")
            if not price or lat is None or lng is None or not m.get("main_photo"):
                continue
            raw_rating = float(m.get("rating") or 0)
            rows.append({
                "id": hid,
                "name": m.get("name", "Hotel"),
                "price_lkr": round(price),
                "rating5": round(raw_rating / 2, 1) if raw_rating > 5 else round(raw_rating, 1),
                "star": int(m.get("stars") or 0),
                "review_count": int(m.get("review_count") or 0),
                "image": m.get("main_photo"),
                "address": m.get("address", ""),
                "lat": float(lat),
                "lng": float(lng),
            })
    finally:
        client.close()

    # De-dup by name, keep the better-reviewed; cap to pool_n most-reviewed for detail calls.
    seen: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = row["name"].lower()
        if key not in seen or row["review_count"] > seen[key]["review_count"]:
            seen[key] = row
    pool = sorted(seen.values(), key=lambda h: -h["review_count"])[:pool_n]

    # Enrich with details (facilities + description).
    for h in pool:
        d = fetch_details(h["id"])
        facs = [
            f.get("name") if isinstance(f, dict) else f
            for f in (d.get("hotelFacilities") or d.get("facilities") or [])
        ]
        h["facilities"] = pick_chips([f for f in facs if f], 6) or ["Free WiFi", "AC"]
        h["n_facilities"] = len([f for f in facs if f])
        h["description"] = strip_html(d.get("hotelDescription") or d.get("description") or "")[:170]
        h["distance_km"] = round(haversine_km(h["lat"], h["lng"], CENTER_LAT, CENTER_LNG), 1)
        h["area"] = short_area(h["address"])
    return pool


# --------------------------------------------------------------------------- #
# Component derivation (city-relative, all in [0,1], higher = better)
# --------------------------------------------------------------------------- #
def pct_rank(x: float, arr: List[float]) -> float:
    if not arr:
        return 0.5
    return sum(1 for v in arr if v <= x) / len(arr)


def clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def compute_components(pool: List[Dict[str, Any]]) -> None:
    prices = [h["price_lkr"] for h in pool]
    dists = [h["distance_km"] for h in pool]
    reviews = [h["review_count"] for h in pool]
    for h in pool:
        econ = 1 - pct_rank(h["price_lkr"], prices)           # cheaper → higher
        near = 1 - pct_rank(h["distance_km"], dists)          # closer to centre → higher
        far = pct_rank(h["distance_km"], dists)               # further out → higher
        star = (h["star"] or 0) / 5.0
        fac = clamp(0.45 * star + 0.35 * min(h["n_facilities"] / 40.0, 1.0)
                    + 0.20 * (h["rating5"] / 5.0))
        acc = clamp(0.7 * near + 0.3 * pct_rank(h["review_count"], reviews))
        calm = clamp(0.6 * far + 0.4 * star)                  # further + nicer → calmer (proxy)
        h["components"] = {
            "spatial": round(near, 3),
            "accessibility": round(acc, 3),
            "facility": round(fac, 3),
            "economic": round(econ, 3),
            "disruption": round(calm, 3),
        }


# --------------------------------------------------------------------------- #
# Curated trade-off set selection
# --------------------------------------------------------------------------- #
def dominates(a: Dict[str, float], b: Dict[str, float]) -> bool:
    ge = all(a[d] >= b[d] - 1e-9 for d in DIMENSIONS)
    gt = any(a[d] > b[d] + 1e-9 for d in DIMENSIONS)
    return ge and gt


def set_quality(ids: List[str], comp: Dict[str, Dict[str, float]]) -> float:
    """Higher = better: reward per-dimension spread, penalise dominance pairs."""
    spread = 0.0
    for d in DIMENSIONS:
        vals = [comp[i][d] for i in ids]
        spread += max(vals) - min(vals)
    dom = 0
    for i in ids:
        for j in ids:
            if i != j and dominates(comp[i], comp[j]):
                dom += 1
    return spread - 0.6 * dom


def curate_task(pool_ids: List[str], comp: Dict[str, Dict[str, float]],
                rng: random.Random, k: int = 5, tries: int = 400) -> List[str]:
    best, best_q = pool_ids[:k], -1e9
    for _ in range(tries):
        cand = rng.sample(pool_ids, k)
        q = set_quality(cand, comp)
        if q > best_q:
            best, best_q = cand, q
    return best


# --------------------------------------------------------------------------- #
def build(city: str, fetch_n: int, pool_n: int, seed: int, out: Path) -> None:
    rng = random.Random(seed)
    print(f"LiteAPI · fetching up to {fetch_n} {city} hotels (pool {pool_n})…")
    pool = fetch_pool(city, fetch_n, pool_n)
    if len(pool) < 6:
        raise SystemExit(f"Only {len(pool)} usable hotels — need at least 6.")
    compute_components(pool)
    comp = {h["id"]: h["components"] for h in pool}
    pool_ids = [h["id"] for h in pool]
    print(f"  built pool of {len(pool)} hotels with real images + facilities")

    hotels_out = {
        h["id"]: {
            "name": h["name"],
            "attributes": {
                "price_lkr": h["price_lkr"],
                "rating": h["rating5"],
                "review_count": h["review_count"],
                "star": h["star"],
                "distance_km": h["distance_km"],
                "amenities": h["facilities"],
                "area": h["area"],
                "image": h["image"],
                "description": h["description"],
            },
            "components": h["components"],
        }
        for h in pool
    }

    tasks = []
    for i, (sid, _persona, _dim, _ctx) in enumerate(SCENARIOS, start=1):
        opts = curate_task(pool_ids, comp, rng)
        tasks.append({"id": f"t{i}", "scenario_id": sid,
                      "is_attention_check": False, "option_ids": opts})

    # Attention check: 5 real hotels, answer = a named one.
    attn = rng.sample(pool_ids, 5)
    answer = attn[2]
    tasks.append({"id": f"t{len(SCENARIOS)+1}", "scenario_id": "attention",
                  "is_attention_check": True, "attention_answer_hotel_id": answer,
                  "option_ids": attn})

    scenarios_out = [
        {"id": sid, "persona": persona, "primary_dimension": dim, "context": ctx}
        for (sid, persona, dim, ctx) in SCENARIOS
    ]
    scenarios_out.append({
        "id": "attention", "persona": "Attention check", "primary_dimension": "attention",
        "context": f'This is an attention check. Please ignore your own preferences and '
                   f'simply select the hotel named "{hotels_out[answer]["name"]}".',
    })

    material = {
        "version": f"v2-liteapi-{datetime.utcnow().strftime('%Y%m%d')}",
        "city": city,
        "source": "liteapi",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "dimensions": DIMENSIONS,
        "hotels": hotels_out,
        "scenarios": scenarios_out,
        "tasks": tasks,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(material, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}  (version {material['version']}, {len(pool)} hotels, "
          f"{len(tasks)} tasks)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="Colombo")
    ap.add_argument("--fetch", type=int, default=40, help="hotels to request from LiteAPI")
    ap.add_argument("--pool", type=int, default=16, help="hotels to keep (detail calls)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = ap.parse_args()
    if not LITEAPI_KEY:
        raise SystemExit("LITEAPI_KEY not set in repo .env")
    build(args.city, args.fetch, args.pool, args.seed, args.out)


if __name__ == "__main__":
    main()
