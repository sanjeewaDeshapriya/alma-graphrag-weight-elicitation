"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Optional participant background.
 *
 * Everything here is banded and optional on purpose. Age + occupation + income
 * + home town is a classic quasi-identifier combination, and with a target
 * sample of 40-60 an exact salary and a precise neighbourhood could single
 * somebody out. Bands keep the study genuinely anonymous while still supporting
 * the only analysis these fields are for: checking whether different kinds of
 * traveller choose differently.
 */
const AGE_BANDS = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"];

const SALARY_BANDS = [
  "Under LKR 50,000",
  "LKR 50,000 – 100,000",
  "LKR 100,000 – 200,000",
  "LKR 200,000 – 400,000",
  "Over LKR 400,000",
];

const OCCUPATIONS = [
  "Student",
  "IT / software",
  "Engineering",
  "Business / management",
  "Government / public sector",
  "Healthcare",
  "Education",
  "Sales / marketing",
  "Hospitality / tourism",
  "Self-employed",
  "Retired",
  "Not currently working",
  "Other",
];

/** Home area within the Colombo district — local familiarity affects how people
 *  judge "far", so it is a genuine covariate rather than an admin field. */
const HOME_AREAS = [
  "Colombo 01 – Fort",
  "Colombo 02 – Slave Island",
  "Colombo 03 – Kollupitiya",
  "Colombo 04 – Bambalapitiya",
  "Colombo 05 – Havelock Town",
  "Colombo 06 – Wellawatte",
  "Colombo 07 – Cinnamon Gardens",
  "Colombo 08 – Borella",
  "Colombo 09 – Dematagoda",
  "Colombo 10 – Maradana",
  "Colombo 11 – Pettah",
  "Colombo 12–15 – Grandpass / Mattakkuliya",
  "Dehiwala / Mount Lavinia",
  "Nugegoda / Maharagama",
  "Rajagiriya / Battaramulla",
  "Kotte / Nawala",
  "Kelaniya / Wattala",
  "Moratuwa / Panadura",
  "Elsewhere in Sri Lanka",
  "Outside Sri Lanka",
];

export default function Demographics() {
  const router = useRouter();
  const [pid, setPid] = useState<string | null>(null);
  const [age, setAge] = useState("");
  const [occupation, setOccupation] = useState("");
  const [salary, setSalary] = useState("");
  const [homeArea, setHomeArea] = useState("");
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
          occupation: occupation || null,
          salary_band: salary || null,
          home_area: homeArea || null,
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
          All four questions are optional — leave any of them as “Prefer not to
          say”, or skip the page entirely. We ask only so we can see whether
          different kinds of traveller choose differently. Nothing here
          identifies you, and we never ask for your name or email.
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
          <label htmlFor="job">What do you do?</label>
          <select
            id="job"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {OCCUPATIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="salary">Monthly household income</label>
          <select
            id="salary"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {SALARY_BANDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="hint">
            Asked as a range only. It helps us understand how much price matters
            to different travellers.
          </p>
        </div>

        <div className="field">
          <label htmlFor="home">Where do you live?</label>
          <select
            id="home"
            value={homeArea}
            onChange={(e) => setHomeArea(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {HOME_AREAS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <p className="hint">
            Knowing the area helps us allow for how familiar you are with
            distances around Colombo.
          </p>
        </div>

        <div className="btn-row">
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => submit(false)}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
          <button className="btn" disabled={saving} onClick={() => submit(true)}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
