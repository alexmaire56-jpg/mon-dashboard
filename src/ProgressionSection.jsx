import React, { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot,
} from "recharts";
import {
  efficiencyOf, progressionByBucket, progressionIndex,
  interpretBucketProgress, contextAt, fmtPace, detectAnomalies,
} from "./analytics.js";
import { C, Card, Stat, bucketColors } from "./ui.jsx";

/* ---------- Anomalies ---------- */
const AnomaliesSection = ({ runs }) => {
  const anomalies = useMemo(() => detectAnomalies(runs), [runs]);
  if (!anomalies.length) return null;

  const fmtDate = (d) => (d instanceof Date ? d : new Date(d)).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Séances qui sortent de ta tendance</div>
      <div style={{ color: C.mut, fontSize: 12.5, marginBottom: 14 }}>
        Détectées automatiquement par comparaison à ton efficacité moyenne sur les 8 semaines précédentes.
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {anomalies.map((a, i) => (
          <div key={i} style={{ padding: "12px 14px", background: C.panel2, borderRadius: 10, borderLeft: `3px solid ${a.direction === "positive" ? C.green : C.amber}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontWeight: 600, color: a.direction === "positive" ? C.green : C.amber }}>{a.label}</span>
              <span style={{ color: C.dim, fontSize: 12 }}>{fmtDate(a.date)} · {a.distanceKm.toFixed(1)} km · {fmtPace(a.pace)}</span>
            </div>
            <div style={{ color: C.mut, fontSize: 13, lineHeight: 1.55 }}>{a.explanation}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

/* ---------- Progression principale ---------- */
const ProgressionSection = ({ runs }) => {
  const [idA, setIdA] = useState("");
  const [idB, setIdB] = useState("");

  const sorted = useMemo(() => [...runs].sort((a, b) => b.date - a.date), [runs]);
  const buckets = useMemo(() => progressionByBucket(runs), [runs]);
  const idx = useMemo(() => progressionIndex(runs, 6), [runs]);

  const sessA = sorted.find((r) => r.id === idA);
  const sessB = sorted.find((r) => r.id === idB);
  const ctxA = sessA ? contextAt(sessA, runs) : null;
  const ctxB = sessB ? contextAt(sessB, runs) : null;

  const fmtDate = (d) => (d instanceof Date ? d : new Date(d)).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

  const cmp = (label, valA, valB, lowerIsBetter = false, formatter = (v) => v) => {
    if (valA == null || valB == null) return { label, a: "—", b: "—", better: null };
    const better = lowerIsBetter ? valA < valB : valA > valB;
    return { label, a: formatter(valA), b: formatter(valB), better };
  };

  const rows = sessA && sessB ? [
    cmp("Allure", sessA.pace, sessB.pace, true, fmtPace),
    cmp("FC moyenne", sessA.avgHr, sessB.avgHr, true, (v) => `${Math.round(v)} bpm`),
    cmp("Efficacité (vitesse/FC)", efficiencyOf(sessA), efficiencyOf(sessB), false, (v) => v.toFixed(3)),
    cmp("Distance", sessA.distanceKm, sessB.distanceKm, false, (v) => `${v.toFixed(1)} km`),
    cmp("Dénivelé", sessA.elevationM, sessB.elevationM, true, (v) => `${Math.round(v)} m`),
  ].filter((r) => r.a !== "—" || r.b !== "—") : [];

  const verdictRows = rows.filter((r) => r.better !== null);
  const scoreA = verdictRows.filter((r) => r.better === true).length;
  const scoreB = verdictRows.filter((r) => r.better === false).length;

  const verdictText = () => {
    if (!verdictRows.length) return null;
    if (scoreA === scoreB) return "Les deux séances sont globalement équivalentes.";
    const winner = scoreA > scoreB ? "A" : "B";
    const winnerDate = winner === "A" ? fmtDate(sessA.date) : fmtDate(sessB.date);
    const score = Math.max(scoreA, scoreB);
    const efRow = rows.find((r) => r.label === "Efficacité (vitesse/FC)");
    const paceRow = rows.find((r) => r.label === "Allure");
    let nuance = "";
    if (efRow?.better !== null && paceRow?.better !== null && efRow.better !== paceRow.better) {
      nuance = " Nuance : la séance la plus rapide n'est pas la plus efficace (FC proportionnellement plus haute) — ça peut indiquer plus de fatigue ce jour-là.";
    }
    return `Séance ${winner} (${winnerDate}) est meilleure sur ${score}/${verdictRows.length} critères.${nuance}`;
  };

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontSize: 13, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>
        Progression · ai-je progressé ?
      </div>

      {/* anomalies */}
      <AnomaliesSection runs={runs} />

      {/* indice global */}
      {idx ? (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Indice de progression (efficacité aérobie)</div>
              <div style={{ color: C.mut, fontSize: 12.5, marginTop: 3 }}>
                {idx.recentCount} courses ({idx.weeks} dernières sem.) vs {idx.prevCount} courses ({idx.weeks} sem. précédentes)
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: idx.pct > 2 ? C.green : idx.pct < -2 ? C.red : C.mut }}>
              {idx.pct > 0 ? "+" : ""}{idx.pct}%
            </div>
          </div>
          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 8 }}>
            {idx.pct > 5 ? "Nette progression : tu vas plus vite pour une FC équivalente — ton moteur aérobie s'améliore."
              : idx.pct > 2 ? "Légère progression de ton efficacité aérobie."
              : idx.pct < -5 ? "Baisse notable d'efficacité — fatigue accumulée, manque de récup, ou période de charge lourde ?"
              : idx.pct < -2 ? "Légère baisse, à surveiller si ça persiste."
              : "Stable — ni progression ni régression nette sur la période."}
          </div>
        </Card>
      ) : (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ color: C.mut, fontSize: 13.5 }}>
            Pas encore assez de courses avec FC enregistrée pour calculer un indice fiable (besoin d'historique sur plusieurs semaines).
          </div>
        </Card>
      )}

      {/* évolution allure par distance */}
      {Object.keys(buckets).length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Évolution de l'allure par distance</div>
          <div style={{ color: C.mut, fontSize: 12.5, marginBottom: 14 }}>
            Seules les distances comparables (5k/10k/semi/marathon) sont regroupées. La courbe descend = tu progresses (allure plus rapide).
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
              <XAxis dataKey="date" type="category" allowDuplicatedCategory={false}
                tick={{ fill: C.dim, fontSize: 10 }} stroke={C.line}
                tickFormatter={(d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} />
              <YAxis reversed tick={{ fill: C.dim, fontSize: 11 }} stroke={C.line}
                tickFormatter={(v) => fmtPace(v).replace("/km", "")} />
              <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text }}
                labelFormatter={(d) => new Date(d).toLocaleDateString("fr-FR")} formatter={(v, n) => [fmtPace(v), n]} />
              {Object.entries(buckets).map(([label, pts]) => {
                const interp = interpretBucketProgress(pts);
                return (
                  <React.Fragment key={label}>
                    <Line data={pts.map((p) => ({ date: p.date.toISOString(), pace: p.pace }))}
                      dataKey="pace" name={label} stroke={bucketColors[label] || C.mut} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                    {interp && (
                      <ReferenceDot x={interp.best.date.toISOString()} y={interp.best.pace} r={6}
                        fill={bucketColors[label] || C.mut} stroke={C.text} strokeWidth={1.5} />
                    )}
                  </React.Fragment>
                );
              })}
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 14, marginTop: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {Object.keys(buckets).map((label) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.mut }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: bucketColors[label] || C.mut }} />{label}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dim }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "transparent", border: `1.5px solid ${C.text}` }} />
              meilleure perf
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(buckets).map(([label, pts]) => {
              const interp = interpretBucketProgress(pts);
              if (!interp) return null;
              const vColor = interp.verdict === "progression" ? C.green : interp.verdict === "regression" ? C.amber : C.mut;
              return (
                <div key={label} style={{ display: "flex", gap: 10, padding: "10px 12px", background: C.panel2, borderRadius: 8, fontSize: 13 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: bucketColors[label] || C.mut, marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontWeight: 600, color: vColor }}>{label} : </span>
                    <span style={{ color: C.mut }}>{interp.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* comparaison 2 séances */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Comparer deux séances</div>
        <div style={{ color: C.mut, fontSize: 12.5, marginBottom: 14 }}>
          Choisis deux courses — tu vois ce qui a changé, avec le contexte de forme au moment de chacune.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {[["A", idA, setIdA], ["B", idB, setIdB]].map(([lbl, val, set]) => (
            <select key={lbl} value={val} onChange={(e) => set(e.target.value)}
              style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, padding: "8px 10px", fontSize: 13, flex: 1, minWidth: 180 }}>
              <option value="">Séance {lbl}…</option>
              {sorted.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.date)} · {r.distanceKm.toFixed(1)}km · {fmtPace(r.pace)}</option>)}
            </select>
          ))}
        </div>

        {sessA && sessB ? (
          <div style={{ display: "grid", gap: 8 }}>
            {verdictText() && (
              <div style={{ padding: "12px 14px", background: "#1f2d1f", border: `1px solid ${C.green}55`, borderRadius: 8, fontSize: 13.5, color: C.text, marginBottom: 6 }}>
                {verdictText()}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8, fontSize: 11.5, color: C.dim, padding: "0 4px" }}>
              <span /><span style={{ textAlign: "center" }}>A · {fmtDate(sessA.date)}</span><span style={{ textAlign: "center" }}>B · {fmtDate(sessB.date)}</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8, alignItems: "center", padding: "10px 12px", background: C.panel2, borderRadius: 8, fontSize: 13.5 }}>
                <span style={{ color: C.mut }}>{r.label}</span>
                <span style={{ textAlign: "center", fontWeight: r.better === true ? 700 : 400, color: r.better === true ? C.green : C.text }}>{r.a}</span>
                <span style={{ textAlign: "center", fontWeight: r.better === false ? 700 : 400, color: r.better === false ? C.green : C.text }}>{r.b}</span>
              </div>
            ))}

            {(ctxA || ctxB) && (
              <>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 10, marginBottom: 2 }}>Contexte de forme à ce moment-là</div>
                {[["Charge (ACWR)", ctxA?.acwr?.toFixed(2) ?? "—", ctxB?.acwr?.toFixed(2) ?? "—"],
                  ["Jours depuis la sortie précédente", ctxA?.daysSincePrev ?? "—", ctxB?.daysSincePrev ?? "—"]].map(([label, a, b]) => (
                  <div key={label} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8, alignItems: "center", padding: "10px 12px", background: C.panel2, borderRadius: 8, fontSize: 13 }}>
                    <span style={{ color: C.mut }}>{label}</span>
                    <span style={{ textAlign: "center" }}>{a}</span>
                    <span style={{ textAlign: "center" }}>{b}</span>
                  </div>
                ))}
                <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>
                  Un ACWR &gt;1.3 au moment d'une séance = tu étais en charge lourde. Une moins bonne perf dans ce contexte n'est pas forcément une régression.
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: 20 }}>Sélectionne deux séances ci-dessus.</div>
        )}
      </Card>
    </div>
  );
};

export default ProgressionSection;
