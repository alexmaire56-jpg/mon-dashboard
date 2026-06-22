import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";

import {
  fmtPace, fmtDur, fmtTime, dayKey, startOfWeek,
  normType, analyze, recommend, generateCoachDigest,
} from "./analytics.js";
import { C, Card, Stat, levelColor, formStatus, SessionCard, SessionAnalysis, DeepAnalysis } from "./ui.jsx";
import ProgressionSection from "./ProgressionSection.jsx";
import HistoryCalendar from "./HistoryCalendar.jsx";
import { apiUrl } from "./api.js";

/* ---------- parsing Strava CSV ---------- */
function parseCSV(text) {
  const rows = []; let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i+1] === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { cur.push(field); field = ""; } else if (c === "\n" || c === "\r") { if (field !== "" || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ""; } if (c === "\r" && text[i+1] === "\n") i++; } else field += c; }
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
const findCol = (headers, ...cands) => { const norm = headers.map((h) => h.toLowerCase().trim()); for (const cand of cands) { const idx = norm.findIndex((h) => h.includes(cand.toLowerCase())); if (idx >= 0) return idx; } return -1; };

function parseStrava(text) {
  const rows = parseCSV(text); if (rows.length < 2) return [];
  const h = rows[0];
  const cDate = findCol(h, "activity date", "date de l'activité", "date de l", "date");
  const cType = findCol(h, "activity type", "type d'activité", "type d");
  const cDist = findCol(h, "distance");
  const cMov = findCol(h, "moving time", "durée de déplacement");
  const cElap = findCol(h, "elapsed time", "temps écoulé");
  const cAhr = findCol(h, "average heart rate", "fréquence cardiaque moyenne");
  const cMhr = findCol(h, "max heart rate", "fréquence cardiaque maximale");
  const cElev = findCol(h, "elevation gain", "dénivelé positif");
  const cName = findCol(h, "activity name", "nom de l'activité", "nom");
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || row.length < 3) continue;
    const dRaw = row[cDate]; if (!dRaw) continue;
    const date = new Date(dRaw.replace(/-/g, "/")); if (isNaN(date)) continue;
    let distKm = parseFloat((row[cDist] || "").replace(",", ".")); if (isNaN(distKm)) distKm = 0; if (distKm > 1000) distKm /= 1000;
    let mov = parseFloat((row[cMov] || "").replace(",", ".")); if (isNaN(mov)) mov = parseFloat((row[cElap] || "").replace(",", ".")) || 0;
    const ahr = parseFloat((row[cAhr] || "").replace(",", ".")) || null;
    const mhr = parseFloat((row[cMhr] || "").replace(",", ".")) || null;
    const elev = parseFloat((row[cElev] || "").replace(",", ".")) || 0;
    out.push({ id: `s-${r}-${+date}`, date, type: normType(row[cType] || ""), rawType: row[cType] || "", distanceKm: distKm, durationMin: mov / 60, avgHr: ahr, maxHr: mhr, elevationM: elev, name: cName >= 0 ? row[cName] : "", source: "Strava" });
  }
  return out;
}

function parseAppleHealth(text) {
  const out = []; const re = /<Workout\b([^>]*?)(?:\/>|>)/g; let m, i = 0;
  while ((m = re.exec(text)) !== null) {
    const attrs = {}; const aRe = /(\w+)="([^"]*)"/g; let a;
    while ((a = aRe.exec(m[1])) !== null) attrs[a[1]] = a[2];
    const start = attrs.startDate ? new Date(attrs.startDate) : null; if (!start || isNaN(start)) continue;
    let dur = parseFloat(attrs.duration) || 0; if ((attrs.durationUnit || "min").startsWith("s")) dur /= 60;
    let dist = parseFloat(attrs.totalDistance) || 0; const du = (attrs.totalDistanceUnit || "km").toLowerCase();
    if (du.startsWith("mi")) dist *= 1.60934; else if (du === "m") dist /= 1000;
    out.push({ id: `a-${i++}-${+start}`, date: start, type: normType(attrs.workoutActivityType || ""), rawType: attrs.workoutActivityType || "", distanceKm: dist, durationMin: dur, avgHr: null, maxHr: null, elevationM: 0, name: "", source: "Apple" });
  }
  return out;
}

/* ---------- Résumé hebdo (moteur expert local, zéro API) ---------- */
const WeeklyDigest = ({ a, advanced, health, goal }) => {
  const digest = useMemo(
    () => generateCoachDigest({ a, advanced, health, goal }),
    [a, advanced, health, goal]
  );

  // formate le markdown simple (**gras**) en JSX
  const renderLine = (line, i) => {
    const parts = line.split(/\*\*(.+?)\*\*/g);
    return (
      <div key={i} style={{ marginBottom: 10 }}>
        {parts.map((p, j) =>
          j % 2 === 1
            ? <strong key={j} style={{ color: C.text }}>{p}</strong>
            : <span key={j}>{p}</span>
        )}
      </div>
    );
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Analyse de la semaine</div>
        <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
          Générée automatiquement à partir de tes données — mise à jour à chaque synchronisation
        </div>
      </div>
      <div style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.7 }}>
        {digest.split("\n\n").map((line, i) => renderLine(line, i))}
      </div>
    </Card>
  );
};

/* ---------- App ---------- */
export default function App() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [strava, setStrava] = useState({ connected: false, configured: false, athlete: null });
  const [backendUp, setBackendUp] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [advanced, setAdvanced] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthInfo, setHealthInfo] = useState(null);
  const [coachReady, setCoachReady] = useState(false);
  const [goal, setGoal] = useState(() => { try { return JSON.parse(localStorage.getItem("goal")) || null; } catch { return null; } });
  const [goalForm, setGoalForm] = useState({ race: "", distanceKm: "10", date: "", targetTime: "" });
  const [hrSettings, setHrSettings] = useState(() => { try { return JSON.parse(localStorage.getItem("hr-settings")) || { maxHr: 190, lthr: 170, restHr: 50 }; } catch { return { maxHr: 190, lthr: 170, restHr: 50 }; } });
  const fileRef = useRef();

  useEffect(() => {
    try { const raw = localStorage.getItem("training-sessions"); if (raw) setSessions(JSON.parse(raw).map((s) => ({ ...s, date: new Date(s.date) }))); } catch {}
    setLoading(false);
  }, []);

  const persist = (arr) => { try { localStorage.setItem("training-sessions", JSON.stringify(arr.map((s) => ({ ...s, date: s.date.toISOString() })))); } catch (e) { console.error(e); } };

  const mergeSessions = (incoming) => {
    const norm = incoming.map((s) => ({ ...s, date: s.date instanceof Date ? s.date : new Date(s.date) }));
    const merged = [...sessions];
    const seen = new Set(merged.map((s) => `${dayKey(s.date)}-${Math.round(s.distanceKm * 10)}-${Math.round(s.durationMin)}`));
    let n = 0;
    norm.forEach((s) => { const k = `${dayKey(s.date)}-${Math.round(s.distanceKm * 10)}-${Math.round(s.durationMin)}`; if (!seen.has(k)) { seen.add(k); merged.push(s); n++; } });
    setSessions(merged); persist(merged);
    return { added: n, total: norm.length };
  };

  const refreshStatus = async () => {
    try { const r = await fetch(apiUrl("/api/strava/status")); const d = await r.json(); setStrava(d); setCoachReady(!!d.coachReady); setBackendUp(true); return d; }
    catch { setBackendUp(false); setStrava({ connected: false, configured: false, athlete: null }); return null; }
  };

  const fetchHealth = async () => {
    try { const [d, info] = await Promise.all([fetch(apiUrl("/api/health/data")).then((r) => r.json()), fetch(apiUrl("/api/health/info")).then((r) => r.json())]); if (d?.series?.length) setHealth(d); setHealthInfo(info); } catch {}
  };

  const fetchAdvanced = async (settings = hrSettings) => {
    try { const q = `maxHr=${settings.maxHr}&lthr=${settings.lthr}&restHr=${settings.restHr}`; const r = await fetch(apiUrl(`/api/strava/advanced?${q}`)); const d = await r.json(); if (d && (d.detailedCount > 0 || d.pmc?.length)) setAdvanced(d); } catch {}
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const st = params.get("strava");
    if (st === "connected") setMsg("Strava connecté. Clique sur « Synchroniser ».");
    else if (st === "error") setMsg("La connexion Strava a échoué.");
    if (st) window.history.replaceState({}, "", window.location.pathname);
    refreshStatus();
  }, []);

  useEffect(() => { fetchAdvanced(); fetchHealth(); }, []);

  const syncStrava = async () => {
    setSyncing(true); setMsg("");
    try {
      const r = await fetch(apiUrl("/api/strava/activities?pages=5"));
      if (r.status === 401) { setMsg("Pas encore connecté à Strava."); setSyncing(false); return; }
      if (r.status === 429) { setMsg("Limite Strava atteinte. Réessaie dans 15 min."); setSyncing(false); return; }
      const d = await r.json(); if (!d.sessions?.length) { setMsg("Aucune activité récupérée."); setSyncing(false); return; }
      const { added, total } = mergeSessions(d.sessions);
      setMsg(`Strava : ${added} nouvelle(s) sur ${total}. Récupération des données détaillées…`);
      const er = await fetch(apiUrl("/api/strava/enrich?days=90&cap=40")); const ed = await er.json().catch(() => ({}));
      await fetchAdvanced();
      let extra = ed.remaining > 0 ? ` ${ed.remaining} course(s) restante(s) — resynchronise pour compléter.` : ed.rateLimited ? " Limite Strava atteinte sur les détails." : "";
      setMsg(`Strava : ${added} nouvelle(s) séance(s). Données détaillées à jour.${extra}`);
    } catch { setMsg("Erreur de synchronisation."); }
    setSyncing(false);
  };

  const disconnectStrava = async () => {
    if (!window.confirm("Déconnecter Strava ?")) return;
    try { await fetch(apiUrl("/api/strava/disconnect"), { method: "POST" }); } catch {}
    setAdvanced(null); await refreshStatus(); setMsg("Strava déconnecté.");
  };

  const handleFiles = async (files) => {
    let added = [];
    for (const f of files) {
      const text = await f.text();
      if (f.name.toLowerCase().endsWith(".csv") || /Activity Date|Date de l/i.test(text.slice(0, 500))) added = added.concat(parseStrava(text));
      else if (f.name.toLowerCase().endsWith(".xml") || /<Workout/.test(text.slice(0, 5000))) added = added.concat(parseAppleHealth(text));
      else added = added.concat(parseStrava(text));
    }
    if (!added.length) { setMsg("Aucune séance reconnue."); return; }
    const { added: n } = mergeSessions(added);
    setMsg(`${n} nouvelle(s) séance(s) importée(s).`);
  };

  const saveGoal = () => {
    const t = goalForm.targetTime.trim(); let sec = null;
    if (t) { const p = t.split(":").map(Number); if (p.length === 3) sec = p[0]*3600+p[1]*60+p[2]; else if (p.length === 2) sec = p[0]*60+p[1]; }
    const g = { race: goalForm.race || "Objectif", distanceKm: parseFloat(goalForm.distanceKm) || 10, date: goalForm.date, targetSec: sec };
    setGoal(g); try { localStorage.setItem("goal", JSON.stringify(g)); } catch {}
  };
  const clearGoal = () => { setGoal(null); try { localStorage.removeItem("goal"); } catch {} };
  const updateHr = (key, val) => {
    const next = { ...hrSettings, [key]: Math.max(30, Math.min(230, parseInt(val) || 0)) };
    setHrSettings(next); try { localStorage.setItem("hr-settings", JSON.stringify(next)); } catch {}
    fetchAdvanced(next);
  };

  const a = useMemo(() => (sessions.length ? analyze(sessions) : null), [sessions]);
  const recs = useMemo(() => (a ? recommend(a) : []), [a]);
  const acwrPct = a ? Math.min(100, (a.acwr / 2) * 100) : 0;
  const recentSessions = useMemo(() => {
    const limit = new Date(); limit.setDate(limit.getDate() - 14);
    return [...sessions].map((s) => ({ ...s, date: s.date instanceof Date ? s.date : new Date(s.date) })).filter(s => !isNaN(s.date) && s.date >= limit).sort((a, b) => b.date - a.date);
  }, [sessions]);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "28px 20px 60px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 12, color: C.accent, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 }}>Carnet d'entraînement</div>
            <h1 style={{ fontSize: 30, fontWeight: 700, margin: "4px 0 0", letterSpacing: -0.5 }}>Analyse des séances</h1>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {strava.connected ? (
              <>
                <button onClick={syncStrava} disabled={syncing} style={{ background: "#fc4c02", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, cursor: syncing ? "default" : "pointer", fontSize: 14, opacity: syncing ? 0.6 : 1 }}>{syncing ? "Synchro…" : "↻ Synchroniser Strava"}</button>
                <button onClick={disconnectStrava} style={{ background: "transparent", color: C.mut, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 14px", cursor: "pointer", fontSize: 14 }}>Déconnecter</button>
              </>
            ) : (
              <button onClick={() => { if (!backendUp) { setMsg("Backend hors ligne."); return; } window.location.href = apiUrl("/api/strava/auth"); }} style={{ background: "#fc4c02", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Connecter Strava</button>
            )}
            <button onClick={() => fileRef.current?.click()} style={{ background: C.accent, color: "#1a0d06", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>+ Importer</button>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xml" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: !backendUp ? C.red : strava.connected ? C.green : C.dim }} />
          <span style={{ color: C.mut }}>{!backendUp ? "Backend hors ligne — lance « npm run dev »." : strava.connected ? `Strava connecté${strava.athlete?.firstname ? ` · ${strava.athlete.firstname}` : ""}` : "Strava non connecté."}</span>
        </div>

        {msg && <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 14px", color: C.mut, fontSize: 13, marginBottom: 18 }}>{msg}</div>}

        {loading ? (
          <div style={{ color: C.mut, padding: 40, textAlign: "center" }}>Chargement…</div>
        ) : !a ? (
          <Card style={{ textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Importe tes données pour commencer</div>
            <button onClick={() => fileRef.current?.click()} style={{ marginTop: 22, background: C.accent, color: "#1a0d06", border: "none", borderRadius: 9, padding: "12px 22px", fontWeight: 600, cursor: "pointer", fontSize: 15 }}>Choisir un fichier</button>
          </Card>
        ) : (
          <>
            {/* stats clés */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <Stat label="Séances course" value={a.totalRuns} sub={`${a.totalKm} km cumulés`} />
              <Stat label="Volume 7 j" value={`${Math.round(a.weeks.at(-1)?.km || 0)} km`} sub={`${a.weeks.at(-1)?.count || 0} sorties`} />
              <Stat label="VO₂max estimé" value={a.vo2 ?? "—"} sub="ml/kg/min" accent={C.accentSoft} />
              <Stat label="Jours d'affilée" value={a.streak} />
            </div>

            <DeepAnalysis a={a} />

            {/* résumé hebdo IA */}
            <WeeklyDigest a={a} advanced={advanced} health={health} goal={goal} />

            {selectedSession && <SessionAnalysis session={selectedSession} runs={a.runs} onClose={() => setSelectedSession(null)} />}

            {/* ACWR */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Charge d'entraînement · ratio aigu/chronique</div>
                  <div style={{ color: C.mut, fontSize: 12.5, marginTop: 3 }}>Charge des 7 derniers jours ÷ moyenne hebdo des 28 jours</div>
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: a.acwr > 1.5 ? C.red : a.acwr > 1.3 ? C.amber : a.acwr >= 0.8 ? C.green : C.blue }}>{a.acwr ? a.acwr.toFixed(2) : "—"}</div>
              </div>
              <div style={{ position: "relative", height: 12, borderRadius: 6, overflow: "hidden", display: "flex" }}>
                <div style={{ width: "40%", background: "#2c3a4a" }} /><div style={{ width: "25%", background: "#2f4733" }} /><div style={{ width: "10%", background: "#4a4228" }} /><div style={{ flex: 1, background: "#4a2c28" }} />
                <div style={{ position: "absolute", top: -3, bottom: -3, left: `${acwrPct}%`, width: 2.5, background: C.text }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.dim, marginTop: 6 }}>
                <span>sous-charge</span><span>0.8–1.3 optimal</span><span>1.3–1.5</span><span>&gt;1.5 risque</span>
              </div>
            </Card>

            {/* historique 14j */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Historique des 14 derniers jours</div>
              <div style={{ display: "grid", gap: 10 }}>
                {recentSessions.map((session) => <SessionCard key={session.id} session={session} onSelect={setSelectedSession} />)}
              </div>
            </Card>

            {/* recommandations */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Recommandations</div>
              <div style={{ display: "grid", gap: 10 }}>
                {recs.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 13, background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${levelColor[r.level]}`, borderRadius: 10, padding: "13px 16px" }}>
                    <div style={{ color: levelColor[r.level], fontSize: 18, lineHeight: 1.3, flexShrink: 0 }}>{r.icon}</div>
                    <div><div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 3 }}>{r.title}</div><div style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.55 }}>{r.body}</div></div>
                  </div>
                ))}
              </div>
            </div>

            {/* prédictions */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Prédictions de chrono</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
                {a.predictions.map((p) => (
                  <div key={p.d} style={{ background: C.panel2, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ color: C.mut, fontSize: 12.5, marginBottom: 6 }}>{p.d}</div>
                    <div style={{ fontSize: 23, fontWeight: 700, color: C.accentSoft }}>{fmtTime(p.sec)}</div>
                    <div style={{ color: C.dim, fontSize: 11.5 }}>{fmtPace(p.pace)}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* progression */}
            <ProgressionSection runs={a.runs} />

            {/* calendrier & historique */}
            <HistoryCalendar sessions={sessions} />

            {/* objectif */}
            <div style={{ marginTop: 30 }}>
              <div style={{ fontSize: 13, color: C.dim, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Objectif</div>
              <Card style={{ marginBottom: 20 }}>
                {goal ? (() => {
                  const pred = a.predictions.find((p) => Math.abs(p.km - goal.distanceKm) < 0.6);
                  const weeksLeft = goal.date ? Math.max(0, Math.round((new Date(goal.date) - new Date()) / 604800000)) : null;
                  const onTrack = goal.targetSec && pred ? pred.sec <= goal.targetSec : null;
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                        <div style={{ fontSize: 17, fontWeight: 700 }}>{goal.race} · {goal.distanceKm} km</div>
                        <button onClick={clearGoal} style={{ background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>Changer</button>
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
                        {weeksLeft != null && <Stat label="Semaines restantes" value={weeksLeft} />}
                        {goal.targetSec && <Stat label="Temps visé" value={fmtTime(goal.targetSec)} />}
                        {pred && <Stat label="Projection actuelle" value={fmtTime(pred.sec)} accent={onTrack ? C.green : C.amber} sub={onTrack ? "objectif atteignable" : "à travailler"} />}
                      </div>
                    </div>
                  );
                })() : (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Définis un objectif de course</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {[["Nom", "race", "Marathon de Paris", "text", 160], ["Distance (km)", "distanceKm", "", "number", 90], ["Date", "date", "", "date", null], ["Temps visé (h:m:s)", "targetTime", "3:30:00", "text", 110]].map(([lbl, key, ph, type, w]) => (
                        <div key={key}><div style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>{lbl}</div><input type={type} value={goalForm[key]} onChange={(e) => setGoalForm({ ...goalForm, [key]: e.target.value })} placeholder={ph} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, padding: "8px 10px", fontSize: 14, ...(w ? { width: w } : {}) }} /></div>
                      ))}
                      <button onClick={saveGoal} style={{ background: C.accent, color: "#1a0d06", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Définir</button>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <div style={{ textAlign: "center", color: C.dim, fontSize: 11.5, marginTop: 26, lineHeight: 1.6 }}>
              Estimations indicatives (Riegel, ACWR, VO₂max Daniels-Gilbert) — pas un avis médical.<br />Écoute tes sensations.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
