/* ---------- helpers temporels ---------- */
export const dayKey = (d) => d.toISOString().slice(0, 10);
export const startOfWeek = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};

/* ---------- helpers d'affichage ---------- */
export const fmtPace = (minPerKm) => {
  if (!minPerKm || !isFinite(minPerKm)) return "—";
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, "0")}/km`;
};
export const fmtDur = (min) => {
  if (!min && min !== 0) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
};
export const fmtTime = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/* ---------- parsing ---------- */
export function normType(t) {
  const s = (t || "").toLowerCase();
  if (/run|cours|jog|trail/.test(s)) return "Course";
  if (/ride|cycl|vélo|velo|bike/.test(s)) return "Vélo";
  if (/swim|nage|natation/.test(s)) return "Natation";
  if (/walk|march/.test(s)) return "Marche";
  if (/strength|muscu|functional|gym|hiit|traditional/.test(s)) return "Renfo";
  return "Autre";
}

/* ---------- analyse principale ---------- */
export function analyze(sessions) {
  const runs = sessions
    .filter((s) => s.type === "Course" && s.distanceKm > 0.5 && s.durationMin > 1)
    .map((s) => ({ ...s, pace: s.durationMin / s.distanceKm }))
    .sort((a, b) => a.date - b.date);

  const loadOf = (s) => {
    const intensity = s.avgHr ? Math.max(0.5, (s.avgHr - 60) / 100) : 1;
    return s.durationMin * intensity;
  };

  const now = sessions.length ? new Date(Math.max(...sessions.map((s) => +s.date))) : new Date();
  const dayLoad = {};
  sessions.forEach((s) => { dayLoad[dayKey(s.date)] = (dayLoad[dayKey(s.date)] || 0) + loadOf(s); });

  const loadInWindow = (days) => {
    let sum = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      sum += dayLoad[dayKey(d)] || 0;
    }
    return sum;
  };

  const weekMap = {};
  runs.forEach((s) => {
    const wk = dayKey(startOfWeek(s.date));
    if (!weekMap[wk]) weekMap[wk] = { week: wk, km: 0, min: 0, count: 0, hrSum: 0, hrN: 0 };
    weekMap[wk].km += s.distanceKm;
    weekMap[wk].min += s.durationMin;
    weekMap[wk].count += 1;
    if (s.avgHr) { weekMap[wk].hrSum += s.avgHr; weekMap[wk].hrN++; }
  });
  const weeks = Object.values(weekMap)
    .sort((a, b) => new Date(a.week) - new Date(b.week))
    .map((w) => ({ ...w, km: Math.round(w.km * 10) / 10, avgPace: w.km > 0 ? w.min / w.km : null, avgHr: w.hrN ? Math.round(w.hrSum / w.hrN) : null }));

  function getVO2(distanceKm, durationMin) {
    const t = durationMin, d = distanceKm * 1000, v = d / t;
    const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    return (-4.60 + 0.182258 * v + 0.000104 * v * v) / pctMax;
  }

  let maxVo2 = 0, ref = null;
  runs.filter(s => s.distanceKm >= 2.5).forEach((s) => {
    const v = getVO2(s.distanceKm, s.durationMin);
    if (v > maxVo2) { maxVo2 = v; ref = s; }
  });

  const riegel = (refDistKm, refSec, targetKm) => refSec * Math.pow(targetKm / refDistKm, 1.06);
  const targets = [{ d: "5 km", km: 5 }, { d: "10 km", km: 10 }, { d: "Semi (21.1)", km: 21.0975 }, { d: "Marathon (42.2)", km: 42.195 }];
  const predictions = ref
    ? targets.map((p) => { const sec = riegel(ref.distanceKm, ref.durationMin * 60, p.km); return { ...p, sec, pace: sec / 60 / p.km, contributors: [ref] }; })
    : [];

  const trainingDays = new Set(sessions.map((s) => dayKey(s.date)));
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    if (trainingDays.has(dayKey(d))) streak++; else break;
  }

  const last = sessions.length ? sessions.reduce((a, b) => (a.date > b.date ? a : b)) : null;
  const daysSinceLast = last ? Math.floor((+now - +last.date) / 86400000) : null;

  return {
    runs, weeks,
    acute: loadInWindow(7), chronicWeekly: loadInWindow(28) / 4,
    acwr: loadInWindow(28) > 0 ? loadInWindow(7) / (loadInWindow(28) / 4) : 0,
    ref, predictions, vo2: ref ? Math.round(maxVo2 * 10) / 10 : null,
    streak, daysSinceRest: streak, last, daysSinceLast, now,
    totalRuns: runs.length,
    totalKm: Math.round(runs.reduce((s, r) => s + r.distanceKm, 0)),
  };
}

/* ---------- recommandations ---------- */
export function recommend(a) {
  const recs = [], acwr = a.acwr;
  if (acwr > 1.5) recs.push({ level: "high", icon: "⚠", title: "Charge en forte hausse", body: `Ratio à ${acwr.toFixed(2)}. Risque élevé — prévois du repos.` });
  else if (acwr > 1.3) recs.push({ level: "mid", icon: "▲", title: "Charge à surveiller", body: `ACWR à ${acwr.toFixed(2)}. Privilégie le facile.` });
  else if (acwr >= 0.8) recs.push({ level: "ok", icon: "✓", title: "Charge optimale", body: "Progression bien dosée." });
  else if (acwr > 0) recs.push({ level: "low", icon: "↓", title: "Charge basse", body: "Tu es en sous-charge, ré-augmente progressivement." });
  if (a.streak >= 7) recs.push({ level: "high", icon: "○", title: "Repos recommandé", body: `${a.streak} jours d'affilée — prends un off.` });
  return recs;
}

/* ---------- progression ---------- */
export function distanceBucket(km) {
  if (km >= 4.5 && km <= 5.5) return "5 km";
  if (km >= 9 && km <= 11) return "10 km";
  if (km >= 19 && km <= 23) return "Semi";
  if (km >= 40 && km <= 44) return "Marathon";
  return null;
}

export function efficiencyOf(run) {
  if (!run.avgHr || !run.distanceKm || !run.durationMin) return null;
  return (run.distanceKm / (run.durationMin / 60)) / run.avgHr;
}

export function progressionByBucket(runs) {
  const buckets = {};
  runs.forEach((r) => {
    const b = distanceBucket(r.distanceKm);
    if (!b) return;
    if (!buckets[b]) buckets[b] = [];
    buckets[b].push({ date: r.date, pace: r.pace, avgHr: r.avgHr || null, ef: efficiencyOf(r) });
  });
  Object.keys(buckets).forEach((b) => buckets[b].sort((a, b2) => a.date - b2.date));
  return buckets;
}

export function progressionIndex(runs, weeks = 6) {
  const withEf = runs.filter((r) => efficiencyOf(r) != null).map((r) => ({ date: r.date, ef: efficiencyOf(r) }));
  if (withEf.length < 4) return null;
  const now = withEf[withEf.length - 1].date;
  const cutRecent = new Date(now); cutRecent.setDate(cutRecent.getDate() - weeks * 7);
  const cutPrev = new Date(cutRecent); cutPrev.setDate(cutPrev.getDate() - weeks * 7);
  const recent = withEf.filter((r) => r.date > cutRecent);
  const prev = withEf.filter((r) => r.date > cutPrev && r.date <= cutRecent);
  if (recent.length < 2 || prev.length < 2) return null;
  const avg = (arr) => arr.reduce((s, r) => s + r.ef, 0) / arr.length;
  const recentAvg = avg(recent), prevAvg = avg(prev);
  const pct = ((recentAvg - prevAvg) / prevAvg) * 100;
  return { pct: +pct.toFixed(1), recentAvg, prevAvg, recentCount: recent.length, prevCount: prev.length, weeks };
}

export function interpretBucketProgress(points) {
  if (points.length < 2) return null;
  const first = points[0], last = points[points.length - 1];
  const best = points.reduce((a, b) => (b.pace < a.pace ? b : a));
  const deltaSec = (first.pace - last.pace) * 60;
  const pctChange = ((first.pace - last.pace) / first.pace) * 100;
  const spanDays = Math.round((last.date - first.date) / 86400000);
  let verdict;
  if (Math.abs(pctChange) < 1.5) verdict = "stable";
  else if (pctChange > 0) verdict = "progression";
  else verdict = "regression";
  const fmtDelta = (sec) => `${Math.round(Math.abs(sec))}s/km`;
  let text;
  if (verdict === "progression") {
    text = `Tu as gagné ${fmtDelta(deltaSec)} entre ta première et ta dernière sortie sur cette distance (${spanDays} jours), soit ${pctChange.toFixed(1)}% plus rapide. ${points.length >= 4 ? "Tendance cohérente sur plusieurs sorties." : "Basé sur peu de sorties, à confirmer."}`;
  } else if (verdict === "regression") {
    text = `Tu es ${fmtDelta(-deltaSec)} plus lent qu'à ta première sortie sur cette distance (${spanDays} jours). Ça peut venir d'une charge lourde, de la météo ou d'une fatigue accumulée — pas forcément une perte de forme.`;
  } else {
    text = `Allure stable sur ${spanDays} jours — normal en phase de maintien.`;
  }
  return { verdict, deltaSec, pctChange, spanDays, best, first, last, text };
}

export function contextAt(session, allRuns) {
  const sessionDate = session.date instanceof Date ? session.date : new Date(session.date);
  const before = allRuns.filter((r) => r.date <= sessionDate);
  if (before.length < 2) return null;
  const loadOf = (s) => { const intensity = s.avgHr ? Math.max(0.5, (s.avgHr - 60) / 100) : 1; return s.durationMin * intensity; };
  const inWindow = (days) => before.filter((r) => (sessionDate - r.date) / 86400000 <= days).reduce((s, r) => s + loadOf(r), 0);
  const acute = inWindow(7), chronicWeekly = inWindow(28) / 4;
  const acwr = chronicWeekly > 0 ? acute / chronicWeekly : null;
  const daysSincePrev = Math.round((sessionDate - before[before.length - 2].date) / 86400000);
  return { acwr, daysSincePrev };
}

/* ---------- impact cross-sport sur la préparation ---------- */

// Intensité relative d'une activité (0 = repos, 1 = charge max)
export function activityIntensity(session) {
  const type = session.type || "";
  const dur = session.durationMin || 0;
  const hr = session.avgHr || null;

  // si FC dispo : intensité basée sur la FC
  if (hr) return Math.max(0.2, Math.min(1, (hr - 60) / 120));

  // sinon : proxy par type + durée
  const baseIntensity = {
    "Course": 0.75,
    "Vélo": 0.55,
    "Natation": 0.65,
    "Marche": 0.25,
    "Renfo": 0.50,
    "Autre": 0.40,
  }[type] || 0.40;

  // durée longue = charge plus élevée
  const durationFactor = Math.min(1.3, 0.8 + (dur / 120) * 0.5);
  return Math.min(1, baseIntensity * durationFactor);
}

// Contribution d'une activité à la charge ACWR (en unités de charge)
export function activityLoad(session) {
  return (session.durationMin || 0) * activityIntensity(session);
}

// Tag d'impact sur la préparation running
export function impactTag(session, acwrBefore) {
  const type = session.type || "";
  const intensity = activityIntensity(session);
  const dur = session.durationMin || 0;

  // course = impact direct
  if (type === "Course") {
    if (intensity > 0.75) return { tag: "⚡ Charge course", color: "#e8612c", detail: "Séance intensive — compte dans ta charge running." };
    if (intensity > 0.50) return { tag: "🏃 Endurance", color: "#5b9bd5", detail: "Sortie d'endurance — bonne contribution aérobie." };
    return { tag: "🟢 Récup active", color: "#5dca8a", detail: "Allure légère — favorise la récupération sans surcharger." };
  }

  // vélo : souvent récup active pour un coureur
  if (type === "Vélo") {
    if (intensity > 0.70 || dur > 120) return { tag: "⚡ Charge vélo", color: "#e0a93b", detail: "Vélo intense ou long — charge complémentaire non négligeable." };
    return { tag: "🚴 Récup croisée", color: "#5dca8a", detail: "Vélo modéré — excellent pour récupérer sans impact articulaire." };
  }

  // natation : quasi toujours récup/cross-training
  if (type === "Natation") return { tag: "🏊 Cross-training", color: "#5b9bd5", detail: "Natation — travail cardio sans impact, idéal en complément." };

  // renfo : neutre sur charge cardio, utile pour prévention
  if (type === "Renfo") return { tag: "💪 Renfo", color: "#a39b8c", detail: "Musculation — charge cardio faible, bénéfique pour la prévention blessures." };

  // marche
  if (type === "Marche") return { tag: "🚶 Récup", color: "#5dca8a", detail: "Marche — récupération active." };

  return { tag: "• Autre", color: "#6f685c", detail: "Activité complémentaire." };
}

// Construit les données du calendrier sur N mois
export function buildCalendarData(sessions, months = 3) {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  // charge cumulée par jour (pour calculer ACWR au fil du temps)
  const allSorted = [...sessions].sort((a, b) => a.date - b.date);
  const dayLoadMap = {};
  allSorted.forEach((s) => {
    const k = dayKey(s.date instanceof Date ? s.date : new Date(s.date));
    dayLoadMap[k] = (dayLoadMap[k] || 0) + activityLoad(s);
  });

  // pour chaque jour dans la fenêtre, calcule les activités + charge
  const calDays = {};
  const cur = new Date(start);
  while (cur <= now) {
    const k = dayKey(cur);
    const daySessions = sessions.filter((s) => {
      const d = s.date instanceof Date ? s.date : new Date(s.date);
      return dayKey(d) === k;
    });

    // ACWR à ce jour
    const acwrAtDay = (() => {
      const acute = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(cur); d.setDate(d.getDate() - i);
        return dayLoadMap[dayKey(d)] || 0;
      }).reduce((a, b) => a + b, 0);
      const chronic = Array.from({ length: 28 }, (_, i) => {
        const d = new Date(cur); d.setDate(d.getDate() - i);
        return dayLoadMap[dayKey(d)] || 0;
      }).reduce((a, b) => a + b, 0) / 4;
      return chronic > 0 ? acute / chronic : 0;
    })();

    calDays[k] = {
      date: k,
      sessions: daySessions.map((s) => ({ ...s, impact: impactTag(s, acwrAtDay) })),
      totalLoad: daySessions.reduce((sum, s) => sum + activityLoad(s), 0),
      acwr: acwrAtDay,
    };
    cur.setDate(cur.getDate() + 1);
  }
  return calDays;
}

export function generateCoachDigest({ a, advanced, health, goal }) {
  // Données disponibles
  const acwr = a?.acwr ?? 0;
  const weekKm = a?.weeks?.at(-1)?.km ?? 0;
  const weekCount = a?.weeks?.at(-1)?.count ?? 0;
  const streak = a?.streak ?? 0;
  const daysSinceLast = a?.daysSinceLast ?? 0;
  const vo2 = a?.vo2 ?? null;
  const tsb = advanced?.pmc?.at(-1)?.tsb ?? null;
  const ctl = advanced?.pmc?.at(-1)?.ctl ?? null;
  const atl = advanced?.pmc?.at(-1)?.atl ?? null;
  const recoveryScore = health?.recovery?.score ?? null;
  const idx = progressionIndex(a?.runs ?? [], 6);
  const lastWeeks = a?.weeks?.slice(-4) ?? [];
  const prevWeekKm = lastWeeks.length >= 2 ? lastWeeks[lastWeeks.length - 2]?.km ?? 0 : 0;
  const volumeTrend = prevWeekKm > 0 ? ((weekKm - prevWeekKm) / prevWeekKm) * 100 : 0;

  const lines = [];

  // ── 1. BILAN DE LA SEMAINE ──
  const bilanParts = [];
  if (weekKm > 0) bilanParts.push(`${weekKm} km en ${weekCount} sortie${weekCount > 1 ? "s" : ""} cette semaine`);
  if (volumeTrend > 10) bilanParts.push(`volume en hausse de ${volumeTrend.toFixed(0)}% vs la semaine précédente`);
  else if (volumeTrend < -10) bilanParts.push(`volume en baisse de ${Math.abs(volumeTrend).toFixed(0)}% vs la semaine précédente`);
  else if (prevWeekKm > 0) bilanParts.push("volume stable par rapport à la semaine précédente");
  if (bilanParts.length) lines.push("📊 **Cette semaine** : " + bilanParts.join(", ") + ".");

  // ── 2. ÉTAT DE FORME ──
  if (tsb !== null) {
    if (tsb > 15) lines.push(`⚡ **Forme de pic** (TSB +${tsb}) : tu es frais et reposé — idéal pour une compétition ou une séance test. Attention à ne pas trop réduire le volume au risque de perdre des adaptations.`);
    else if (tsb > 5) lines.push(`✅ **Bonne fraîcheur** (TSB +${tsb}) : charge bien équilibrée, tu peux enchaîner une séance de qualité sans risque.`);
    else if (tsb >= -10) lines.push(`🔄 **Zone de progression** (TSB ${tsb}) : charge et récupération bien dosées — c'est là que les adaptations se font. Continue sur cette lancée.`);
    else if (tsb >= -25) lines.push(`⚠️ **Fatigue productive** (TSB ${tsb}) : tu accumules de la charge, c'est normal en bloc d'entraînement. Surveille la qualité du sommeil et les signaux de ton corps.`);
    else lines.push(`🔴 **Fatigue élevée** (TSB ${tsb}) : la charge est lourde. Prévois 2-3 jours de récupération active avant ta prochaine séance intense.`);
  } else if (acwr > 0) {
    if (acwr > 1.5) lines.push(`⚠️ **Charge trop élevée** (ACWR ${acwr.toFixed(2)}) : tu as nettement augmenté le volume d'un coup. Risque de blessure — réduis et prends du repos.`);
    else if (acwr > 1.3) lines.push(`🔶 **Charge à surveiller** (ACWR ${acwr.toFixed(2)}) : tu es dans la zone de vigilance. Pas d'augmentation supplémentaire cette semaine.`);
    else if (acwr >= 0.8) lines.push(`✅ **Charge optimale** (ACWR ${acwr.toFixed(2)}) : bonne gestion de la progression.`);
    else lines.push(`↓ **Sous-charge** (ACWR ${acwr.toFixed(2)}) : volume en dessous de ta base habituelle. Tu peux ré-augmenter progressivement (+10% max/semaine).`);
  }

  // ── 3. RÉCUPÉRATION ──
  if (recoveryScore !== null) {
    if (recoveryScore >= 70) lines.push(`💚 **Récupération excellente** (score ${recoveryScore}/100) : VFC et sommeil au vert. Profites-en pour placer une séance exigeante.`);
    else if (recoveryScore >= 45) lines.push(`🟡 **Récupération correcte** (score ${recoveryScore}/100) : séance modérée conseillée, évite le très intense aujourd'hui.`);
    else lines.push(`🔴 **Récupération insuffisante** (score ${recoveryScore}/100) : ton corps signale du stress ou un manque de sommeil. Priorité au repos ou à une sortie très légère.`);
  }
  if (streak >= 7) lines.push(`⏸️ **${streak} jours d'affilée sans repos** : le corps progresse pendant la récupération, pas pendant l'effort. Un jour off complet cette semaine n'est pas optionnel, c'est productif.`);
  else if (streak >= 5) lines.push(`👀 **${streak} jours consécutifs** : pense à intégrer un jour de récupération dans les 48h.`);

  // ── 4. PROGRESSION ──
  if (idx) {
    if (idx.pct > 5) lines.push(`📈 **Progression nette** (+${idx.pct}% d'efficacité aérobie sur 6 semaines) : tu vas plus vite pour une FC équivalente — ton moteur aérobie s'améliore vraiment. Continue à doser la charge comme tu le fais.`);
    else if (idx.pct > 2) lines.push(`📈 **Légère progression** (+${idx.pct}%) : tendance positive, reste régulier.`);
    else if (idx.pct < -5) lines.push(`📉 **Baisse d'efficacité** (${idx.pct}%) : tu travailles plus fort pour la même vitesse. Ça peut venir de la fatigue accumulée ou d'un manque de séances faciles — vérifie que tu ne cours pas tout en intensité modérée.`);
    else if (idx.pct < -2) lines.push(`📉 **Légère baisse** (${idx.pct}%) : à surveiller. Si ça persiste 2 semaines de plus, intègre plus de volume facile.`);
  }

  // ── 5. CONSEIL SÉANCE DE LA SEMAINE ──
  const conseils = [];
  const canGoHard = (tsb !== null ? tsb > -10 : acwr <= 1.3) && streak <= 5 && daysSinceLast >= 1;
  const needsRest = streak >= 7 || (tsb !== null && tsb < -25) || acwr > 1.5 || (recoveryScore !== null && recoveryScore < 40);

  if (needsRest) {
    conseils.push("🛌 **Priorité repos** : séance légère ou journée off. Pas de fractionné ni de sortie longue cette semaine.");
  } else if (canGoHard) {
    if (weekKm < 40) conseils.push("🏃 **Séance de qualité recommandée** : fractionné court (ex: 6×1000m à allure 10k) ou seuil (20-30 min à allure tempo). Tu es frais, profites-en.");
    else conseils.push("🏃 **Séance de qualité recommandée** : seuil ou allure marathon. Tu as déjà un bon volume cette semaine, donc une séance intense bien dosée plutôt qu'une longue supplémentaire.");
    const longTarget = Math.round(weekKm * 0.28);
    if (longTarget >= 12) conseils.push(`📏 **Sortie longue** : vise ${longTarget}-${longTarget + 3} km en endurance fondamentale (allure conversation) pour consolider ta base aérobie.`);
  } else {
    conseils.push("🚶 **Semaine de transition** : favorise l'endurance fondamentale (allure conversation, FC <75% max). Pas de fractionné tant que la charge n'est pas redescendue.");
  }
  if (conseils.length) lines.push(...conseils);

  // ── 6. OBJECTIF ──
  if (goal?.date && goal?.distanceKm) {
    const weeksLeft = Math.max(0, Math.round((new Date(goal.date) - new Date()) / 604800000));
    const pred = a?.predictions?.find((p) => Math.abs(p.km - goal.distanceKm) < 0.6);
    if (weeksLeft > 0) {
      const phaseTxt = weeksLeft > 12 ? "Phase de construction (volume)" : weeksLeft > 6 ? "Phase spécifique (allure objectif)" : weeksLeft > 3 ? "Phase de pic" : "Affûtage — réduis le volume, garde l'intensité";
      lines.push(`🎯 **${goal.race || "Objectif"}** dans ${weeksLeft} semaines — ${phaseTxt}.`);
      if (pred && goal.targetSec) {
        const gap = pred.sec - goal.targetSec;
        if (gap <= 0) lines.push(`   La projection actuelle (${fmtTime(pred.sec)}) est en avance sur ton objectif (${fmtTime(goal.targetSec)}) — tu es dans les temps.`);
        else lines.push(`   La projection actuelle (${fmtTime(pred.sec)}) est à ${fmtTime(Math.abs(gap))} de ton objectif (${fmtTime(goal.targetSec)}) — il reste du travail, mais ${weeksLeft > 8 ? "tu as le temps" : "concentre-toi sur les séances spécifiques"}.`);
      }
    }
  }

  if (!lines.length) return "Pas encore assez de données pour générer une analyse. Synchronise tes activités Strava et reviens !";
  return lines.join("\n\n");
}

export function detectAnomalies(runs) {
  // Pour chaque course, on compare son efficacité aérobie (vitesse/FC)
  // à la moyenne glissante des 8 semaines précédentes.
  // Si elle dévie de plus de 2 écarts-types : anomalie.
  const withEf = runs
    .filter((r) => efficiencyOf(r) != null)
    .map((r) => ({ ...r, ef: efficiencyOf(r) }));

  if (withEf.length < 5) return [];

  const anomalies = [];
  withEf.forEach((run, i) => {
    const cutoff = new Date(run.date); cutoff.setDate(cutoff.getDate() - 56); // 8 semaines
    const window = withEf.slice(0, i).filter((r) => r.date >= cutoff);
    if (window.length < 4) return;

    const mean = window.reduce((s, r) => s + r.ef, 0) / window.length;
    const std = Math.sqrt(window.reduce((s, r) => s + Math.pow(r.ef - mean, 2), 0) / window.length);
    if (std === 0) return;

    const zScore = (run.ef - mean) / std;
    if (Math.abs(zScore) < 1.8) return; // seuil : 1.8 écarts-types

    const direction = zScore > 0 ? "positive" : "negative";
    let label, explanation;
    if (direction === "positive") {
      label = "Séance exceptionnelle";
      explanation = `Tu as couru ${((run.ef / mean - 1) * 100).toFixed(0)}% plus efficacement que ta moyenne récente — meilleure vitesse pour une FC équivalente. Bonne forme ou conditions idéales ce jour-là.`;
    } else {
      label = "Séance en dessous de ta forme";
      explanation = `Ton efficacité était ${((1 - run.ef / mean) * 100).toFixed(0)}% en dessous de ta moyenne récente — plus lent que d'habitude pour une FC équivalente. Fatigue, stress, mauvais sommeil, ou chaleur peuvent expliquer ça.`;
    }

    anomalies.push({
      date: run.date,
      distanceKm: run.distanceKm,
      pace: run.pace,
      avgHr: run.avgHr,
      ef: run.ef,
      meanEf: mean,
      zScore: +zScore.toFixed(2),
      direction,
      label,
      explanation,
    });
  });

  return anomalies.slice(-5); // les 5 plus récentes
}

/* ---------- temps de récupération conseillé après une séance ---------- */
export function recoveryAdvice(session, context = {}) {
  const { acwr = 1.0, vo2max = null } = context;
  const type = session.type || "Autre";
  const dur = session.durationMin || 0;
  const hr = session.avgHr || null;
  const intensity = activityIntensity(session);

  const baseHours = { "Course": 24, "Vélo": 16, "Natation": 12, "Renfo": 20, "Marche": 8, "Autre": 12 }[type] || 12;
  const factors = [];
  let total = baseHours;

  if (hr) {
    if (hr > 175) { total += 12; factors.push(`FC très élevée (${Math.round(hr)} bpm)`); }
    else if (hr > 160) { total += 6; factors.push(`FC élevée (${Math.round(hr)} bpm)`); }
    else if (hr < 135) { total -= 4; factors.push("effort facile, FC basse"); }
  }

  if (dur > 90) { total += 12; factors.push(`sortie longue (${Math.round(dur)} min)`); }
  else if (dur > 60) { total += 6; factors.push("durée soutenue"); }
  else if (dur < 30) { total -= 4; factors.push("séance courte"); }

  if (acwr > 1.4) { total += 12; factors.push(`charge globale élevée (ACWR ${acwr.toFixed(2)})`); }
  else if (acwr > 1.2) { total += 6; factors.push(`charge en hausse (ACWR ${acwr.toFixed(2)})`); }
  else if (acwr < 0.8) { total -= 4; factors.push("charge basse"); }

  if (vo2max) {
    if (vo2max > 55) { total -= 4; factors.push(`bonne condition physique (VO2max ${vo2max})`); }
    else if (vo2max < 40) { total += 4; }
  }

  if (type === "Course" && intensity > 0.80) { total += 8; factors.push("séance très intense"); }
  else if (type === "Course" && intensity > 0.65) { total += 4; factors.push("allure soutenue"); }

  total = Math.max(8, Math.min(72, Math.round(total / 4) * 4));

  const level = total <= 16 ? "🟢" : total <= 32 ? "🟡" : "🔴";
  const conseil = total <= 16
    ? "Tu peux t'entraîner dès demain."
    : total <= 32
    ? "Séance légère possible, évite l'intense."
    : "Privilégie le repos ou une activité très légère.";

  return {
    hours: total,
    level,
    label: `${total}h de récup conseillée`,
    explanation: factors.length ? factors.join(", ") : "séance modérée",
    conseil,
  };
}

/* ---------- météo historique via Open-Meteo (gratuit, sans clé) ---------- */
// Récupère la température moyenne à Paris pour une date donnée
// Utilise un cache en mémoire pour ne pas re-fetcher la même date
const weatherCache = {};
export async function fetchWeatherForDate(dateISO, lat = 48.85, lon = 2.35) {
  const day = dateISO.slice(0, 10);
  if (weatherCache[day] !== undefined) return weatherCache[day];
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${day}&end_date=${day}&hourly=temperature_2m&timezone=Europe%2FParis`;
    const r = await fetch(url);
    if (!r.ok) { weatherCache[day] = null; return null; }
    const data = await r.json();
    const temps = data?.hourly?.temperature_2m;
    if (!temps?.length) { weatherCache[day] = null; return null; }
    // température moyenne sur la journée
    const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
    weatherCache[day] = +avg.toFixed(1);
    return weatherCache[day];
  } catch {
    weatherCache[day] = null;
    return null;
  }
}

/* ---------- calcul récupération enrichi (profil + météo) ---------- */
export function recoveryAdviceEnriched(session, context = {}) {
  const { acwr = 1.0, vo2max = null, profile = {}, tempC = null } = context;
  const { age = 23, weeklyFrequency = 5 } = profile; // défauts : 20-25 ans, 5x/semaine
  const type = session.type || "Autre";
  const dur = session.durationMin || 0;
  const hr = session.avgHr || null;
  const intensity = activityIntensity(session);

  const baseHours = { "Course": 20, "Vélo": 14, "Natation": 10, "Renfo": 18, "Marche": 6, "Autre": 10 }[type] || 10;
  const factors = [];
  let total = baseHours;

  // ── niveau d'entraînement (coureur régulier = récup plus rapide) ──
  if (weeklyFrequency >= 5) { total -= 6; }
  else if (weeklyFrequency >= 3) { total -= 3; }

  // ── âge ──
  if (age < 25) { total -= 2; }
  else if (age > 35) { total += 4; }
  else if (age > 30) { total += 2; }

  // ── FC ──
  if (hr) {
    if (hr > 175) { total += 10; factors.push(`FC très élevée (${Math.round(hr)} bpm)`); }
    else if (hr > 162) { total += 5; factors.push(`FC élevée (${Math.round(hr)} bpm)`); }
    else if (hr < 135) { total -= 4; factors.push("effort facile, FC basse"); }
  }

  // ── durée ──
  if (dur > 90) { total += 10; factors.push(`sortie longue (${Math.round(dur)} min)`); }
  else if (dur > 60) { total += 5; factors.push("durée soutenue"); }
  else if (dur < 30) { total -= 4; factors.push("séance courte"); }

  // ── ACWR ──
  if (acwr > 1.4) { total += 10; factors.push(`charge globale élevée (ACWR ${acwr.toFixed(2)})`); }
  else if (acwr > 1.2) { total += 5; factors.push(`charge en hausse (ACWR ${acwr.toFixed(2)})`); }
  else if (acwr < 0.8) { total -= 3; }

  // ── VO2max ──
  if (vo2max && vo2max > 55) { total -= 3; factors.push(`bonne condition physique (VO2max ${vo2max})`); }

  // ── type de séance ──
  if (type === "Course" && intensity > 0.80) { total += 6; factors.push("séance très intense"); }
  else if (type === "Course" && intensity > 0.65) { total += 3; factors.push("allure soutenue"); }

  // ── météo : chaleur ──
  if (tempC !== null) {
    if (tempC >= 30) { total += 8; factors.push(`forte chaleur (${tempC}°C)`); }
    else if (tempC >= 25) { total += 4; factors.push(`chaleur (${tempC}°C)`); }
    else if (tempC <= 10) { total += 2; factors.push(`froid (${tempC}°C)`); }
  }

  total = Math.max(8, Math.min(60, Math.round(total / 4) * 4));

  const level = total <= 16 ? "🟢" : total <= 28 ? "🟡" : "🔴";
  const conseil = total <= 16
    ? "Tu peux t'entraîner dès demain."
    : total <= 28
    ? "Séance légère possible, évite l'intense."
    : "Privilégie le repos ou activité très légère.";

  return {
    hours: total,
    level,
    label: `${total}h de récup conseillée`,
    explanation: factors.length ? factors.join(", ") : "séance modérée",
    conseil,
    tempC,
  };
}