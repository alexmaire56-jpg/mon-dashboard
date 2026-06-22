import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_FILE = path.join(__dirname, "strava-tokens.json");

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3001;
const FRONTEND = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BACKEND_URL}/api/strava/callback`;

const app = express();

// CORS : autorise le frontend Netlify (et localhost en dev)
app.use((req, res, next) => {
  const allowed = [
    FRONTEND,
    "http://localhost:5173",
    "http://localhost:4173",
  ].filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.some((o) => origin.startsWith(o))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "60mb" }));

/* ---------- migration ponctuelle des anciens fichiers JSON vers SQLite ---------- */
const migration = db.migrateLegacyJSON();
if (migration.migrated) console.log(`  ✓ Migration vers SQLite : ${migration.counts.activities} activités, ${migration.counts.details} détails, ${migration.counts.health} jours santé\n`);

/* ---------- stockage tokens (reste en JSON, fichier sensible séparé) ---------- */
const loadJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } };
const saveJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const loadTokens = () => loadJSON(TOKENS_FILE, null);
const saveTokens = (t) => saveJSON(TOKENS_FILE, t);

// reconstruit la même forme d'objet qu'avant ({summaries, details}), maintenant lue depuis SQLite
const loadCache = () => {
  const summaries = db.getAllActivitySummaries().map((r) => ({
    id: r.strava_id, date: r.date, type: r.type,
    moving_time: Math.round((r.duration_min || 0) * 60), elapsed_time: Math.round((r.duration_min || 0) * 60),
    distance: (r.distance_km || 0) * 1000, average_heartrate: r.avg_hr, max_heartrate: r.max_hr,
    average_speed: r.avg_speed, suffer_score: r.suffer_score,
  }));
  const detailIds = db.idsWithDetails();
  const details = {};
  detailIds.forEach((id) => { details[id] = db.getDetail(id); });
  return { summaries, details };
};
// les écritures passent directement par db.js (voir routes ci-dessous) — saveCache n'est plus nécessaire
const saveCache = () => {};

const loadHealth = () => {
  const out = {};
  db.getAllHealthDays().forEach((d) => { out[d.date] = { hrv: d.hrv, restHr: d.restHr, sleep: d.sleep, sleepDeep: d.sleepDeep, sleepRem: d.sleepRem, inBed: d.inBed }; });
  return out;
};
const saveHealth = () => {};

const lanIP = () => {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) for (const i of ifaces[name]) if (i.family === "IPv4" && !i.internal) return i.address;
  return "localhost";
};

/* ---------- normalisation ---------- */
function normType(t) {
  const s = (t || "").toLowerCase();
  if (/run|cours|jog|trail/.test(s)) return "Course";
  if (/ride|cycl|vélo|velo|bike|virtualride|ebike/.test(s)) return "Vélo";
  if (/swim|nage|natation/.test(s)) return "Natation";
  if (/walk|march|hike|rando/.test(s)) return "Marche";
  if (/weight|strength|muscu|workout|crossfit|hiit/.test(s)) return "Renfo";
  return "Autre";
}
function normalize(a) {
  return {
    id: `strava-${a.id}`, stravaId: a.id, date: a.start_date_local || a.start_date,
    type: normType(a.sport_type || a.type || ""), rawType: a.sport_type || a.type || "",
    distanceKm: (a.distance || 0) / 1000, durationMin: (a.moving_time || a.elapsed_time || 0) / 60,
    avgHr: a.average_heartrate || null, maxHr: a.max_heartrate || null,
    elevationM: a.total_elevation_gain || 0, avgSpeed: a.average_speed || null,
    sufferScore: a.suffer_score ?? null, name: a.name || "", source: "Strava",
  };
}

/* ---------- OAuth Strava ---------- */
app.get("/api/strava/status", (req, res) => {
  const t = loadTokens();
  res.json({ connected: !!t, athlete: t?.athlete || null, configured: !!(CLIENT_ID && CLIENT_SECRET), coachReady: !!ANTHROPIC_KEY });
});
app.get("/api/strava/auth", (req, res) => {
  if (!CLIENT_ID) return res.status(500).send("STRAVA_CLIENT_ID manquant dans .env");
  res.redirect(`https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&approval_prompt=auto&scope=activity:read_all`);
});
app.get("/api/strava/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${FRONTEND}?strava=error`);
  try {
    const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: "authorization_code" }) });
    const data = await r.json();
    if (!data.access_token) throw new Error(JSON.stringify(data));
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, athlete: data.athlete ? { id: data.athlete.id, firstname: data.athlete.firstname, lastname: data.athlete.lastname } : null });
    res.redirect(`${FRONTEND}?strava=connected`);
  } catch (e) { console.error("token:", e.message); res.redirect(`${FRONTEND}?strava=error`); }
});
async function getValidToken() {
  let t = loadTokens();
  if (!t) return null;
  if (t.expires_at && t.expires_at - 60 > Math.floor(Date.now() / 1000)) return t.access_token;
  const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t.refresh_token }) });
  const data = await r.json();
  if (!data.access_token) throw new Error("refresh failed");
  t = { ...t, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
  saveTokens(t);
  return t.access_token;
}

/* ---------- résumés ---------- */
app.get("/api/strava/activities", async (req, res) => {
  try {
    const token = await getValidToken();
    if (!token) return res.status(401).json({ error: "not_connected" });
    const maxPages = Math.min(parseInt(req.query.pages || "5", 10), 10);
    let all = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) break;
      all = all.concat(arr);
      if (arr.length < 100) break;
    }
    const stravaRaw = all.map((a) => ({ id: a.id, date: a.start_date_local || a.start_date, type: a.sport_type || a.type, moving_time: a.moving_time, elapsed_time: a.elapsed_time, distance: a.distance, average_heartrate: a.average_heartrate || null, max_heartrate: a.max_heartrate || null, average_speed: a.average_speed || null, suffer_score: a.suffer_score ?? null }));
    db.upsertActivities(stravaRaw);
    res.json({ sessions: all.map(normalize), count: all.length });
  } catch (e) { console.error("activities:", e.message); res.status(500).json({ error: "fetch_failed" }); }
});

/* ---------- enrichissement ---------- */
const downsample = (arr, n = 300) => { if (!arr || arr.length <= n) return arr || []; const step = arr.length / n, out = []; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]); return out; };
app.get("/api/strava/enrich", async (req, res) => {
  try {
    const token = await getValidToken();
    if (!token) return res.status(401).json({ error: "not_connected" });
    const days = parseInt(req.query.days || "90", 10), cap = Math.min(parseInt(req.query.cap || "40", 10), 50);
    const cache = loadCache();
    const cutoff = Date.now() - days * 86400000;
    const todo = cache.summaries.filter((s) => normType(s.type) === "Course" && new Date(s.date).getTime() >= cutoff && !cache.details[s.id]).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, cap);
    let fetched = 0, rateLimited = false;
    for (const s of todo) {
      const dr = await fetch(`https://www.strava.com/api/v3/activities/${s.id}?include_all_efforts=true`, { headers: { Authorization: `Bearer ${token}` } });
      if (dr.status === 429) { rateLimited = true; break; }
      const detail = await dr.json();
      const sr = await fetch(`https://www.strava.com/api/v3/activities/${s.id}/streams?keys=time,heartrate,velocity_smooth,altitude&key_by_type=true`, { headers: { Authorization: `Bearer ${token}` } });
      if (sr.status === 429) { rateLimited = true; break; }
      const st = await sr.json();
      const bestEfforts = (detail.best_efforts || []).map((b) => ({ name: b.name, elapsed_time: b.elapsed_time, distance: b.distance }));
      const streams = { time: downsample(st.time?.data), hr: downsample(st.heartrate?.data), velocity: downsample(st.velocity_smooth?.data), altitude: downsample(st.altitude?.data) };
      db.upsertDetail(s.id, s.date, bestEfforts, streams);
      cache.details[s.id] = { date: s.date, best_efforts: bestEfforts, streams };
      fetched++;
    }
    const remaining = cache.summaries.filter((s) => normType(s.type) === "Course" && new Date(s.date).getTime() >= cutoff && !cache.details[s.id]).length;
    res.json({ fetched, remaining, rateLimited });
  } catch (e) { console.error("enrich:", e.message); res.status(500).json({ error: "enrich_failed" }); }
});

/* ---------- calculs ---------- */
function performanceChart(summaries, lthr, restHr) {
  const loadByDay = {};
  summaries.forEach((a) => {
    const d = (a.date || "").slice(0, 10); if (!d) return;
    let load = a.suffer_score;
    if (load == null) { const mins = (a.moving_time || a.elapsed_time || 0) / 60; if (a.average_heartrate && lthr > restHr) { const hrr = Math.max(0, Math.min(1.2, (a.average_heartrate - restHr) / (lthr - restHr))); load = mins * hrr * hrr * 1.2; } else load = mins * 0.6; }
    loadByDay[d] = (loadByDay[d] || 0) + load;
  });
  const days = Object.keys(loadByDay).sort(); if (!days.length) return [];
  const start = new Date(days[0] + "T00:00:00"), end = new Date();
  let ctl = 0, atl = 0; const series = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = d.toISOString().slice(0, 10), load = loadByDay[k] || 0;
    ctl += (load - ctl) / 42; atl += (load - atl) / 7;
    series.push({ date: k, load: Math.round(load), ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1) });
  }
  return series;
}
function zoneSeconds(streams, maxHr) {
  const z = [0, 0, 0, 0, 0], hr = streams?.hr, time = streams?.time;
  if (!hr || !time || hr.length < 2) return z;
  for (let i = 1; i < hr.length; i++) { const dt = Math.max(0, (time[i] || 0) - (time[i - 1] || 0)); if (!hr[i]) continue; const pct = hr[i] / maxHr; const zi = pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4; z[zi] += dt; }
  return z;
}
function decoupling(streams) {
  const hr = streams?.hr, vel = streams?.velocity;
  if (!hr || !vel || hr.length < 12) return null;
  const mid = Math.floor(hr.length / 2);
  const ef = (a, b) => { let sh = 0, sv = 0, n = 0; for (let i = a; i < b; i++) if (hr[i] > 0) { sh += hr[i]; sv += vel[i]; n++; } return n ? (sv / n) / (sh / n) : null; };
  const e1 = ef(0, mid), e2 = ef(mid, hr.length);
  if (!e1 || !e2) return null;
  return +(((e1 - e2) / e1) * 100).toFixed(1);
}
// classification du type de séance
function classifyRun(s, detail, lthr) {
  const dist = (s.distance || 0) / 1000, dur = (s.moving_time || 0) / 60;
  if (dist < 0.5 || dur < 3) return "Autre";
  let cv = null;
  const v = detail?.streams?.velocity?.filter((x) => x > 0.5);
  if (v && v.length > 10) { const mean = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length); cv = sd / mean; }
  if (cv != null && cv > 0.22 && dist < 16) return "Fractionné";
  if (dist >= 16) return "Sortie longue";
  if (s.average_heartrate && lthr && s.average_heartrate >= lthr * 0.96 && dist <= 13) return "Seuil/Tempo";
  if (s.average_heartrate && lthr && s.average_heartrate < lthr * 0.82) return "Récup/Facile";
  return "Endurance";
}
function recoveryScore(health) {
  const days = Object.keys(health).sort(); if (!days.length) return null;
  const today = days[days.length - 1], latest = health[today];
  const recent = days.slice(-30).map((d) => health[d]);
  const avg = (k) => { const v = recent.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const hrvBase = avg("hrv"), restBase = avg("restHr");
  let score = 50; const factors = [];
  if (latest.hrv != null && hrvBase) { const r = latest.hrv / hrvBase; score += (r - 1) * 80; factors.push(`VFC ${latest.hrv.toFixed(0)}ms (${r >= 1 ? "+" : ""}${((r - 1) * 100).toFixed(0)}% vs base)`); }
  if (latest.restHr != null && restBase) { const r = latest.restHr / restBase; score -= (r - 1) * 120; factors.push(`FC repos ${latest.restHr.toFixed(0)} bpm`); }
  if (latest.sleep != null) { if (latest.sleep >= 7.5) score += 8; else if (latest.sleep < 6) score -= 12; factors.push(`Sommeil ${latest.sleep.toFixed(1)}h`); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, factors, date: today, latest };
}
app.get("/api/strava/advanced", (req, res) => {
  const maxHr = parseFloat(req.query.maxHr) || 190, lthr = parseFloat(req.query.lthr) || 170, restHr = parseFloat(req.query.restHr) || 50;
  const cache = loadCache();
  const pmc = performanceChart(cache.summaries, lthr, restHr);
  const sixWk = Date.now() - 42 * 86400000;
  const zAgg = [0, 0, 0, 0, 0], decoup = [];
  Object.values(cache.details).forEach((d) => {
    const t = new Date(d.date).getTime();
    if (t >= sixWk) { const z = zoneSeconds(d.streams, maxHr); for (let i = 0; i < 5; i++) zAgg[i] += z[i]; }
    const totMin = (d.streams?.time?.at?.(-1) || 0) / 60;
    if (totMin >= 45) { const dc = decoupling(d.streams); if (dc != null) decoup.push({ date: d.date.slice(0, 10), pct: dc }); }
  });
  const zTotal = zAgg.reduce((a, b) => a + b, 0) || 1;
  const zones = zAgg.map((s) => +((s / zTotal) * 100).toFixed(1));
  const easy = zones[0] + zones[1], moderate = zones[2], hard = zones[3] + zones[4];
  const prMap = {};
  Object.values(cache.details).forEach((d) => (d.best_efforts || []).forEach((b) => { if (!prMap[b.name] || b.elapsed_time < prMap[b.name].time) prMap[b.name] = { time: b.elapsed_time, distance: b.distance, date: d.date.slice(0, 10) }; }));
  const order = ["400m", "1/2 mile", "1k", "1 mile", "2 mile", "5k", "10k", "15k", "10 mile", "20k", "Half-Marathon", "30k", "Marathon"];
  const prs = Object.entries(prMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => (order.indexOf(a.name) - order.indexOf(b.name)) || (a.distance - b.distance));
  const efficiency = cache.summaries.filter((s) => normType(s.type) === "Course" && s.average_heartrate && s.average_speed).map((s) => ({ date: s.date.slice(0, 10), ef: +((s.average_speed * 60) / s.average_heartrate).toFixed(2) })).sort((a, b) => new Date(a.date) - new Date(b.date));

  // type de séance (15 dernières courses)
  const runs = cache.summaries.filter((s) => normType(s.type) === "Course").sort((a, b) => new Date(b.date) - new Date(a.date));
  const recentRuns = runs.slice(0, 15).map((s) => { const dist = (s.distance || 0) / 1000, dur = (s.moving_time || 0) / 60; return { date: s.date.slice(0, 10), distanceKm: +dist.toFixed(1), pace: dist > 0 ? +(dur / dist).toFixed(2) : null, avgHr: s.average_heartrate, sessionType: classifyRun(s, cache.details[s.id], lthr) }; });
  const typeCount = {};
  runs.slice(0, 40).forEach((s) => { const t = classifyRun(s, cache.details[s.id], lthr); typeCount[t] = (typeCount[t] || 0) + 1; });

  // charge par sport
  const loadBySport = {};
  cache.summaries.forEach((s) => { const t = normType(s.type); const load = s.suffer_score ?? ((s.moving_time || 0) / 60 * 0.6); loadBySport[t] = (loadBySport[t] || 0) + load; });

  // récup (Apple Santé)
  const recovery = recoveryScore(loadHealth());

  res.json({ pmc, zones, polarization: { easy: +easy.toFixed(1), moderate: +moderate.toFixed(1), hard: +hard.toFixed(1) }, decoupling: decoup.sort((a, b) => new Date(a.date) - new Date(b.date)), prs, efficiency, recentRuns, typeCount, loadBySport, recovery, zoneBounds: { maxHr, lthr, restHr }, detailedCount: Object.keys(cache.details).length });
});

app.get("/api/strava/monthly", (req, res) => {
  try { res.json({ months: db.monthlyTotals() }); }
  catch (e) { res.status(500).json({ error: "query_failed" }); }
});

app.post("/api/strava/disconnect", (req, res) => { try { fs.unlinkSync(TOKENS_FILE); } catch {} db.clearStravaData(); res.json({ ok: true }); });

/* ---------- Apple Santé (Health Auto Export) ---------- */
app.get("/api/health/info", (req, res) => {
  const ip = lanIP();
  res.json({ ip, port: PORT, endpoint: `http://${ip}:${PORT}/api/health/ingest`, hasData: Object.keys(loadHealth()).length > 0 });
});
app.post("/api/health/ingest", (req, res) => {
  try {
    const metrics = req.body?.data?.metrics || [];
    let n = 0;
    metrics.forEach((m) => {
      (m.data || []).forEach((d) => {
        const day = (d.date || "").slice(0, 10); if (!day) return;
        if (m.name === "heart_rate_variability") { db.upsertHealthDay(day, { hrv: d.qty ?? d.Avg ?? null }); n++; }
        else if (m.name === "resting_heart_rate") { db.upsertHealthDay(day, { restHr: d.qty ?? d.Avg ?? null }); n++; }
        else if (m.name === "sleep_analysis") {
          const asleep = (d.totalSleep ?? d.asleep ?? ((d.deep || 0) + (d.core || 0) + (d.rem || 0))) || null;
          db.upsertHealthDay(day, { sleep: asleep, sleepDeep: d.deep ?? null, sleepRem: d.rem ?? null, inBed: d.inBed ?? null });
          n++;
        }
      });
    });
    res.json({ ok: true, ingested: n });
  } catch (e) { console.error("health ingest:", e.message); res.status(500).json({ error: "ingest_failed" }); }
});
app.get("/api/health/data", (req, res) => {
  const h = loadHealth();
  const days = Object.keys(h).sort();
  const series = days.map((d) => ({ date: d, ...h[d] }));
  res.json({ series, recovery: recoveryScore(h) });
});

/* ---------- Workouts Apple détaillés (intervalles réels depuis Health Auto Export) ---------- */
const APPLE_TYPE_MAP = { running: "Course", walking: "Marche", cycling: "Vélo", swimming: "Natation", functionalStrengthTraining: "Renfo", traditionalStrengthTraining: "Renfo" };
function mapAppleType(name) {
  const key = (name || "").toLowerCase();
  for (const [k, v] of Object.entries(APPLE_TYPE_MAP)) if (key.includes(k.toLowerCase())) return v;
  return normType(name);
}

// Détection d'intervalles à partir d'une série temporelle FC ou allure (minute par minute ou plus fin).
// Principe : on lisse légèrement, puis on détecte les phases où l'intensité dépasse un seuil haut
// (effort) vs un seuil bas (récup), avec une durée minimale pour éviter le bruit.
function detectIntervals(points) {
  // points attendus: [{ t: secondes, hr: bpm|null, pace: min/km|null, speed: km/h|null }]
  if (!points || points.length < 4) return [];
  const hasHr = points.some((p) => p.hr);
  const hasSpeed = points.some((p) => p.speed || p.pace);

  // valeur d'intensité normalisée par point (0 = très facile, 1 = effort max observé)
  let vals;
  if (hasSpeed) {
    const speeds = points.map((p) => p.speed ?? (p.pace ? 60 / p.pace : 0));
    const max = Math.max(...speeds), min = Math.min(...speeds.filter((s) => s > 0));
    vals = speeds.map((s) => (max > min ? (s - min) / (max - min) : 0));
  } else if (hasHr) {
    const hrs = points.map((p) => p.hr || 0);
    const max = Math.max(...hrs), min = Math.min(...hrs.filter((h) => h > 0));
    vals = hrs.map((h) => (max > min ? (h - min) / (max - min) : 0));
  } else return [];

  // lissage simple (moyenne mobile sur 3 points) pour réduire le bruit
  const smooth = vals.map((v, i) => {
    const a = vals[Math.max(0, i - 1)], b = v, c = vals[Math.min(vals.length - 1, i + 1)];
    return (a + b + c) / 3;
  });

  const HIGH = 0.62, LOW = 0.38;
  const intervals = [];
  let state = smooth[0] > HIGH ? "effort" : "recup";
  let startIdx = 0;
  for (let i = 1; i < smooth.length; i++) {
    const v = smooth[i];
    const next = v > HIGH ? "effort" : v < LOW ? "recup" : state; // zone tampon = on garde l'état courant
    if (next !== state) {
      intervals.push({ type: state, startT: points[startIdx].t, endT: points[i].t });
      state = next; startIdx = i;
    }
  }
  intervals.push({ type: state, startT: points[startIdx].t, endT: points[points.length - 1].t });

  // fusionne les segments < 20s (bruit) avec le segment suivant, et calcule les stats par segment
  const merged = [];
  intervals.forEach((seg) => {
    if (merged.length && seg.endT - seg.startT < 20) { merged[merged.length - 1].endT = seg.endT; }
    else merged.push({ ...seg });
  });

  return merged
    .filter((seg) => seg.endT - seg.startT >= 15) // ignore les segments résiduels trop courts
    .map((seg) => {
      const segPoints = points.filter((p) => p.t >= seg.startT && p.t <= seg.endT);
      const hrVals = segPoints.map((p) => p.hr).filter(Boolean);
      const paceVals = segPoints.map((p) => p.pace).filter(Boolean);
      return {
        type: seg.type === "effort" ? "Effort" : "Récup",
        durationSec: Math.round(seg.endT - seg.startT),
        avgHr: hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null,
        avgPace: paceVals.length ? +(paceVals.reduce((a, b) => a + b, 0) / paceVals.length).toFixed(2) : null,
      };
    });
}

app.post("/api/apple/workouts", (req, res) => {
  try {
    const workouts = req.body?.data?.workouts || [];
    let n = 0;
    workouts.forEach((w) => {
      const id = `apple-${w.id || w.start || Date.now()}-${n}`;
      const date = w.start || w.startDate;
      if (!date) return;
      const type = mapAppleType(w.name || w.workoutActivityType);
      const distanceKm = w.distance?.qty ?? (typeof w.distance === "number" ? w.distance : 0);
      const durationMin = w.duration ? w.duration / 60 : null;

      // construit la série temporelle à partir des points FC / vitesse fournis par Health Auto Export
      const hrSeries = w.heartRateData || w.heart_rate_data || [];
      const points = hrSeries.map((p, i) => ({
        t: p.date ? (new Date(p.date).getTime() - new Date(date).getTime()) / 1000 : i * 60,
        hr: p.qty ?? p.Avg ?? null,
      })).filter((p) => p.t >= 0);

      const avgHr = points.length ? points.reduce((a, p) => a + (p.hr || 0), 0) / points.filter(p => p.hr).length : null;
      const intervals = detectIntervals(points);

      db.upsertAppleWorkout(id, date, type, distanceKm, durationMin, avgHr, points, intervals);
      n++;
    });
    res.json({ ok: true, ingested: n });
  } catch (e) { console.error("apple workouts ingest:", e.message); res.status(500).json({ error: "ingest_failed" }); }
});

app.get("/api/apple/workouts", (req, res) => {
  try { res.json({ workouts: db.getAppleWorkouts(60) }); }
  catch (e) { res.status(500).json({ error: "query_failed" }); }
});

// associe une activité Strava à son workout Apple détaillé le plus proche en date (même jour, ±90 min)
app.get("/api/apple/match", (req, res) => {
  try {
    const { date, type } = req.query;
    if (!date) return res.status(400).json({ error: "missing_date" });
    const w = db.getAppleWorkoutNear(date, type || "Course", 90);
    res.json({ workout: w });
  } catch (e) { res.status(500).json({ error: "match_failed" }); }
});

/* ---------- Coach IA (API Claude) ---------- */
app.post("/api/coach", async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(400).json({ error: "no_key" });
  const { summary, question } = req.body || {};
  const sys = "Tu es un entraîneur de course à pied expérimenté, pragmatique et bienveillant. Tu réponds en français, de façon concise et actionnable. Tu te bases UNIQUEMENT sur les données fournies. Tu ne donnes jamais de conseil médical ; en cas de signal inquiétant (fatigue élevée, charge excessive), tu recommandes prudence et repos. Structure : un court diagnostic, puis des recommandations concrètes.";
  const task = question?.trim() ? question : "Analyse ma forme actuelle et propose-moi une semaine d'entraînement (7 jours) adaptée, en tenant compte de ma charge, ma fraîcheur et ma récupération.";
  const prompt = `Données de l'athlète (JSON) :\n${JSON.stringify(summary, null, 2)}\n\nDemande : ${task}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, system: sys, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: "api_error", detail: data.error.message });
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    res.json({ text: text || "Pas de réponse." });
  } catch (e) { console.error("coach:", e.message); res.status(500).json({ error: "coach_failed" }); }
});

app.listen(PORT, () => {
  console.log(`\n  Backend prêt sur http://localhost:${PORT}  (réseau local : http://${lanIP()}:${PORT})`);
  if (!CLIENT_ID || !CLIENT_SECRET) console.log("  ⚠  Strava : remplis STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET dans .env");
  if (!ANTHROPIC_KEY) console.log("  ⓘ  Coach IA désactivé : ajoute ANTHROPIC_API_KEY dans .env pour l'activer");
  console.log("");
});
