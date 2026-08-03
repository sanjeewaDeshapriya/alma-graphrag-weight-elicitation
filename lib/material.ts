/**
 * Study material loader (server-only — reads the frozen material file with fs).
 *
 * The material is generated OFFLINE by the Python generator and committed as a
 * versioned JSON file, so the study never depends on Neo4j/pgvector at runtime.
 * The hidden per-hotel `components` vector is the feature input for the choice
 * model; it is stripped before anything is sent to the browser.
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
  /** Real review count (LiteAPI). */
  review_count?: number;
  /** Straight-line distance to the city centre in km (LiteAPI-derived). */
  distance_km?: number;
  /** Estimated travel time in minutes (sample material only). */
  travel_time_min?: number;
  /** Short plain-text description (LiteAPI hotelDescription, HTML stripped). */
  description?: string;
  /**
   * Hotel photo. LiteAPI material supplies a real CDN URL; the sample material
   * omits it and a neutral tinted placeholder is shown instead. If a supplied
   * image fails to load, the card falls back to the placeholder too.
   */
  image?: string;
}

export interface Hotel {
  name: string;
  attributes: OptionAttributes;
  components: Record<Dimension, number>; // hidden from the client
}

export interface Scenario {
  id: string;
  persona: string;
  context: string;
  primary_dimension: Dimension | "attention";
}

interface RawTask {
  id: string;
  scenario_id: string;
  is_attention_check: boolean;
  attention_answer_hotel_id?: string;
  option_ids: string[];
}

export interface Material {
  version: string;
  city: string;
  dimensions: Dimension[];
  hotels: Record<string, Hotel>;
  scenarios: Scenario[];
  tasks: RawTask[];
}

/** A fully-resolved task with hotel objects (server-side use). */
export interface ResolvedTask {
  id: string;
  scenario: Scenario;
  is_attention_check: boolean;
  attention_answer_hotel_id?: string;
  options: Array<{ hotel_id: string } & Hotel>;
}

/** Display shapes sent to the browser — no components, no attention flags. */
export interface DisplayOption {
  hotel_id: string;
  name: string;
  attributes: OptionAttributes;
}
export interface DisplayTask {
  id: string;
  scenario: Scenario;
  options: DisplayOption[];
}

let _cache: Material | null = null;

export function loadMaterial(): Material {
  // Bundled at build time (works on Vercel/Node and edge alike — no runtime fs).
  if (!_cache) _cache = materialData as unknown as Material;
  return _cache;
}

function resolve(material: Material, task: RawTask): ResolvedTask {
  const scenario = material.scenarios.find((s) => s.id === task.scenario_id);
  if (!scenario) throw new Error(`unknown scenario ${task.scenario_id}`);
  const options = task.option_ids.map((id) => {
    const hotel = material.hotels[id];
    if (!hotel) throw new Error(`unknown hotel ${id}`);
    return { hotel_id: id, ...hotel };
  });
  return {
    id: task.id,
    scenario,
    is_attention_check: task.is_attention_check,
    attention_answer_hotel_id: task.attention_answer_hotel_id,
    options,
  };
}

/** Browser-safe tasks: display attributes only, components removed. */
export function getDisplayTasks(): DisplayTask[] {
  const material = loadMaterial();
  return material.tasks.map((t) => {
    const r = resolve(material, t);
    return {
      id: r.id,
      scenario: r.scenario,
      options: r.options.map((o) => ({
        hotel_id: o.hotel_id,
        name: o.name,
        attributes: o.attributes,
      })),
    };
  });
}

/** Full task (with hidden components) — server use only, for scoring a response. */
export function getResolvedTask(id: string): ResolvedTask | undefined {
  const material = loadMaterial();
  const raw = material.tasks.find((t) => t.id === id);
  return raw ? resolve(material, raw) : undefined;
}
