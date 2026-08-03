"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConsentForm() {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function begin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (!res.ok) throw new Error(`session failed (${res.status})`);
      const data = await res.json();
      sessionStorage.setItem("participantId", data.participantId);
      sessionStorage.setItem("materialVersion", data.version);
      router.push("/demographics");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div>
      <label className="consent">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span className="muted">
          I&apos;m 18 or older and I agree to take part in this anonymous study.
          I understand my responses will be used, in aggregate, for academic
          research.
        </span>
      </label>

      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={!agreed || loading}
          onClick={begin}
        >
          {loading ? "Starting…" : "Begin study"}
        </button>
        {error && <span className="muted">{error}</span>}
      </div>
    </div>
  );
}
