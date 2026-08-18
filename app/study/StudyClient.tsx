"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DisplayTask, DisplayOption, RoomOffer } from "@/lib/material";

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

/** A confirmed booking: a hotel AND the room chosen inside it. */
interface Selection {
  hotelId: string;
  roomId: string;
}

/** One recorded UI action. The order and timing of these is data, not telemetry:
 *  a participant who sorts by price before choosing is telling us something the
 *  final click alone does not. */
interface Interaction {
  at_ms: number;
  kind:
    | "search"
    | "sort"
    | "price_filter"
    | "reset"
    | "open_hotel"
    | "close_hotel"
    | "gallery"
    | "select_room"
    | "confirm_room";
  value: string;
}

/** Per-task accumulator, kept in a ref so it never triggers re-renders. */
interface TaskTiming {
  renderedAt: number;
  firstInteractionAt: number | null;
  /** Hover dwell on each hotel card in the list. */
  dwellMs: Record<string, number>;
  hoverStart: { id: string; at: number } | null;
  /** Time spent inside each hotel's detail panel — the deliberation signal. */
  panelMs: Record<string, number>;
  panelStart: { id: string; at: number } | null;
  /** Ordered hotel ids whose detail panel was opened (repeats included). */
  opens: string[];
  /** Every room pick, including ones later changed. */
  roomPicks: { hotel_id: string; room_id: string; at_ms: number }[];
  /** Times the confirmed hotel changed, and times the room changed. */
  revisions: number;
  roomRevisions: number;
  interactions: Interaction[];
}

function freshTiming(): TaskTiming {
  return {
    renderedAt:
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    firstInteractionAt: null,
    dwellMs: {},
    hoverStart: null,
    panelMs: {},
    panelStart: null,
    opens: [],
    roomPicks: [],
    revisions: 0,
    roomRevisions: 0,
    interactions: [],
  };
}

const rs = (n: number) => `Rs ${n.toLocaleString()}`;

/** A missing guest score is unknown, not zero — never render it as "0.0". */
function Rating({ value }: { value: number }) {
  if (!value) return <span className="muted">No guest rating</span>;
  return <span className="rating-badge">★ {value.toFixed(1)}</span>;
}

export default function StudyClient({ tasks }: Props) {
  const router = useRouter();
  const [pid, setPid] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [openHotelId, setOpenHotelId] = useState<string | null>(null);
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
    setOpenHotelId(null);
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

  const task = tasks[idx];

  /** Bank the time spent in the currently open panel, if there is one. */
  const flushPanel = useCallback(() => {
    const ps = timing.current.panelStart;
    if (!ps) return null;
    timing.current.panelMs[ps.id] =
      (timing.current.panelMs[ps.id] ?? 0) + (now() - ps.at);
    timing.current.panelStart = null;
    return ps.id;
  }, []);

  const openHotel = useCallback(
    (id: string) => {
      onHoverEnd(id);
      // Opening one panel straight from another would otherwise drop the first
      // panel's dwell time on the floor, and dwell is the whole point of it.
      flushPanel();
      timing.current.opens.push(id);
      timing.current.panelStart = { id, at: now() };
      logInteraction("open_hotel", id);
      setOpenHotelId(id);
    },
    [flushPanel, logInteraction, onHoverEnd],
  );

  const closeHotel = useCallback(
    (reason: string) => {
      const id = flushPanel();
      if (id) logInteraction("close_hotel", `${id}:${reason}`);
      setOpenHotelId(null);
    },
    [flushPanel, logInteraction],
  );

  /** Confirm a hotel+room pair from inside the detail panel. */
  const confirmRoom = useCallback(
    (hotelId: string, roomId: string) => {
      timing.current.roomPicks.push({
        hotel_id: hotelId,
        room_id: roomId,
        at_ms: Math.round(now() - timing.current.renderedAt),
      });
      setSelected((prev) => {
        if (prev) {
          if (prev.hotelId !== hotelId) timing.current.revisions += 1;
          else if (prev.roomId !== roomId) timing.current.roomRevisions += 1;
        }
        return { hotelId, roomId };
      });
      logInteraction("confirm_room", `${hotelId}:${roomId}`);
      closeHotel("confirmed");
    },
    [closeHotel, logInteraction],
  );

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
        o.attributes.amenities.some((a) => a.toLowerCase().includes(q)) ||
        o.rooms.some((r) => r.name.toLowerCase().includes(q))
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

  const openOption = useMemo(
    () => task?.options.find((o) => o.hotel_id === openHotelId) ?? null,
    [task, openHotelId],
  );

  async function submit() {
    if (!selected || !pid || !task) return;
    setSubmitting(true);
    onHoverEnd(selected.hotelId);

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
      chosenHotelId: selected.hotelId,
      chosenRoomId: selected.roomId,
      positions,
      interactions: t.interactions,
      timing: {
        decision_ms: Math.round(now() - t.renderedAt),
        time_to_first_interaction_ms:
          t.firstInteractionAt === null ? null : Math.round(t.firstInteractionAt),
        dwell_ms: Object.fromEntries(
          Object.entries(t.dwellMs).map(([k, v]) => [k, Math.round(v)]),
        ),
        // Stage-2 deliberation: how long the participant spent inside each
        // hotel's detail panel, and how they moved between them.
        panel_ms: Object.fromEntries(
          Object.entries(t.panelMs).map(([k, v]) => [k, Math.round(v)]),
        ),
        hotels_opened: t.opens,
        n_hotels_opened: new Set(t.opens).size,
        room_picks: t.roomPicks,
        // Changes to the CONFIRMED choice. Switching between rooms inside an
        // open panel before booking is not counted here — every one of those is
        // in `interactions` as a `select_room` event.
        revisions: t.revisions,
        room_revisions: t.roomRevisions,
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
  const selectedOption =
    selected && task.options.find((o) => o.hotel_id === selected.hotelId);
  const selectedRoom =
    selected && selectedOption
      ? selectedOption.rooms.find((r) => r.id === selected.roomId)
      : undefined;
  const selectedStillVisible =
    selected !== null && visible.some((o) => o.hotel_id === selected.hotelId);

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
            placeholder="Search by hotel name, area, facility or room…"
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
                  Up to {rs(p)}
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
          hotels. Open a hotel to see its rooms, then pick the room you would
          book.
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
                selectedRoom={
                  selected?.hotelId === o.hotel_id ? selectedRoom : undefined
                }
                onOpen={() => openHotel(o.hotel_id)}
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
          {selectedOption && selectedRoom ? (
            <p className="selection-summary">
              <strong>{selectedOption.name}</strong> · {selectedRoom.name} ·{" "}
              {rs(selectedRoom.price_lkr)}/night
            </p>
          ) : (
            <p className="selection-summary muted">No room chosen yet</p>
          )}
          <button
            className="btn btn-primary"
            disabled={!selected || submitting}
            onClick={submit}
          >
            {idx + 1 >= tasks.length ? "Finish" : "Next"}
          </button>
        </div>
      </div>

      {openOption && (
        <HotelDetailPanel
          option={openOption}
          anchorName={task.anchor.name}
          initialRoomId={
            selected?.hotelId === openOption.hotel_id ? selected.roomId : null
          }
          onClose={(reason) => closeHotel(reason)}
          onSelectRoom={(roomId) =>
            logInteraction("select_room", `${openOption.hotel_id}:${roomId}`)
          }
          onGallery={(i) =>
            logInteraction("gallery", `${openOption.hotel_id}:${i}`)
          }
          onConfirm={(roomId) => confirmRoom(openOption.hotel_id, roomId)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hotel detail panel — stage 2                                               */
/* -------------------------------------------------------------------------- */

function HotelDetailPanel({
  option,
  anchorName,
  initialRoomId,
  onClose,
  onSelectRoom,
  onGallery,
  onConfirm,
}: {
  option: DisplayOption;
  anchorName: string;
  initialRoomId: string | null;
  onClose: (reason: string) => void;
  onSelectRoom: (roomId: string) => void;
  onGallery: (index: number) => void;
  onConfirm: (roomId: string) => void;
}) {
  const a = option.attributes;
  const d = option.detail;
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [heroIdx, setHeroIdx] = useState(0);
  const [allFacilities, setAllFacilities] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind must not scroll while the panel is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose("escape");
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const gallery = d.images.length
    ? d.images
    : a.image
      ? [{ url: a.image, caption: "" }]
      : [];
  const cheapest = Math.min(...option.rooms.map((r) => r.price_lkr));
  const facilities = allFacilities
    ? d.facilities_all
    : d.facilities_all.slice(0, 12);

  return (
    <div className="modal-backdrop" onClick={() => onClose("backdrop")}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={option.name}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="modal-title">
            <h2>{option.name}</h2>
            <div className="option-meta">
              <Rating value={a.rating} />
              {a.review_count != null && (
                <span>{a.review_count.toLocaleString()} reviews</span>
              )}
              {a.star > 0 && <span>{a.star}-star</span>}
              <span className="anchor-metric">
                {option.anchor_distance_km} km · {option.anchor_travel_min} min
                to {anchorName}
              </span>
              <span>{a.area}</span>
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => onClose("button")}
          >
            ✕
          </button>
        </header>

        <div className="modal-body">
          {gallery.length > 0 && (
            <div className="gallery">
              <Photo
                src={gallery[Math.min(heroIdx, gallery.length - 1)].url}
                name={option.name}
                className="gallery-hero"
              />
              {gallery.length > 1 && (
                <div className="gallery-strip">
                  {gallery.map((im, i) => (
                    <button
                      key={im.url}
                      type="button"
                      className={`gallery-thumb${i === heroIdx ? " active" : ""}`}
                      aria-label={im.caption || `Photo ${i + 1}`}
                      onClick={() => {
                        setHeroIdx(i);
                        onGallery(i);
                      }}
                    >
                      <Photo src={im.url} name={option.name} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {d.description_full && (
            <p className="modal-desc">{d.description_full}</p>
          )}

          <div className="fact-row">
            {d.checkin && (
              <span>
                Check-in <strong>{d.checkin}</strong>
              </span>
            )}
            {d.checkout && (
              <span>
                Check-out <strong>{d.checkout}</strong>
              </span>
            )}
            {d.hotel_type && <span>{d.hotel_type}</span>}
            {d.chain && <span>{d.chain}</span>}
          </div>

          {d.review_categories.length > 0 && (
            <section>
              <h3 className="modal-sub">Guest ratings</h3>
              <div className="rating-grid">
                {d.review_categories.map((c) => (
                  <div key={c.name} className="rating-item">
                    <div className="rating-item-head">
                      <span>{c.name}</span>
                      <strong>{c.rating.toFixed(1)}</strong>
                    </div>
                    <div className="dist-bar">
                      <span
                        className="dist-fill"
                        style={{ width: `${Math.min(c.rating * 10, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {(d.pros.length > 0 || d.cons.length > 0) && (
                <div className="pros-cons">
                  {d.pros.length > 0 && (
                    <p>
                      <span className="tag tag-good">Guests liked</span>{" "}
                      {d.pros.join(" · ")}
                    </p>
                  )}
                  {d.cons.length > 0 && (
                    <p>
                      <span className="tag">Guests noted</span>{" "}
                      {d.cons.join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {d.facilities_all.length > 0 && (
            <section>
              <h3 className="modal-sub">
                Facilities <span className="muted">({d.n_facilities})</span>
              </h3>
              <div className="chips">
                {facilities.map((f) => (
                  <span key={f} className="chip">
                    {f}
                  </span>
                ))}
                {d.facilities_all.length > 12 && (
                  <button
                    type="button"
                    className="chip chip-btn"
                    onClick={() => setAllFacilities((v) => !v)}
                  >
                    {allFacilities
                      ? "Show fewer"
                      : `+${d.facilities_all.length - 12} more`}
                  </button>
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="modal-sub">
              Choose a room{" "}
              <span className="muted">({option.rooms.length} available)</span>
            </h3>
            <div className="rooms">
              {option.rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  cheapest={cheapest}
                  selected={roomId === room.id}
                  onSelect={() => {
                    setRoomId(room.id);
                    onSelectRoom(room.id);
                  }}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="modal-foot">
          <button
            type="button"
            className="btn"
            onClick={() => onClose("cancel")}
          >
            Back to hotels
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!roomId}
            onClick={() => roomId && onConfirm(roomId)}
          >
            {roomId ? "Book this room" : "Select a room"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function RoomCard({
  room,
  cheapest,
  selected,
  onSelect,
}: {
  room: RoomOffer;
  cheapest: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const delta = room.price_lkr - cheapest;
  return (
    <button
      type="button"
      className={`room${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <Photo src={room.image} name={room.name} className="room-thumb" />

      <div className="room-body">
        <div className="room-head">
          <span className="radio" />
          <span className="room-name">{room.name}</span>
        </div>

        <div className="option-meta">
          {room.beds && <span>{room.beds}</span>}
          {room.size_sqm != null && (
            <span>
              {room.size_sqm} {room.size_unit}
            </span>
          )}
          <span>
            {`Sleeps ${room.max_occupancy}`}
            {room.max_children > 0 &&
              `, up to ${room.max_children} ${
                room.max_children === 1 ? "child" : "children"
              }`}
          </span>
        </div>

        <div className="chips">
          <span className={`tag ${room.board_type === "RO" ? "" : "tag-good"}`}>
            {room.board_name}
          </span>
          <span className={`tag ${room.refundable ? "tag-good" : "tag-warn"}`}>
            {room.refundable ? "Free cancellation" : "Non-refundable"}
          </span>
          {room.amenities.map((am) => (
            <span key={am} className="chip">
              {am}
            </span>
          ))}
        </div>
      </div>

      <div className="room-price">
        <span className="room-price-value">{rs(room.price_lkr)}</span>
        <small>per night</small>
        {delta > 0 ? (
          <small className="room-delta">+{rs(delta)} vs cheapest</small>
        ) : (
          <small className="room-delta room-delta-best">Lowest price</small>
        )}
        <small>{room.taxes_included ? "Taxes included" : "+ taxes"}</small>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

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

/** An image that degrades to a neutral tinted placeholder rather than a broken
 *  icon — a missing photo must not read as a worse hotel. */
function Photo({
  src,
  name,
  className = "",
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const h = hashHue(name);
  const bg = `linear-gradient(140deg, hsl(${h} 42% 42%), hsl(${(h + 40) % 360} 46% 30%))`;

  if (src && !failed) {
    return (
      <div className={`photo ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={`photo placeholder ${className}`} style={{ backgroundImage: bg }}>
      <HotelIcon />
    </div>
  );
}

function OptionCard({
  option,
  position,
  anchorName,
  selectedRoom,
  onOpen,
  onHoverStart,
  onHoverEnd,
}: {
  option: DisplayOption;
  position: number;
  anchorName: string;
  selectedRoom: RoomOffer | undefined;
  onOpen: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const a = option.attributes;
  const selected = Boolean(selectedRoom);
  return (
    <button
      type="button"
      className={`option${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onOpen}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
    >
      <span className="option-rank" aria-hidden="true">
        {position}
      </span>

      <Photo src={a.image} name={option.name} className="option-thumb" />

      <div className="option-body">
        <div className="option-head">
          <div className="option-head-left">
            <span className="radio" />
            <span className="option-name">{option.name}</span>
          </div>
          <span className="option-price">
            <small>from</small> {rs(a.price_lkr)} <small>/ night</small>
          </span>
        </div>

        <div className="option-meta">
          <Rating value={a.rating} />
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

        {selectedRoom ? (
          <p className="option-chosen">
            Booked: <strong>{selectedRoom.name}</strong> ·{" "}
            {selectedRoom.board_name} · {rs(selectedRoom.price_lkr)}/night
            <span className="option-cta">Change room</span>
          </p>
        ) : (
          <p className="option-cta-row">
            {/* Template literal, not `View {n} rooms`: JSX drops the space
                after a leading text run here and it renders as "5rooms". */}
            <span className="option-cta">
              {`View ${option.rooms.length} rooms & details →`}
            </span>
          </p>
        )}
      </div>
    </button>
  );
}
