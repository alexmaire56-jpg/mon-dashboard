import React, { useState } from "react";
import { C, Card } from "./ui.jsx";

const DEFAULT_PROFILE = { age: 23, weight: 70, weeklyFrequency: 5, lat: 48.85, lon: 2.35, city: "Paris" };

export function loadProfile() {
  try { return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem("user-profile") || "{}") }; }
  catch { return DEFAULT_PROFILE; }
}

export function saveProfile(profile) {
  try { localStorage.setItem("user-profile", JSON.stringify(profile)); } catch {}
}

const UserProfile = ({ onClose }) => {
  const [profile, setProfile] = useState(loadProfile);
  const [saved, setSaved] = useState(false);

  const update = (key, val) => setProfile((p) => ({ ...p, [key]: val }));

  const handleSave = () => {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose?.(); }, 800);
  };

  const fields = [
    { key: "age", label: "Âge", type: "number", min: 15, max: 80, unit: "ans" },
    { key: "weight", label: "Poids", type: "number", min: 40, max: 150, unit: "kg" },
    { key: "weeklyFrequency", label: "Séances/semaine habituelles", type: "number", min: 1, max: 14, unit: "séances" },
  ];

  return (
    <Card style={{ marginBottom: 20, border: `1px solid ${C.accentSoft}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Mon profil</div>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
            Sert à calibrer les temps de récupération. Rempli une fois, stocké localement.
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.dim, cursor: "pointer", fontSize: 16 }}>✕</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {fields.map(({ key, label, type, min, max, unit }) => (
          <div key={key}>
            <div style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type={type} min={min} max={max}
                value={profile[key]}
                onChange={(e) => update(key, parseFloat(e.target.value) || 0)}
                style={{ width: 70, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, padding: "8px 10px", fontSize: 14 }}
              />
              <span style={{ color: C.dim, fontSize: 12 }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, padding: "10px 12px", background: C.panel2, borderRadius: 8, fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
        📍 Localisation météo : <strong style={{ color: C.mut }}>{profile.city}</strong> — utilisée pour récupérer la température au moment de chaque séance (via Open-Meteo, gratuit).
      </div>

      <button onClick={handleSave}
        style={{ marginTop: 14, background: saved ? C.green : C.accent, color: "#1a0d06", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14, transition: "background 0.3s" }}>
        {saved ? "✓ Sauvegardé !" : "Sauvegarder"}
      </button>
    </Card>
  );
};

export default UserProfile;

