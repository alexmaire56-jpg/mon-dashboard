import React from "react";
import { fmtPace, fmtDur, fmtTime } from "./analytics.js";
import { apiUrl } from "./api.js";

/* ---------- palette ---------- */
export const C = {
  bg: "#13110f",
  panel: "#1c1916",
  panel2: "#252119",
  line: "#332e26",
  text: "#f0ebe2",
  mut: "#a39b8c",
  dim: "#6f685c",
  accent: "#e8612c",
  accentSoft: "#f59e6b",
  green: "#5dca8a",
  amber: "#e0a93b",
  red: "#e2544a",
  blue: "#5b9bd5",
};

export const levelColor = { high: C.red, mid: C.amber, ok: C.green, low: C.blue, info: C.mut };
export const bucketColors = { "5 km": C.green, "10 km": C.blue, "Semi": C.amber, "Marathon": C.red };

/* ---------- atomes ---------- */
export const Card = ({ children, style }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, ...style }}>{children}</div>
);

export const Stat = ({ label, value, sub, accent }) => (
  <div style={{ background: C.panel2, borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 120 }}>
    <div style={{ color: C.dim, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
    <div style={{ color: accent || C.text, fontSize: 26, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ color: C.mut, fontSize: 12, marginTop: 5 }}>{sub}</div>}
  </div>
);

export function formStatus(tsb) {
  if (tsb == null) return { label: "—", color: C.mut, txt: "" };
  if (tsb > 15) return { label: "Très frais", color: C.blue, txt: "Forme de pic." };
  if (tsb > 5) return { label: "Frais", color: C.green, txt: "Prêt pour une séance." };
  if (tsb >= -10) return { label: "Équilibré", color: C.green, txt: "Progression idéale." };
  if (tsb >= -30) return { label: "Fatigue productive", color: C.amber, txt: "Normal en bloc, surveille la récup." };
  return { label: "Fatigue élevée", color: C.red, txt: "Charge très lourde, prévois du repos." };
}

/* ---------- SessionCard (liste des séances récentes) ---------- */
export const SessionCard = ({ session, onSelect }) => {
  const d = session.date instanceof Date ? session.date : new Date(session.date);
  const pace = session.distanceKm > 0 ? session.durationMin / session.distanceKm : null;
  return (
    <div onClick={() => onSelect(session)} style={{ cursor: "pointer", background: C.panel2, borderRadius: 10, padding: 14, border: `1px solid ${C.line}`, transition: "0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{session.name || session.type}</div>
          <div style={{ color: C.mut, fontSize: 12 }}>{isNaN(d) ? "—" : d.toLocaleDateString()}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>{session.distanceKm.toFixed(1)} km</div>
          <div style={{ color: C.accentSoft, fontSize: 13 }}>{fmtPace(pace)}</div>
        </div>
      </div>
    </div>
  );
};

/* ---------- SessionAnalysis (détail d'une séance cliquée) ---------- */
export const SessionAnalysis = ({ session, runs, onClose }) => {
  const [appleData, setAppleData] = React.useState({ loading: true, intervals: null });

  React.useEffect(() => {
    let cancelled = false;
    const d = session.date instanceof Date ? session.date : new Date(session.date);
    fetch(apiUrl(`/api/apple/match?date=${encodeURIComponent(d.toISOString())}&type=${encodeURIComponent(session.type || "Course")}`))
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setAppleData({ loading: false, intervals: data.workout?.intervals || null }); })
      .catch(() => { if (!cancelled) setAppleData({ loading: false, intervals: null }); });
    return () => { cancelled = true; };
  }, [session]);

  const pace = session.durationMin / session.distanceKm;
  const avgPace = runs.length ? runs.reduce((s, r) => s + r.pace, 0) / runs.length : null;
  const paceDelta = avgPace ? ((avgPace - pace) / avgPace) * 100 : 0;
  const avgDist = runs.length ? runs.reduce((s, r) => s + r.distanceKm, 0) / runs.length : null;
  const intervals = appleData.intervals;
  const efforts = intervals ? intervals.filter((i) => i.type === "Effort") : [];

  return (
    <Card style={{ marginBottom: 20, border: `2px solid ${C.accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Analyse de la séance</h2>
        <button onClick={onClose} style={{ background: C.red, border: "none", color: "#fff", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>Fermer</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <Stat label="Distance" value={`${session.distanceKm.toFixed(1)} km`} />
        <Stat label="Durée" value={fmtDur(session.durationMin)} />
        <Stat label="Allure" value={fmtPace(pace)} />
        <Stat label="FC moyenne" value={session.avgHr || "—"} />
        <Stat label="FC max" value={session.maxHr || "—"} />
        <Stat label="D+" value={`${session.elevationM || 0} m`} />
      </div>

      {!appleData.loading && intervals && efforts.length >= 2 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Intervalles détectés ({efforts.length} efforts)</div>
          <div style={{ display: "grid", gap: 6 }}>
            {intervals.map((seg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", background: seg.type === "Effort" ? "#3a2418" : C.panel2, borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: seg.type === "Effort" ? C.accentSoft : C.mut, fontWeight: 600 }}>{seg.type}</span>
                <span>{fmtDur(seg.durationSec / 60)}</span>
                <span style={{ color: C.mut }}>{seg.avgHr ? `${seg.avgHr} bpm` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, padding: 16, background: C.panel2, borderRadius: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Analyse IA</div>
        <div style={{ color: C.mut }}>
          {paceDelta > 5 && "🔥 Cette séance est significativement plus rapide que ta moyenne."}
          {paceDelta < -5 && "🐢 Cette séance est plus lente que ta moyenne habituelle."}
          {Math.abs(paceDelta) <= 5 && "⚖️ Cette séance est très proche de ton niveau moyen."}
          <br /><br />
          FC moyenne : {session.avgHr ? `${session.avgHr} bpm` : "non disponible"}
          <br /><br />
          Cette sortie représente {avgDist ? (session.distanceKm / avgDist).toFixed(1) : "—"}x ton volume moyen par séance.
        </div>
      </div>
    </Card>
  );
};

/* ---------- DeepAnalysis (encart marathon) ---------- */
export const DeepAnalysis = ({ a }) => {
  const raceDate = new Date("2026-09-26");
  const today = new Date();
  const daysLeft = Math.ceil((raceDate - today) / 86400000);
  const isHealthy = a.acwr >= 0.8 && a.acwr <= 1.3;
  return (
    <Card style={{ marginBottom: 20, borderColor: C.accentSoft }}>
      <div style={{ fontSize: 13, color: C.accentSoft, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 10 }}>
        Préparation Marathon · {daysLeft} jours restants
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: C.mut }}>Statut actuel</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: isHealthy ? C.green : C.amber }}>
            {isHealthy ? "Zone de progression idéale" : "Attention à la charge"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: C.mut }}>Conseil</div>
          <div style={{ fontSize: 14, color: C.text }}>
            {daysLeft > 60 ? "Phase de volume : construis ton endurance de base."
              : daysLeft > 20 ? "Phase de pic : affine ton allure marathon."
              : "Phase d'affûtage : réduit le volume, garde l'intensité."}
          </div>
        </div>
      </div>
    </Card>
  );
};
