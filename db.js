import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "training.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

/* ---------- schéma ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS activities (
  strava_id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT,
  raw_type TEXT,
  distance_km REAL,
  duration_min REAL,
  avg_hr REAL,
  max_hr REAL,
  elevation_m REAL,
  avg_speed REAL,
  suffer_score REAL,
  name TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

CREATE TABLE IF NOT EXISTS activity_details (
  strava_id INTEGER PRIMARY KEY,
  date TEXT,
  best_efforts_json TEXT,
  streams_json TEXT,
  FOREIGN KEY (strava_id) REFERENCES activities(strava_id)
);

CREATE TABLE IF NOT EXISTS health_days (
  date TEXT PRIMARY KEY,
  hrv REAL,
  rest_hr REAL,
  sleep_hours REAL,
  sleep_deep REAL,
  sleep_rem REAL,
  in_bed REAL
);

CREATE TABLE IF NOT EXISTS manual_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT,
  distance_km REAL,
  duration_min REAL,
  avg_hr REAL,
  max_hr REAL,
  elevation_m REAL,
  name TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

/* ---------- migration depuis les anciens fichiers JSON (une seule fois) ---------- */
function migrateLegacyJSON() {
  const already = db.prepare("SELECT value FROM app_settings WHERE key = 'migrated_v1'").get();
  if (already) return { migrated: false, reason: "already_done" };

  let counts = { activities: 0, details: 0, health: 0 };
  const cacheFile = path.join(__dirname, "strava-cache.json");
  if (fs.existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const insertAct = db.prepare(`INSERT OR REPLACE INTO activities
        (strava_id, date, type, raw_type, distance_km, duration_min, avg_hr, max_hr, elevation_m, avg_speed, suffer_score, name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      (cache.summaries || []).forEach((a) => {
        insertAct.run(a.id, a.date, a.type || null, a.type || null, (a.distance || 0) / 1000, (a.moving_time || a.elapsed_time || 0) / 60, a.average_heartrate ?? null, a.max_heartrate ?? null, a.total_elevation_gain ?? 0, a.average_speed ?? null, a.suffer_score ?? null, a.name || null);
        counts.activities++;
      });
      const insertDet = db.prepare(`INSERT OR REPLACE INTO activity_details (strava_id, date, best_efforts_json, streams_json) VALUES (?, ?, ?, ?)`);
      Object.entries(cache.details || {}).forEach(([id, d]) => {
        insertDet.run(parseInt(id, 10), d.date, JSON.stringify(d.best_efforts || []), JSON.stringify(d.streams || {}));
        counts.details++;
      });
    } catch (e) { console.error("Migration strava-cache.json:", e.message); }
  }

  const healthFile = path.join(__dirname, "health-cache.json");
  if (fs.existsSync(healthFile)) {
    try {
      const health = JSON.parse(fs.readFileSync(healthFile, "utf8"));
      const insertH = db.prepare(`INSERT OR REPLACE INTO health_days (date, hrv, rest_hr, sleep_hours, sleep_deep, sleep_rem, in_bed) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      Object.entries(health).forEach(([day, d]) => {
        insertH.run(day, d.hrv ?? null, d.restHr ?? null, d.sleep ?? null, d.sleepDeep ?? null, d.sleepRem ?? null, d.inBed ?? null);
        counts.health++;
      });
    } catch (e) { console.error("Migration health-cache.json:", e.message); }
  }

  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('migrated_v1', '1')").run();
  return { migrated: true, counts };
}

/* ---------- API d'accès (utilisée par server.js) ---------- */
function upsertActivities(rawActivities) {
  const stmt = db.prepare(`INSERT OR REPLACE INTO activities
    (strava_id, date, type, raw_type, distance_km, duration_min, avg_hr, max_hr, elevation_m, avg_speed, suffer_score, name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const a of rawActivities) {
    stmt.run(a.id, a.date, a.type || null, a.type || null, (a.distance || 0) / 1000, (a.moving_time || a.elapsed_time || 0) / 60, a.average_heartrate ?? null, a.max_heartrate ?? null, a.total_elevation_gain ?? 0, a.average_speed ?? null, a.suffer_score ?? null, a.name || null);
    n++;
  }
  return n;
}

function upsertDetail(stravaId, date, bestEfforts, streams) {
  db.prepare(`INSERT OR REPLACE INTO activity_details (strava_id, date, best_efforts_json, streams_json) VALUES (?, ?, ?, ?)`)
    .run(stravaId, date, JSON.stringify(bestEfforts || []), JSON.stringify(streams || {}));
}

function getAllActivitySummaries() {
  return db.prepare("SELECT * FROM activities ORDER BY date ASC").all();
}

function getActivitiesInRange(fromDate, toDate, type = null) {
  if (type) return db.prepare("SELECT * FROM activities WHERE date >= ? AND date <= ? AND type = ? ORDER BY date ASC").all(fromDate, toDate, type);
  return db.prepare("SELECT * FROM activities WHERE date >= ? AND date <= ? ORDER BY date ASC").all(fromDate, toDate);
}

function getDetail(stravaId) {
  const row = db.prepare("SELECT * FROM activity_details WHERE strava_id = ?").get(stravaId);
  if (!row) return null;
  return { date: row.date, best_efforts: JSON.parse(row.best_efforts_json || "[]"), streams: JSON.parse(row.streams_json || "{}") };
}

function getDetailsSince(cutoffISODate) {
  const rows = db.prepare("SELECT * FROM activity_details WHERE date >= ?").all(cutoffISODate);
  const out = {};
  rows.forEach((r) => { out[r.strava_id] = { date: r.date, best_efforts: JSON.parse(r.best_efforts_json || "[]"), streams: JSON.parse(r.streams_json || "{}") }; });
  return out;
}

function idsWithDetails() {
  return new Set(db.prepare("SELECT strava_id FROM activity_details").all().map((r) => r.strava_id));
}

function upsertHealthDay(date, fields) {
  const existing = db.prepare("SELECT * FROM health_days WHERE date = ?").get(date) || {};
  const merged = {
    hrv: fields.hrv ?? existing.hrv ?? null,
    rest_hr: fields.restHr ?? existing.rest_hr ?? null,
    sleep_hours: fields.sleep ?? existing.sleep_hours ?? null,
    sleep_deep: fields.sleepDeep ?? existing.sleep_deep ?? null,
    sleep_rem: fields.sleepRem ?? existing.sleep_rem ?? null,
    in_bed: fields.inBed ?? existing.in_bed ?? null,
  };
  db.prepare(`INSERT OR REPLACE INTO health_days (date, hrv, rest_hr, sleep_hours, sleep_deep, sleep_rem, in_bed) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(date, merged.hrv, merged.rest_hr, merged.sleep_hours, merged.sleep_deep, merged.sleep_rem, merged.in_bed);
}

function getAllHealthDays() {
  return db.prepare("SELECT * FROM health_days ORDER BY date ASC").all()
    .map((r) => ({ date: r.date, hrv: r.hrv, restHr: r.rest_hr, sleep: r.sleep_hours, sleepDeep: r.sleep_deep, sleepRem: r.sleep_rem, inBed: r.in_bed }));
}

function getSetting(key) { const r = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key); return r ? r.value : null; }
function setSetting(key, value) { db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value); }

function clearStravaData() {
  db.exec("DELETE FROM activities; DELETE FROM activity_details;");
}
function clearHealthData() {
  db.exec("DELETE FROM health_days;");
}

// requêtes analytiques pratiques (le vrai gain vs JSON)
function monthlyTotals() {
  return db.prepare(`
    SELECT substr(date,1,7) AS month, type,
           ROUND(SUM(distance_km),1) AS km,
           ROUND(SUM(duration_min)) AS minutes,
           COUNT(*) AS sessions
    FROM activities GROUP BY month, type ORDER BY month ASC
  `).all();
}
function bestEffortByDistance(minKm, maxKm) {
  return db.prepare(`
    SELECT * FROM activities WHERE type = 'Run' AND distance_km BETWEEN ? AND ?
    ORDER BY (duration_min / distance_km) ASC LIMIT 5
  `).all(minKm, maxKm);
}

export default {
  migrateLegacyJSON,
  upsertActivities, upsertDetail,
  getAllActivitySummaries, getActivitiesInRange, getDetail, getDetailsSince, idsWithDetails,
  upsertHealthDay, getAllHealthDays,
  getSetting, setSetting,
  clearStravaData, clearHealthData,
  monthlyTotals, bestEffortByDistance,
};
