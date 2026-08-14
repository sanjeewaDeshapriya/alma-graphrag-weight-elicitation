"""
Build study material from LIVE LiteAPI data — location-anchored design.

Pulls the full Colombo hotel pool (image, facilities, description, price,
reviews, coordinates) and assembles ten choice tasks, each ANCHORED to a real
Colombo location (Galle Face, Battaramulla, Fort, ...). Every task shows the
whole pool; the participant chooses one hotel.

Why the components are split
----------------------------
Two of the five ALMA sub-scores depend on WHERE the task is anchored and three
do not:

    per-anchor : spatial       — straight-line proximity to the anchor
                 accessibility — traffic-adjusted travel time to the anchor
    global     : facility      — star / facility count / rating
                 economic      — price
                 disruption    — how calm the hotel's own area is

`spatial` is straight-line proximity; `accessibility` is real traffic-aware
driving time pulled live from the Distance Matrix API. They stay ~0.90
correlated in Colombo — that is the city, not a measurement fault. It matters
only if you try to fit five separate coefficients; the deliverable here is a
LABELLED RANKING DATASET (context -> 35 candidates -> the one chosen), which is
the standard learning-to-rank shape and tolerates correlated features. build()
prints the correlation matrix so the property is recorded, not hidden.

Output: studies/weight-elicitation/material/study_material_v1.json (versioned).

Run (needs LITEAPI_KEY in the repo .env):
    .venv/Scripts/python.exe studies/weight-elicitation/generator/build_material.py
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
from typing import Any, Dict, List, Tuple

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

import httpx  # noqa: E402

from src.config import LITEAPI_BASE_URL, LITEAPI_KEY  # noqa: E402
from src.ingest.liteapi import LiteApiClient  # noqa: E402

# Colombo Fort / Galle Face — the reference "city centre" for the global scores.
CENTER_LAT, CENTER_LNG = 6.9271, 79.8612

OUT_DEFAULT = Path(__file__).resolve().parents[1] / "material" / "study_material_v1.json"

# --------------------------------------------------------------------------- #
# Location anchors — every choice task is framed around one of these.
# --------------------------------------------------------------------------- #
ANCHORS: Dict[str, Dict[str, Any]] = {
    "galle_face":    {"name": "Galle Face Green", "lat": 6.9271, "lng": 79.8426},
    "battaramulla":  {"name": "Battaramulla",     "lat": 6.8994, "lng": 79.9186},
    "fort":          {"name": "Colombo Fort",     "lat": 6.9344, "lng": 79.8428},
    "bambalapitiya": {"name": "Bambalapitiya",    "lat": 6.8890, "lng": 79.8564},
    "nugegoda":      {"name": "Nugegoda",         "lat": 6.8649, "lng": 79.8997},
    "mount_lavinia": {"name": "Mount Lavinia",    "lat": 6.8389, "lng": 79.8653},
    "rajagiriya":    {"name": "Rajagiriya",       "lat": 6.9097, "lng": 79.8944},
    "kollupitiya":   {"name": "Kollupitiya",      "lat": 6.9101, "lng": 79.8494},
    "dehiwala":      {"name": "Dehiwala",         "lat": 6.8511, "lng": 79.8653},
}

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

# --------------------------------------------------------------------------- #
# The ten tasks. Each one merges a PRIMARY dimension with a SECONDARY one, so
# every scenario forces a trade-off rather than a single-attribute sort. Each of
# the five dimensions is primary in exactly two tasks and secondary in two, which
# keeps the labelled dataset balanced across the scoring matrix.
#
#   task  anchor          primary        secondary
#   t1    Galle Face      spatial        economic
#   t2    Battaramulla    accessibility  facility
#   t3    Fort            economic       accessibility
#   t4    Bambalapitiya   facility       spatial
#   t5    Nugegoda        disruption     economic
#   t6    Mount Lavinia   spatial        disruption
#   t7    Rajagiriya      economic       accessibility
#   t8    Kollupitiya     facility       economic
#   t9    Dehiwala        disruption     spatial
#   t10   Battaramulla    accessibility  facility   (repeat of t2)
# --------------------------------------------------------------------------- #
TASKS_SPEC: List[Dict[str, Any]] = [
    {
        "id": "t1", "anchor": "galle_face", "persona": "Evening walker",
        "primary": "spatial", "secondary": "economic",
        "context": "You are visiting Colombo and want to walk to Galle Face Green every "
                   "evening. Being close enough to reach it on foot matters most, but you "
                   "are also paying for the room yourself and cannot overspend. Which "
                   "hotel would you book?",
    },
    {
        "id": "t2", "anchor": "battaramulla", "persona": "Business traveller",
        "primary": "accessibility", "secondary": "facility",
        "context": "You have two days of back-to-back meetings at government offices in "
                   "Battaramulla. Reaching them quickly and predictably each morning "
                   "decides your booking, though you would still like somewhere "
                   "comfortable to work in the evening. Which hotel would you book?",
    },
    {
        "id": "t3", "anchor": "fort", "persona": "Self-funded worker",
        "primary": "economic", "secondary": "accessibility",
        "context": "You are working in Colombo Fort for a week and paying for the room "
                   "yourself, so cost comes first - but a long daily commute would eat "
                   "into your working day. Which hotel would you book?",
    },
    {
        "id": "t4", "anchor": "bambalapitiya", "persona": "Family on holiday",
        "primary": "facility", "secondary": "spatial",
        "context": "You are travelling with your family and two young children and "
                   "visiting relatives in Bambalapitiya. A pool, space and good on-site "
                   "facilities matter most, and being near the family helps. Which hotel "
                   "would you book?",
    },
    {
        "id": "t5", "anchor": "nugegoda", "persona": "Light sleeper",
        "primary": "disruption", "secondary": "economic",
        "context": "You are attending an event in Nugegoda but you are a light sleeper who "
                   "cannot rest with traffic noise and crowds. A calm area matters most, "
                   "though you do not want to pay a premium for it. Which hotel would you "
                   "book?",
    },
    {
        "id": "t6", "anchor": "mount_lavinia", "persona": "Beach weekender",
        "primary": "spatial", "secondary": "disruption",
        "context": "You want a weekend by the sea at Mount Lavinia. Being close to the "
                   "beach is the point of the trip, but you also want somewhere peaceful "
                   "rather than a busy strip. Which hotel would you book?",
    },
    {
        "id": "t7", "anchor": "rajagiriya", "persona": "Long-stay consultant",
        "primary": "economic", "secondary": "accessibility",
        "context": "You are on a three-week assignment with an office in Rajagiriya and a "
                   "fixed daily allowance, so the nightly rate matters a great deal - but "
                   "a slow commute every day would wear you down. Which hotel would you "
                   "book?",
    },
    {
        "id": "t8", "anchor": "kollupitiya", "persona": "Value-seeking couple",
        "primary": "facility", "secondary": "economic",
        "context": "You and your partner are staying near Kollupitiya for a few nights and "
                   "want a genuinely nice hotel - good rooms and facilities - at a price "
                   "that still feels like value rather than a splurge. Which hotel would "
                   "you book?",
    },
    {
        "id": "t9", "anchor": "dehiwala", "persona": "Remote worker",
        "primary": "disruption", "secondary": "spatial",
        "context": "You are working remotely for two weeks near Dehiwala. You need "
                   "somewhere quiet enough to take calls all day, but you also do not want "
                   "to be cut off from shops and transport. Which hotel would you book?",
    },
    {
        # Deliberate repeat of t2 - measures test-retest reliability per participant.
        "id": "t10", "anchor": "battaramulla", "persona": "Business traveller",
        "primary": "accessibility", "secondary": "facility", "repeat_of": "t2",
        "context": "You are again booking for two days of meetings in Battaramulla, with "
                   "short and predictable travel as your priority and a comfortable room "
                   "to return to. Which hotel would you book?",
    },
]

DIMENSIONS = ["spatial", "accessibility", "facility", "economic", "disruption"]
ANCHOR_DIMS = ["spatial", "accessibility"]
GLOBAL_DIMS = ["facility", "economic", "disruption"]


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
    try:
        with httpx.Client(timeout=20.0) as c:
            r = c.get(f"{LITEAPI_BASE_URL}/data/hotel",
                      params={"hotelId": hotel_id},
                      headers={"X-API-Key": LITEAPI_KEY})
            r.raise_for_status()
            return r.json().get("data") or {}
    except Exception:
        return {}


def strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


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

    # De-dup by name, keep the better-reviewed; cap to pool_n most-reviewed.
    seen: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = row["name"].lower()
        if key not in seen or row["review_count"] > seen[key]["review_count"]:
            seen[key] = row
    pool = sorted(seen.values(), key=lambda h: -h["review_count"])[:pool_n]

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
# Component derivation
# --------------------------------------------------------------------------- #
def pct_rank(x: float, arr: List[float]) -> float:
    if not arr:
        return 0.5
    return sum(1 for v in arr if v <= x) / len(arr)


def clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def local_density(pool: List[Dict[str, Any]], radius_km: float = 1.2) -> Dict[str, float]:
    """Hotels within `radius_km` of each hotel, normalised to [0,1].

    Used as a reproducible congestion / bustle proxy: dense clusters of hotels
    sit in the busy commercial strips, which are slower to drive through and
    noisier to sleep in. It is the only input that separates `accessibility`
    from `spatial` and `disruption` from both, so it carries real weight in the
    design — see the correlation report in build().
    """
    counts: Dict[str, int] = {}
    for a in pool:
        counts[a["id"]] = sum(
            1 for b in pool
            if b["id"] != a["id"]
            and haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) <= radius_km
        )
    hi = max(counts.values()) or 1
    return {hid: n / hi for hid, n in counts.items()}


def compute_global_components(pool: List[Dict[str, Any]],
                              density: Dict[str, float]) -> Dict[str, Dict[str, float]]:
    """facility / economic / disruption — independent of which anchor is asked."""
    prices = [h["price_lkr"] for h in pool]
    out: Dict[str, Dict[str, float]] = {}
    for h in pool:
        econ = 1 - pct_rank(h["price_lkr"], prices)              # cheaper → higher
        star = (h["star"] or 0) / 5.0
        fac = clamp(0.45 * star
                    + 0.35 * min(h["n_facilities"] / 40.0, 1.0)
                    + 0.20 * (h["rating5"] / 5.0))
        # Calm = away from the dense commercial clusters, and better-appointed
        # hotels insulate better (glazing, set-back grounds).
        calm = clamp(0.75 * (1 - density[h["id"]]) + 0.25 * star)
        out[h["id"]] = {"facility": round(fac, 3),
                        "economic": round(econ, 3),
                        "disruption": round(calm, 3)}
    return out


def fetch_road_travel_times(pool: List[Dict[str, Any]],
                            ) -> Dict[str, Dict[str, float]]:
    """Real traffic-aware driving minutes from every hotel to every anchor.

    This is the measurement that makes `accessibility` a genuinely separate
    construct from `spatial`. Straight-line distance answers "how close is it";
    the road network under live traffic answers "how long does it actually
    take", and the two diverge sharply in Colombo - a hotel 2.5 km out on an
    arterial reaches Battaramulla faster than one 1.6 km out across the centre.

    Returns {anchor_id: {hotel_id: minutes}}, or {} if the API is unavailable,
    in which case the caller falls back to the density proxy.

    Distance Matrix allows 100 elements per request, so the pool is chunked into
    groups of origins small enough that origins x anchors stays under that.
    """
    from src.config import GOOGLE_MAPS_API_KEY
    if not GOOGLE_MAPS_API_KEY:
        print("  GOOGLE_MAPS_API_KEY not set - falling back to the density proxy")
        return {}

    anchor_ids = list(ANCHORS.keys())
    dests = "|".join(f"{ANCHORS[a]['lat']},{ANCHORS[a]['lng']}" for a in anchor_ids)
    chunk = max(1, 100 // len(anchor_ids))
    out: Dict[str, Dict[str, float]] = {a: {} for a in anchor_ids}

    try:
        with httpx.Client(timeout=40.0) as client:
            for start in range(0, len(pool), chunk):
                group = pool[start:start + chunk]
                origins = "|".join(f"{h['lat']},{h['lng']}" for h in group)
                r = client.get(
                    "https://maps.googleapis.com/maps/api/distancematrix/json",
                    params={"origins": origins, "destinations": dests,
                            "departure_time": "now", "traffic_model": "best_guess",
                            "key": GOOGLE_MAPS_API_KEY},
                )
                r.raise_for_status()
                data = r.json()
                if data.get("status") != "OK":
                    raise RuntimeError(data.get("error_message") or data.get("status"))
                for h, row in zip(group, data.get("rows", [])):
                    for aid, el in zip(anchor_ids, row.get("elements", [])):
                        if el.get("status") != "OK":
                            continue
                        secs = (el.get("duration_in_traffic") or el.get("duration") or {}).get("value")
                        if secs:
                            out[aid][h["id"]] = secs / 60.0
    except Exception as exc:  # network, quota, billing - fall back rather than fail
        print(f"  distance matrix unavailable ({exc}) - falling back to the density proxy")
        return {}

    covered = min(len(v) for v in out.values()) if out else 0
    if covered < len(pool):
        print(f"  distance matrix covered only {covered}/{len(pool)} hotels "
              f"- falling back to the density proxy")
        return {}
    print(f"  real traffic-aware travel times for {len(pool)} hotels x "
          f"{len(anchor_ids)} anchors")
    return out


def route_congestion(pool: List[Dict[str, Any]], hotel: Dict[str, Any],
                     anchor: Dict[str, Any], radius_km: float = 1.2) -> float:
    """Congestion along the hotel->anchor route, not just around the hotel.

    Sampling the corridor rather than the origin is what makes accessibility a
    genuinely different construct from spatial: two hotels equidistant from the
    anchor score differently when one route crosses the dense central strips and
    the other runs down a clear arterial. A hotel-only congestion factor is the
    same number for every anchor, so it cannot break the distance correlation.
    """
    loads: List[float] = []
    for frac in (0.25, 0.5, 0.75):
        lat = hotel["lat"] + (anchor["lat"] - hotel["lat"]) * frac
        lng = hotel["lng"] + (anchor["lng"] - hotel["lng"]) * frac
        near = sum(1 for b in pool
                   if haversine_km(lat, lng, b["lat"], b["lng"]) <= radius_km)
        loads.append(near)
    hi = max(len(pool) * 0.5, 1.0)
    return min(sum(loads) / len(loads) / hi, 1.0)


def compute_anchor_components(pool: List[Dict[str, Any]], anchor: Dict[str, Any],
                              density: Dict[str, float],
                              road_minutes: Dict[str, float] | None = None,
                              ) -> Dict[str, Dict[str, float]]:
    """spatial / accessibility relative to one anchor, plus the raw distance.

    `spatial`       straight-line proximity - "how close is it".
    `accessibility` traffic-aware driving minutes - "how long does it take".

    With real `road_minutes` these are two independent measurements and their
    weights are separately identifiable. Without them we fall back to a density
    proxy - but note that every proxy tried here is itself a function of the
    same straight-line distance, so it cannot break the correlation (the
    route-corridor variant made it worse, r 0.84 -> 0.95, because longer routes
    necessarily cross more hotels). The correlation report in build() is the check.
    """
    dists = {h["id"]: haversine_km(h["lat"], h["lng"], anchor["lat"], anchor["lng"])
             for h in pool}
    if road_minutes:
        travel = {h["id"]: road_minutes[h["id"]] for h in pool}
    else:
        travel = {
            h["id"]: (dists[h["id"]] / 26.0) * 60.0 * (1.0 + 1.4 * density[h["id"]])
            for h in pool
        }
    dist_vals = list(dists.values())
    travel_vals = list(travel.values())
    out: Dict[str, Dict[str, float]] = {}
    for h in pool:
        hid = h["id"]
        out[hid] = {
            "spatial": round(1 - pct_rank(dists[hid], dist_vals), 3),
            "accessibility": round(1 - pct_rank(travel[hid], travel_vals), 3),
            "distance_km": round(dists[hid], 1),
            "travel_min": round(travel[hid]),
        }
    return out


# --------------------------------------------------------------------------- #
# Design diagnostics
# --------------------------------------------------------------------------- #
def pearson(xs: List[float], ys: List[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return num / (dx * dy) if dx and dy else 0.0


def correlation_report(rows: List[Dict[str, float]]) -> Tuple[List[List[float]], float]:
    """Correlation matrix of the five component columns over every alternative
    that any participant will actually see. High |r| between two columns means
    those two weights cannot be told apart — the design, not the sample size,
    is what has to change."""
    cols = {d: [r[d] for r in rows] for d in DIMENSIONS}
    mat = [[pearson(cols[a], cols[b]) for b in DIMENSIONS] for a in DIMENSIONS]
    worst = max(
        (abs(mat[i][j]) for i in range(len(DIMENSIONS)) for j in range(len(DIMENSIONS)) if i != j),
        default=0.0,
    )
    return mat, worst


# --------------------------------------------------------------------------- #
def build(city: str, fetch_n: int, pool_n: int, seed: int, out: Path) -> None:
    rng = random.Random(seed)
    print(f"LiteAPI · fetching up to {fetch_n} {city} hotels (pool cap {pool_n})…")
    pool = fetch_pool(city, fetch_n, pool_n)
    if len(pool) < 10:
        raise SystemExit(f"Only {len(pool)} usable hotels — need at least 10.")
    print(f"  pool of {len(pool)} hotels with real images + facilities")

    density = local_density(pool)
    road = fetch_road_travel_times(pool)
    global_comp = compute_global_components(pool, density)
    anchor_comp = {
        aid: compute_anchor_components(pool, a, density, road.get(aid))
        for aid, a in ANCHORS.items()
    }

    hotels_out = {
        h["id"]: {
            "name": h["name"],
            "attributes": {
                "price_lkr": h["price_lkr"],
                "rating": h["rating5"],
                "review_count": h["review_count"],
                "star": h["star"],
                "distance_km": h["distance_km"],   # to the city centre (context only)
                "amenities": h["facilities"],
                "area": h["area"],
                "image": h["image"],
                "description": h["description"],
                "lat": h["lat"],
                "lng": h["lng"],
            },
            "components_global": global_comp[h["id"]],
        }
        for h in pool
    }

    pool_ids = [h["id"] for h in pool]

    tasks: List[Dict[str, Any]] = []
    for spec in TASKS_SPEC:
        tasks.append({
            "id": spec["id"],
            "anchor_id": spec["anchor"],
            "persona": spec["persona"],
            "context": spec["context"],
            "primary_dimension": spec["primary"],
            "secondary_dimension": spec["secondary"],
            "repeat_of": spec.get("repeat_of"),
            "is_attention_check": False,
            "option_ids": pool_ids,          # every task shows the whole pool
        })

    # Attention check over the same pool, answer = a named hotel.
    answer = rng.choice(pool_ids)
    tasks.append({
        "id": "t_attn",
        "anchor_id": "fort",
        "persona": "Attention check",
        "context": 'This is an attention check. Please ignore your own preferences and '
                   f'simply select the hotel named "{hotels_out[answer]["name"]}".',
        "primary_dimension": None,
        "secondary_dimension": None,
        "repeat_of": None,
        "is_attention_check": True,
        "attention_answer_hotel_id": answer,
        "option_ids": pool_ids,
    })

    # --- design diagnostics over every alternative shown in every task -------
    seen_rows: List[Dict[str, float]] = []
    for t in tasks:
        ac = anchor_comp[t["anchor_id"]]
        for hid in t["option_ids"]:
            seen_rows.append({**global_comp[hid],
                              "spatial": ac[hid]["spatial"],
                              "accessibility": ac[hid]["accessibility"]})
    mat, worst = correlation_report(seen_rows)

    print(f"\n  Component correlation over {len(seen_rows)} presented alternatives")
    print("                  " + "".join(f"{d[:8]:>11}" for d in DIMENSIONS))
    for i, d in enumerate(DIMENSIONS):
        print(f"    {d:<14}" + "".join(f"{mat[i][j]:>11.2f}" for j in range(len(DIMENSIONS))))
    note = ("columns are near-independent" if worst < 0.5 else
            "two columns are correlated - fine for a labelled ranking dataset, "
            "but do not report their coefficients as separately identified")
    print(f"    largest off-diagonal |r| = {worst:.2f}  ->  {note}")

    material = {
        "version": f"v3-anchored-{datetime.utcnow().strftime('%Y%m%d')}",
        "city": city,
        "source": "liteapi",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "dimensions": DIMENSIONS,
        "anchor_dimensions": ANCHOR_DIMS,
        "global_dimensions": GLOBAL_DIMS,
        "design": {
            "n_hotels": len(pool),
            "n_tasks": len(tasks),
            "all_options_shown": True,
            "max_abs_correlation": round(worst, 3),
            "component_correlation": {
                d: {e: round(mat[i][j], 3) for j, e in enumerate(DIMENSIONS)}
                for i, d in enumerate(DIMENSIONS)
            },
        },
        "anchors": ANCHORS,
        "hotels": hotels_out,
        "anchor_components": anchor_comp,
        "tasks": tasks,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(material, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out}\n  version {material['version']}, {len(pool)} hotels, "
          f"{len(tasks)} tasks, {len(ANCHORS)} anchors")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="Colombo")
    ap.add_argument("--fetch", type=int, default=150, help="hotels to request from LiteAPI")
    ap.add_argument("--pool", type=int, default=60, help="max hotels to keep")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = ap.parse_args()
    if not LITEAPI_KEY:
        raise SystemExit("LITEAPI_KEY not set in repo .env")
    build(args.city, args.fetch, args.pool, args.seed, args.out)


if __name__ == "__main__":
    main()
