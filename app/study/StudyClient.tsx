"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DisplayTask, DisplayOption } from "@/lib/material";

interface Props {
  tasks: DisplayTask[];
}

/** Per-task timing accumulator, kept in a ref so it never triggers re-renders. */
interface TaskTiming {
  renderedAt: number; // performance.now() when the task mounted
  firstInteractionAt: number | null;
  dwellMs: Record<string, number>; // accumulated hover/focus time per hotel
  hoverStart: { id: string; at: number } | null;
  revisions: number; // how many times the selection changed
}

function freshTiming(): TaskTiming {
  return {
    renderedAt:
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    firstInteractionAt: null,
    dwellMs: {},
    hoverStart: null,
    revisions: 0,
  };
}

export default function StudyClient({ tasks }: Props) {
  const router = useRouter();
  const [pid, setPid] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timing = useRef<TaskTiming>(freshTiming());

  useEffect(() => {
    const id = sessionStorage.getItem("participantId");
    if (!id) {
      router.replace("/");
      return;
    }
    setPid(id);
  }, [router]);

  // Reset timing whenever a new task is shown.
  useEffect(() => {
    timing.current = freshTiming();
    setSelected(null);
  }, [idx]);

  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const markInteraction = useCallback(() => {
    if (timing.current.firstInteractionAt === null) {
      timing.current.firstInteractionAt = now() - timing.current.renderedAt;
    }
  }, []);

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

  async function submit() {
    if (!selected || !pid) return;
    setSubmitting(true);

    // close any open hover dwell
    onHoverEnd(selected);
    const t = timing.current;
    const payload = {
      participantId: pid,
      taskId: tasks[idx].id,
      chosenHotelId: selected,
      timing: {
        decision_ms: Math.round(now() - t.renderedAt),
        time_to_first_interaction_ms:
          t.firstInteractionAt === null
            ? null
            : Math.round(t.firstInteractionAt),
        dwell_ms: Object.fromEntries(
          Object.entries(t.dwellMs).map(([k, v]) => [k, Math.round(v)]),
        ),
        revisions: t.revisions,
        task_index: idx,
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

  if (!pid) return null;

  const task = tasks[idx];
  const pct = Math.round((idx / tasks.length) * 100);

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
          <div className="persona">{task.scenario.persona}</div>
          <p className="context">{task.scenario.context}</p>
        </div>

        <p className="prompt">Select one hotel to continue.</p>

        <div className="options">
          {task.options.map((o) => (
            <OptionCard
              key={o.hotel_id}
              option={o}
              selected={selected === o.hotel_id}
              onChoose={() => choose(o.hotel_id)}
              onHoverStart={() => onHoverStart(o.hotel_id)}
              onHoverEnd={() => onHoverEnd(o.hotel_id)}
            />
          ))}
        </div>

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
  selected,
  onChoose,
  onHoverStart,
  onHoverEnd,
}: {
  option: DisplayOption;
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
          {a.distance_km != null ? (
            <span>{a.distance_km} km to centre</span>
          ) : a.travel_time_min != null ? (
            <span>{a.travel_time_min} min to centre</span>
          ) : null}
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
