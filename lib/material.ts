/**
 * Study material loader (server-only — the frozen material is bundled at build time).
 *
 * The material is generated OFFLINE by the Python generator and committed as a
 * versioned JSON file, so the study never depends on Neo4j/pgvector at runtime.
 *
 * Design notes that matter for the data this produces:
 *
 *  - Every task is ANCHORED to a real Colombo location and shows the WHOLE hotel
 *    pool, ordered by distance to that anchor. The output is a labelled ranking
 *    dataset (one positive, many negatives per task), not a fitted weight vector.
 *  - Two of the five components depend on the anchor (`spatial`, `accessibility`)
 *    and three do not (`facility`, `economic`, `disruption`). They are stored
 *    separately and merged per task by `componentsFor()`.
 *  - Component vectors are the label features and are NEVER sent to the browser —
 *    a participant must not be able to see or alter what they are scored on.
 */
import materialData from "@/material/study_material_v1.json";

export type Dimension =
  | "spatial"
  | "accessibility"
  | "facility"
  | "economic"
  | "disruption";

export interface OptionAttributes {
  price_lkr: number;
  rating: number;
  star: number;
  amenities: string[];
  area: string;
  review_count?: number;
  /** Straight-line distance to the city centre, km (context only). */
  distance_km?: number;
  description?: string;
  image?: string;
  lat?: number;
  lng?: number;
}

/**
 * One bookable offer inside a hotel — the stage-2 alternative.
 *
 * Built offline by joining `/hotels/rates` (price, board, refundability) onto
 * the `/data/hotel` room catalogue (name, area, beds, occupancy, photo) via
 * `mappedRoomId`. Unlike the hotel components these are NOT hidden: price and
 * board are exactly what the participant is being asked to trade off, so they
 * have to be on screen.
 */
export interface RoomOffer {
  id: string;
  name: string;
  price_lkr: number;
  board_name: string;
  board_type: string;
  refundable: boolean;
  cancel_before: string | null;
  taxes_included: boolean;
  max_occupancy: number;
  max_adults: number;
  max_children: number;
  size_sqm: number | null;
  size_unit: string;
  beds: string;
  amenities: string[];
  image: string | null;
  description: string;
  mapped_room_id: number | null;
  /** false when no catalogue room matched, so the card falls back to rate text. */
  from_catalogue: boolean;
}

/** Everything the detail panel shows beyond the summary card. */
export interface HotelDetail {
  description_full: string;
  facilities_all: string[];
  n_facilities: number;
  images: { url: string; caption: string }[];
  checkin: string | null;
  checkout: string | null;
  hotel_type: string | null;
  chain: string | null;
  pros: string[];
  cons: string[];
  review_categories: { name: string; rating: number }[];
}

export interface Hotel {
  name: string;
  attributes: OptionAttributes;
  detail: HotelDetail;
  rooms: RoomOffer[];
  /** facility / economic / disruption — anchor-independent. Server-only. */
  components_global: Record<"facility" | "economic" | "disruption", number>;
}

export interface Anchor {
  name: string;
  lat: number;
  lng: number;
}

/** Per-anchor, per-hotel figures. Server-only except distance/travel, which are shown. */
export interface AnchorComponent {
  spatial: number;
  accessibility: number;
  distance_km: number;
  travel_min: number;
}

interface RawTask {
  id: string;
  anchor_id: string;
  persona: string;
  context: string;
  primary_dimension: Dimension | null;
  secondary_dimension: Dimension | null;
  repeat_of?: string | null;
  is_attention_check: boolean;
  attention_answer_hotel_id?: string;
  option_ids: string[];
}

export interface Material {
  version: string;
  city: string;
  dimensions: Dimension[];
  design: Record<string, unknown>;
  anchors: Record<string, Anchor>;
  hotels: Record<string, Hotel>;
  anchor_components: Record<string, Record<string, AnchorComponent>>;
  tasks: RawTask[];
}

/** What the browser receives: attributes, detail and rooms — but no components. */
export interface DisplayOption {
  hotel_id: string;
  name: string;
  attributes: OptionAttributes;
  detail: HotelDetail;
  rooms: RoomOffer[];
  /** Distance from this hotel to the task's anchor, km. */
  anchor_distance_km: number;
  /** Traffic-aware driving minutes to the task's anchor. */
  anchor_travel_min: number;
}

export interface DisplayTask {
  id: string;
  anchor: Anchor & { id: string };
  persona: string;
  context: string;
  /** Ordered by distance to the anchor, nearest first. */
  options: DisplayOption[];
}

let _cache: Material | null = null;

export function loadMaterial(): Material {
  if (!_cache) _cache = materialData as unknown as Material;
  return _cache;
}

/**
 * The full five-component vector for one hotel under one anchor — the feature
 * row that a labelled observation is recorded against. Server-side only.
 */
export function componentsFor(
  hotelId: string,
  anchorId: string,
): Record<Dimension, number> | undefined {
  const material = loadMaterial();
  const hotel = material.hotels[hotelId];
  const anchored = material.anchor_components[anchorId]?.[hotelId];
  if (!hotel || !anchored) return undefined;
  return {
    spatial: anchored.spatial,
    accessibility: anchored.accessibility,
    facility: hotel.components_global.facility,
    economic: hotel.components_global.economic,
    disruption: hotel.components_global.disruption,
  };
}

function buildDisplayTask(material: Material, task: RawTask): DisplayTask {
  const anchor = material.anchors[task.anchor_id];
  if (!anchor) throw new Error(`unknown anchor ${task.anchor_id}`);
  const anchored = material.anchor_components[task.anchor_id];

  const options: DisplayOption[] = task.option_ids.map((id) => {
    const hotel = material.hotels[id];
    const a = anchored?.[id];
    if (!hotel || !a) throw new Error(`unknown hotel ${id} for anchor ${task.anchor_id}`);
    return {
      hotel_id: id,
      name: hotel.name,
      attributes: hotel.attributes,
      detail: hotel.detail,
      rooms: hotel.rooms,
      anchor_distance_km: a.distance_km,
      anchor_travel_min: a.travel_min,
    };
  });

  // Nearest first — this is the participant-facing default the study asks for.
  // The displayed position of every option is recorded with the response so the
  // resulting labels can be corrected for position bias downstream.
  options.sort((x, y) => x.anchor_distance_km - y.anchor_distance_km);

  return {
    id: task.id,
    anchor: { id: task.anchor_id, ...anchor },
    persona: task.persona,
    context: task.context,
    options,
  };
}

/** Browser-safe tasks: display attributes only, components removed. */
export function getDisplayTasks(): DisplayTask[] {
  const material = loadMaterial();
  return material.tasks.map((t) => buildDisplayTask(material, t));
}

/** Raw task record (with the attention answer) — server use only. */
export function getRawTask(id: string): RawTask | undefined {
  return loadMaterial().tasks.find((t) => t.id === id);
}

/** Every offer inside one hotel, in the order the room list renders them. */
export function roomsFor(hotelId: string): RoomOffer[] {
  return loadMaterial().hotels[hotelId]?.rooms ?? [];
}

/**
 * One offer by id, scoped to its hotel. The response route re-reads the room
 * from here rather than trusting the posted body, for the same reason it
 * re-derives the hotel components: the price a choice is recorded against has
 * to be the price the material says, not one the client asserts.
 */
export function getRoomOffer(
  hotelId: string,
  roomId: string,
): RoomOffer | undefined {
  return roomsFor(hotelId).find((r) => r.id === roomId);
}
