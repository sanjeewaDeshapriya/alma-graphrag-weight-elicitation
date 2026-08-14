"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DisplayTask, DisplayOption } from "@/lib/material";

interface Props {
  tasks: DisplayTask[];
}

type SortKey = "distance" | "travel" | "price_asc" | "price_desc" | "rating";

const SORT_LABELS: Record<SortKey, string> = {
  distance: "Nearest first",
  travel: "Fastest to reach",
  price_asc: "Cheapest first",
  price_desc: "Most expensive first",
  rating: "Highest rated",
};

/** One recorded UI action. The order and timing of these is data, not telemetry:
 *  a participant who sorts by price before choosing is telling us something the
 *  final click alone does not. */
interface Interaction {
  at_ms: number;
  kind: "search" | "sort" | "price_filter" | "reset";
  value: string;
}

/** Per-task accumulator, kept in a ref so it never triggers re-renders. */
interface TaskTiming {
  renderedAt: number;
  firstInteractionAt: number | null;
  dwellMs: Record<string, number>;
  hoverStart: { id: string; at: number } | null;
  revisions: number;
  interactions: Interaction[];
}

function freshTiming(): TaskTiming {
  return {
    renderedAt:
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    firstInteractionAt: null,
    dwellMs: {},
    hoverStart: null,
    revisions: 0,
    interactions: [],
  };
}

export default function StudyClient({ tasks }: Props) {
  const router = useRouter();
  const [pid, setPid] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Browsing controls. `sort` starts at "distance" so the list opens ordered by
  // proximity to the task's anchor, which is the behaviour the study specifies.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("distance");
  const [maxPrice, setMaxPrice] = useState<number | null>(null);

  const timing = useRef<TaskTiming>(freshTiming());

  useEffect(() => {
    const id = sessionStorage.getItem("participantId");
    if (!id) {
      router.replace("/");
      return;
    }
    setPid(id);
  }, [router]);

  // Reset everything whenever a new task is shown.
  useEffect(() => {
    timing.current = freshTiming();
    setSelected(null);
    setQuery("");
    setSort("distance");
    setMaxPrice(null);
  }, [idx]);

  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const markInteraction = useCallback(() => {
    if (timing.current.firstInteractionAt === null) {
      timing.current.firstInteractionAt = now() - timing.current.renderedAt;
    }
  }, []);

  const logInteraction = useCallback(
    (kind: Interaction["kind"], value: string) => {
      markInteraction();
      timing.current.interactions.push({
        at_ms: Math.round(now() - timing.current.renderedAt),
        kind,
        value,
      });
    },
    [markInteraction],
  );

  const onHoverStart = useCallback(
    (id: string) => {
      markInteraction();
      timing.current.hoverStart = { id, at: now() };
    },
    [markInteraction],
  );

  const onHoverEnd = useCallback((id: string) => {
    const hs = timing.current.hoverStart;
    if (hs && hs.id === id) {
      timing.current.dwellMs[id] =
        (timing.current.dwellMs[id] ?? 0) + (now() - hs.at);
      timing.current.hoverStart = null;
    }
  }, []);

  const choose = useCallback(
    (id: string) => {
      markInteraction();
      setSelected((prev) => {
        if (prev !== null && prev !== id) timing.current.revisions += 1;
        return id;
      });
    },
    [markInteraction],
  );

  const task = tasks[idx];

  const priceCeiling = useMemo(() => {
    if (!task) return 0;
    return Math.max(...task.options.map((o) => o.attributes.price_lkr));
  }, [task]);

  /** The list actually on screen. Its index order is what gets recorded as the
   *  displayed position of every candidate. */
  const visible = useMemo(() => {
    if (!task) return [] as DisplayOption[];
    const q = query.trim().toLowerCase();
    let list = task.options.filter((o) => {
      if (maxPrice !== null && o.attributes.price_lkr > maxPrice) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.attributes.area.toLowerCase().includes(q) ||
        o.attributes.amenities.some((a) => a.toLowerCase().includes(q))
      );
    });
    list = [...list];
    switch (sort) {
      case "distance":
        list.sort((a, b) => a.anchor_distance_km - b.anchor_distance_km);
        break;
      case "travel":
        list.sort((a, b) => a.anchor_travel_min - b.anchor_travel_min);
        break;
      case "price_asc":
        list.sort((a, b) => a.attributes.price_lkr - b.attributes.price_lkr);
        break;
      case "price_desc":
        list.sort((a, b) => b.attributes.price_lkr - a.attributes.price_lkr);
        break;
      case "rating":
        list.sort((a, b) => b.attributes.rating - a.attributes.rating);
        break;
    }
    return list;
  }, [task, query, sort, maxPrice]);

  async function submit() {
    if (!selected || !pid || !task) return;
    setSubmitting(true);
    onHoverEnd(selected);

    const t = timing.current;

    // Position of every candidate in the list as it stood at the moment of
    // choice. Filtered-out hotels get null: they were not shown, and treating
    // them as rank 0 would silently corrupt any position-bias correction.
    const positions: Record<string, number> = {};
    visible.forEach((o, i) => {
      positions[o.hotel_id] = i + 1;
    });

    const payload = {
      participantId: pid,
      taskId: task.id,
      chosenHotelId: selected,
      positions,
      interactions: t.interactions,
      timing: {
        decision_ms: Math.round(now() - t.renderedAt),
        time_to_first_interaction_ms:
          t.firstInteractionAt === null ? null : Math.round(t.firstInteractionAt),
        dwell_ms: Object.fromEntries(
          Object.entries(t.dwellMs).map(([k, v]) => [k, Math.round(v)]),
        ),
        revisions: t.revisions,
        task_index: idx,
        // Final state of the browsing controls, so the choice can be read
        // against the list the participant had actually narrowed it to.
        final_sort: sort,
        final_query: query.trim() || null,
        final_max_price: maxPrice,
        n_shown: visible.length,
        n_total: task.options.length,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        client_ts: new Date().toISOString(),
      },
    };

    try {
      await fetch("/api/response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* best-effort: don't trap the participant if one write fails */
    }

    if (idx + 1 >= tasks.length) {
      router.push("/done");
    } else {
      setIdx((i) => i + 1);
      setSubmitting(false);
    }
  }

  if (!pid || !task) return null;

  const pct = Math.round((idx / tasks.length) * 100);
  const selectedStillVisible =
    selected !== null && visible.some((o) => o.hotel_id === selected);

  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" /> ALMA · Hotel Choice Study
      </div>

      <div className="panel">
        <div className="progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-label">
            {idx + 1} / {tasks.length}
          </div>
        </div>

        <div className="scenario">
          <div className="persona">{task.persona}</div>
          <p className="context">{task.context}</p>
          <p className="anchor-note">
            Distances and travel times below are measured to{" "}
            <strong>{task.anchor.name}</strong>.
          </p>
        </div>

        <div className="controls">
          <input
            type="search"
            className="search"
            placeholder="Search by hotel name, area or facility…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              logInteraction("search", e.target.value);
            }}
            aria-label="Search hotels"
          />

          <select
            className="control"
            value={sort}
            onChange={(e) => {
              const v = e.target.value as SortKey;
              setSort(v);
              logInteraction("sort", v);
            }}
            aria-label="Sort hotels"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>

          <select
            className="control"
            value={maxPrice ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setMaxPrice(v);
              logInteraction("price_filter", e.target.value || "any");
            }}
            aria-label="Filter by maximum price"
          >
            <option value="">Any price</option>
            {[10000, 20000, 30000, 50000, 80000]
              .filter((p) => p < priceCeiling)
              .map((p) => (
                <option key={p} value={p}>
                  Up to Rs {p.toLocaleString()}
                </option>
              ))}
          </select>

          {(query || maxPrice !== null || sort !== "distance") && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setQuery("");
                setMaxPrice(null);
                setSort("distance");
                logInteraction("reset", "all");
              }}
            >
              Reset
            </button>
          )}
        </div>

        <p className="prompt">
          Showing <strong>{visible.length}</strong> of {task.options.length}{" "}
          hotels. Select one to continue.
        </p>

        {visible.length === 0 ? (
          <p className="empty">
            No hotels match that search. Try clearing the filters.
          </p>
        ) : (
          <div className="options">
            {visible.map((o, i) => (
              <OptionCard
                key={o.hotel_id}
                option={o}
                position={i + 1}
                anchorName={task.anchor.name}
                selected={selected === o.hotel_id}
                onChoose={() => choose(o.hotel_id)}
                onHoverStart={() => onHoverStart(o.hotel_id)}
                onHoverEnd={() => onHoverEnd(o.hotel_id)}
              />
            ))}
          </div>
        )}

        {selected && !selectedStillVisible && (
          <p className="empty">
            Your selected hotel is hidden by the current filters. Clear them, or
            pick one from the list.
          </p>
        )}

        <div className="sticky-actions">
          <button
            className="btn btn-primary"
            disabled={!selected || submitting}
            onClick={submit}
          >
            {idx + 1 >= tasks.length ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Stable hue in [0,360) derived from a string, for the placeholder tint. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function HotelIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15" />
      <path d="M14 10h6a1 1 0 0 1 1 1v10" />
      <path d="M2 21h20" />
      <path d="M6.5 8.5h.01M10 8.5h.01M6.5 12h.01M10 12h.01M6.5 15.5h.01M10 15.5h.01" />
      <path d="M17.5 14h.01M17.5 17.5h.01" />
    </svg>
  );
}

function Thumb({ name, image }: { name: string; image?: string }) {
  const [failed, setFailed] = useState(false);
  const h = hashHue(name);
  const bg = `linear-gradient(140deg, hsl(${h} 42% 42%), hsl(${(h + 40) % 360} 46% 30%))`;

  if (image && !failed) {
    return (
      <div className="option-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className="option-thumb placeholder" style={{ backgroundImage: bg }}>
      <HotelIcon />
    </div>
  );
}

function OptionCard({
  option,
  position,
  anchorName,
  selected,
  onChoose,
  onHoverStart,
  onHoverEnd,
}: {
  option: DisplayOption;
  position: number;
  anchorName: string;
  selected: boolean;
  onChoose: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const a = option.attributes;
  return (
    <button
      type="button"
      className={`option${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onChoose}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
    >
      <span className="option-rank" aria-hidden="true">
        {position}
      </span>

      <Thumb name={option.name} image={a.image} />

      <div className="option-body">
        <div className="option-head">
          <div className="option-head-left">
            <span className="radio" />
            <span className="option-name">{option.name}</span>
          </div>
          <span className="option-price">
            Rs {a.price_lkr.toLocaleString()} <small>/ night</small>
          </span>
        </div>

        <div className="option-meta">
          <span className="rating-badge">★ {a.rating.toFixed(1)}</span>
          {a.review_count != null && (
            <span>{a.review_count.toLocaleString()} reviews</span>
          )}
          {a.star > 0 && <span>{a.star}-star</span>}
          <span className="anchor-metric">
            {option.anchor_distance_km} km to {anchorName}
          </span>
          <span className="anchor-metric">
            {option.anchor_travel_min} min drive
          </span>
          <span>{a.area}</span>
        </div>

        {a.description && <p className="option-desc">{a.description}</p>}

        <div className="chips">
          {a.amenities.map((am) => (
            <span key={am} className="chip">
              {am}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}
