"use client";

import { useCallback, useEffect, useState } from "react";

interface Summary {
  participants: number;
  responses: number;
  completed: number;
  totalTasks: number;
  attentionChecks: number;
  attentionPassRate: number | null;
  medianDecisionMs: number | null;
  roomChoices: number;
  /** Share of room picks that were NOT the cheapest room in the hotel. */
  upgradeRate: number | null;
  medianPremiumLkr: number | null;
  refundableRate: number | null;
  byBoard: { board: string; count: number }[];
}
interface ScenarioDist {
  scenarioId: string;
  persona: string;
  primaryDimension: string;
  total: number;
  distribution: { hotelId: string; hotel: string; count: number }[];
}
interface RespRow {
  participantId: string;
  persona: string;
  chosenHotel: string;
  chosenRoom: string | null;
  roomPriceLkr: number | null;
  roomBoard: string | null;
  roomRefundable: boolean | null;
  nRoomsOffered: number;
  isAttentionCheck: boolean;
  attentionPass: boolean | null;
  decisionMs: number | null;
  submittedAt: string | null;
}
interface AdminData {
  storage: string;
  version: string;
  summary: Summary;
  byScenario: ScenarioDist[];
  responses: RespRow[];
}

export default function Admin() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A token in the URL (?token=…) wins over the remembered one — that is the
  // form the README hands out, and previously it was ignored entirely, so
  // /admin?token=… always fell back to an empty localStorage value and 401'd.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("token");
    const t = fromUrl ?? localStorage.getItem("adminToken") ?? "";
    setToken(t);
    if (fromUrl) localStorage.setItem("adminToken", fromUrl);
  }, []);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = tok ? `?token=${encodeURIComponent(tok)}` : "";
      const res = await fetch(`/api/admin${q}`);
      if (res.status === 401) {
        setError("Unauthorized — check the admin token.");
        setData(null);
        return;
      }
      if (!res.ok) {
        // Surface the server's reason. A 500 here is usually a schema drift
        // ("column … does not exist"), which is a very different fix from a
        // bad token — showing only the status code sends you hunting the wrong one.
        const detail = await res.text().catch(() => "");
        throw new Error(`request failed (${res.status}) ${detail.slice(0, 300)}`);
      }
      setData((await res.json()) as AdminData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Try an initial load (works locally without a token).
  useEffect(() => {
    load(localStorage.getItem("adminToken") ?? "");
  }, [load]);

  function applyToken() {
    localStorage.setItem("adminToken", token);
    load(token);
  }

  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const pct = (x: number | null) =>
    x === null ? "—" : `${Math.round(x * 100)}%`;
  const ms = (x: number | null) => (x === null ? "—" : `${x} ms`);
  const lkr = (x: number | null) =>
    x === null ? "—" : `Rs ${x.toLocaleString()}`;

  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" /> ALMA · Study Admin
      </div>

      <div className="panel">
        <div className="admin-head">
          <div>
            <h1>Study results</h1>
            {data && (
              <p className="muted" style={{ margin: 0 }}>
                storage: <code>{data.storage}</code> · material{" "}
                <code>{data.version}</code>
              </p>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <input
              type="password"
              placeholder="admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{
                font: "inherit",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--line-strong)",
                background: "var(--panel)",
                color: "var(--ink)",
              }}
            />
            <button className="btn" onClick={applyToken} disabled={loading}>
              {loading ? "Loading…" : "Load"}
            </button>
            <a className="btn" href={`/api/admin${q ? q + "&" : "?"}format=csv`}>
              Download CSV
            </a>
            <a className="btn" href={`/api/admin${q ? q + "&" : "?"}format=raw`}>
              Download JSON
            </a>
          </div>
        </div>

        {error && (
          <p className="muted" style={{ color: "#d66" }}>
            {error}
          </p>
        )}

        {data && (
          <>
            <div className="stat-grid">
              <Stat label="Participants" value={data.summary.participants} />
              <Stat
                label="Completed"
                value={`${data.summary.completed} / ${data.summary.participants}`}
              />
              <Stat label="Choices recorded" value={data.summary.responses} />
              <Stat
                label="Attention pass"
                value={pct(data.summary.attentionPassRate)}
              />
              <Stat
                label="Median decision"
                value={ms(data.summary.medianDecisionMs)}
              />
            </div>

            <h2 className="block-title">Room choices (stage 2)</h2>
            <div className="stat-grid" style={{ marginTop: 0 }}>
              <Stat label="Rooms picked" value={data.summary.roomChoices} />
              <Stat
                label="Chose above cheapest"
                value={pct(data.summary.upgradeRate)}
              />
              <Stat
                label="Median premium paid"
                value={lkr(data.summary.medianPremiumLkr)}
              />
              <Stat
                label="Chose refundable"
                value={pct(data.summary.refundableRate)}
              />
            </div>
            {data.summary.byBoard.length > 0 && (
              <p className="hint">
                Board basis:{" "}
                {data.summary.byBoard
                  .map((b) => `${b.board} (${b.count})`)
                  .join(" · ")}
              </p>
            )}

            <h2 className="block-title">Choice distribution by scenario</h2>
            {data.byScenario.map((s) => (
              <div key={s.scenarioId} className="scenario-dist">
                <div className="scenario-dist-head">
                  <strong>{s.persona}</strong>{" "}
                  <span className="muted">
                    · emphasises {s.primaryDimension} · {s.total} choices
                  </span>
                </div>
                {s.distribution.length === 0 ? (
                  <p className="muted">No responses yet.</p>
                ) : (
                  s.distribution.map((d) => {
                    const w = s.total ? (d.count / s.total) * 100 : 0;
                    return (
                      <div key={d.hotelId} className="dist-row">
                        <span className="dist-name">{d.hotel}</span>
                        <span className="dist-bar">
                          <span
                            className="dist-fill"
                            style={{ width: `${w}%` }}
                          />
                        </span>
                        <span className="dist-count">{d.count}</span>
                      </div>
                    );
                  })
                )}
              </div>
            ))}

            <h2 className="block-title">
              All responses ({data.responses.length})
            </h2>
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Scenario</th>
                    <th>Chose</th>
                    <th>Room</th>
                    <th className="num">Room price</th>
                    <th className="num">Decision</th>
                    <th>Attn</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.responses.map((r, i) => (
                    <tr key={i}>
                      <td title={r.participantId}>
                        {r.participantId.slice(0, 8)}
                      </td>
                      <td>{r.persona}</td>
                      <td>{r.chosenHotel}</td>
                      <td
                        title={
                          r.chosenRoom
                            ? `${r.roomBoard} · ${
                                r.roomRefundable
                                  ? "refundable"
                                  : "non-refundable"
                              } · 1 of ${r.nRoomsOffered}`
                            : undefined
                        }
                      >
                        {r.chosenRoom ?? "—"}
                      </td>
                      <td className="num">{lkr(r.roomPriceLkr)}</td>
                      <td className="num">
                        {r.decisionMs === null ? "—" : `${r.decisionMs} ms`}
                      </td>
                      <td>
                        {r.isAttentionCheck
                          ? r.attentionPass
                            ? "✓"
                            : "✗"
                          : "—"}
                      </td>
                      <td className="muted">
                        {r.submittedAt
                          ? new Date(r.submittedAt).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
