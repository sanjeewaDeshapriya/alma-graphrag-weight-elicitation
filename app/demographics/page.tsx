"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const AGE_BANDS = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"];
const TRAVEL_FREQ = [
  "Rarely (once a year or less)",
  "Sometimes (2–4 trips a year)",
  "Often (5+ trips a year)",
  "I travel for work regularly",
];

export default function Demographics() {
  const router = useRouter();
  const [pid, setPid] = useState<string | null>(null);
  const [age, setAge] = useState("");
  const [freq, setFreq] = useState("");
  const [nationality, setNationality] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = sessionStorage.getItem("participantId");
    if (!id) {
      router.replace("/");
      return;
    }
    setPid(id);
  }, [router]);

  async function submit(skip: boolean) {
    setSaving(true);
    const demographics = skip
      ? { skipped: true }
      : {
          age_band: age || null,
          travel_frequency: freq || null,
          nationality: nationality.trim() || null,
        };
    try {
      await fetch("/api/session", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId: pid, demographics }),
      });
    } catch {
      /* non-blocking: demographics are optional */
    }
    router.push("/study");
  }

  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" /> ALMA · Hotel Choice Study
      </div>

      <div className="panel">
        <h1>A little about you</h1>
        <p className="muted">
          All optional — skip any question, or skip this page entirely. This only
          helps us see whether different kinds of travellers choose differently.
        </p>

        <div className="field">
          <label htmlFor="age">Age</label>
          <select id="age" value={age} onChange={(e) => setAge(e.target.value)}>
            <option value="">Prefer not to say</option>
            {AGE_BANDS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="freq">How often do you travel and stay in hotels?</label>
          <select id="freq" value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="">Prefer not to say</option>
            {TRAVEL_FREQ.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="nat">Nationality (optional)</label>
          <input
            id="nat"
            type="text"
            value={nationality}
            placeholder="e.g. Sri Lankan"
            onChange={(e) => setNationality(e.target.value)}
          />
        </div>

        <div className="btn-row">
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => submit(false)}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => submit(true)}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
