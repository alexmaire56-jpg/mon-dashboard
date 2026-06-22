import React, { useState, useMemo } from "react";
import { buildCalendarData, impactTag, activityLoad, fmtPace, fmtDur, dayKey } from "./analytics.js";
import { C, Card } from "./ui.jsx";

const MONTHS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const DAYS_FR = ["L", "M", "M", "J", "V", "S", "D"];
const TYPE_ICONS = { "Course": "🏃", "Vélo": "🚴", "Natation": "🏊", "Renfo": "💪", "Marche": "🚶", "Autre": "•" };

/* ── couleur d'un jour selon la charge et les activités ── */
function dayColor(dayData) {
  if (!dayData || !dayData.sessions.length) return "transparent";
  const hasRun = dayData.sessions.some((s) => s.type === "Course");
  const load = dayData.totalLoad;
  const acwr = dayData.acwr;

  if (hasRun) {
    if (acwr > 1.4) return "#7a2020"; // charge élevée
    if (load > 80) return "#e8612c";   // sortie longue/intense
    if (load > 40) return "#5b9bd5";   // endurance
    return "#5dca8a";                   // récup/facile
  }
  // pas de course
  if (load > 60) return "#e0a93b";    // cross-training chargé
  return "#3d5a3d";                    // récup croisée légère
}

/* ── un mois du calendrier ── */
const MonthGrid = ({ year, month, calDays, onDayClick, selectedDay }) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // lundi = 0
  const today = dayKey(new Date());

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    cells.push(dayKey(date));
  }

  return (
    <div style={{ minWidth: 200 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.mut, marginBottom: 8, textAlign: "center" }}>
        {MONTHS_FR[month]} {year}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {DAYS_FR.map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, color: C.dim, paddingBottom: 4 }}>{d}</div>
        ))}
        {cells.map((k, i) => {
          if (!k) return <div key={i} />;
          const dayData = calDays[k];
          const color = dayColor(dayData);
          const isToday = k === today;
          const isSelected = k === selectedDay;
          const hasSessions = dayData?.sessions?.length > 0;
          return (
            <div key={k} onClick={() => hasSessions && onDayClick(k)}
              style={{
                aspectRatio: "1", borderRadius: 4, background: color || "transparent",
                border: isSelected ? `2px solid ${C.text}` : isToday ? `1px solid ${C.mut}` : `1px solid transparent`,
                cursor: hasSessions ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: color ? C.text : C.dim, opacity: k > today ? 0.4 : 1,
                transition: "opacity 0.15s",
              }}>
              {new Date(k + "T12:00:00").getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── détail d'un jour sélectionné ── */
const DayDetail = ({ dayData, onClose }) => {
  if (!dayData?.sessions?.length) return null;
  const date = new Date(dayData.date + "T12:00:00");
  return (
    <div style={{ marginTop: 16, padding: "14px 16px", background: C.panel2, borderRadius: 10, border: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.dim, cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {dayData.sessions.map((s, i) => {
          const pace = s.type === "Course" && s.distanceKm > 0 ? s.durationMin / s.distanceKm : null;
          return (
            <div key={i} style={{ padding: "10px 12px", background: C.panel, borderRadius: 8, borderLeft: `3px solid ${s.impact.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{TYPE_ICONS[s.type] || "•"} {s.name || s.type}</span>
                <span style={{ fontSize: 11.5, color: C.dim }}>{s.impact.tag}</span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.mut, flexWrap: "wrap" }}>
                {s.distanceKm > 0 && <span>{s.distanceKm.toFixed(1)} km</span>}
                <span>{fmtDur(s.durationMin)}</span>
                {pace && <span>{fmtPace(pace)}</span>}
                {s.avgHr && <span>♡ {Math.round(s.avgHr)} bpm</span>}
                {s.elevationM > 0 && <span>↑ {Math.round(s.elevationM)} m</span>}
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>{s.impact.detail}</div>
            </div>
          );
        })}
      </div>
      {dayData.acwr > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.dim }}>
          Charge ce jour-là : ACWR {dayData.acwr.toFixed(2)} — {dayData.acwr > 1.4 ? "⚠️ charge élevée" : dayData.acwr > 1.1 ? "zone de vigilance" : dayData.acwr >= 0.8 ? "zone optimale" : "sous-charge"}
        </div>
      )}
    </div>
  );
};

/* ── historique liste avec filtres ── */
const HistoryList = ({ sessions }) => {
  const [filter, setFilter] = useState("Tous");
  const [search, setSearch] = useState("");

  const types = useMemo(() => {
    const t = new Set(sessions.map((s) => s.type));
    return ["Tous", ...Array.from(t)];
  }, [sessions]);

  const filtered = useMemo(() => {
    return [...sessions]
      .sort((a, b) => {
        const da = a.date instanceof Date ? a.date : new Date(a.date);
        const db = b.date instanceof Date ? b.date : new Date(b.date);
        return db - da;
      })
      .filter((s) => {
        const matchType = filter === "Tous" || s.type === filter;
        const matchSearch = !search || (s.name || "").toLowerCase().includes(search.toLowerCase());
        return matchType && matchSearch;
      });
  }, [sessions, filter, search]);

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une séance…"
          style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, padding: "7px 12px", fontSize: 13, flex: 1, minWidth: 160 }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {types.map((t) => (
            <button key={t} onClick={() => setFilter(t)}
              style={{ background: filter === t ? C.accent : C.panel2, color: filter === t ? "#1a0d06" : C.mut, border: `1px solid ${filter === t ? C.accent : C.line}`, borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: filter === t ? 600 : 400 }}>
              {TYPE_ICONS[t] || ""} {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>{filtered.length} séance{filtered.length > 1 ? "s" : ""}</div>

      <div style={{ display: "grid", gap: 6, maxHeight: 480, overflowY: "auto", paddingRight: 4 }}>
        {filtered.map((s, i) => {
          const d = s.date instanceof Date ? s.date : new Date(s.date);
          const pace = s.type === "Course" && s.distanceKm > 0 ? s.durationMin / s.distanceKm : null;
          const impact = impactTag(s, 1.0);
          const load = activityLoad(s);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 10, alignItems: "center", padding: "9px 12px", background: C.panel2, borderRadius: 8, fontSize: 13, borderLeft: `3px solid ${impact.color}` }}>
              <span style={{ color: C.dim, fontSize: 11.5 }}>{d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
              <div>
                <div style={{ fontWeight: 500 }}>{TYPE_ICONS[s.type] || "•"} {s.name || s.type}</div>
                <div style={{ color: C.dim, fontSize: 11.5, marginTop: 2 }}>
                  {s.distanceKm > 0 ? `${s.distanceKm.toFixed(1)} km · ` : ""}{fmtDur(s.durationMin)}{pace ? ` · ${fmtPace(pace)}` : ""}{s.avgHr ? ` · ♡ ${Math.round(s.avgHr)}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: impact.color, fontWeight: 600 }}>{impact.tag}</div>
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2 }}>charge {Math.round(load)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── composant principal ── */
const HistoryCalendar = ({ sessions }) => {
  const [selectedDay, setSelectedDay] = useState(null);

  const calDays = useMemo(() => buildCalendarData(sessions, 3), [sessions]);

  // génère les 3 derniers mois
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 3 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (2 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  // sessions des 3 derniers mois pour l'historique
  const recentSessions = useMemo(() => {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3);
    return sessions.filter((s) => {
      const d = s.date instanceof Date ? s.date : new Date(s.date);
      return d >= cutoff;
    });
  }, [sessions]);

  // légende
  const legend = [
    { color: "#5dca8a", label: "Course facile / récup" },
    { color: "#5b9bd5", label: "Endurance" },
    { color: "#e8612c", label: "Séance intense" },
    { color: "#7a2020", label: "Charge élevée (ACWR)" },
    { color: "#e0a93b", label: "Cross-training chargé" },
    { color: "#3d5a3d", label: "Récup croisée" },
  ];

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontSize: 13, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>
        Calendrier & historique · 3 derniers mois
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Calendrier d'entraînement</div>
        <div style={{ color: C.mut, fontSize: 12.5, marginBottom: 16 }}>
          Chaque jour coloré = séance. La couleur reflète l'impact sur ta préparation. Clique sur un jour pour voir le détail.
        </div>

        {/* grilles des 3 mois */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "space-between" }}>
          {months.map(({ year, month }) => (
            <MonthGrid key={`${year}-${month}`} year={year} month={month}
              calDays={calDays} onDayClick={setSelectedDay} selectedDay={selectedDay} />
          ))}
        </div>

        {/* légende */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          {legend.map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.dim }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />{label}
            </div>
          ))}
        </div>

        {/* détail du jour sélectionné */}
        {selectedDay && calDays[selectedDay] && (
          <DayDetail dayData={calDays[selectedDay]} onClose={() => setSelectedDay(null)} />
        )}
      </Card>

      {/* historique liste */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Historique détaillé</div>
        <div style={{ color: C.mut, fontSize: 12.5 }}>
          Toutes tes activités avec leur impact sur la prépa running. Filtre par sport ou recherche par nom.
        </div>
        <HistoryList sessions={recentSessions} />
      </Card>
    </div>
  );
};

export default HistoryCalendar;
