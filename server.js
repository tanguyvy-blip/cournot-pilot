const express = require("express");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const STATE = {
  students: new Map(),
  sessions: new Map(),
  level2PendingByRound: new Map(),
  records: [],
  game: {
    started: false,
    paused: true
  }
};

const TOTAL_ROUNDS = 10;
const C_MAX = 100;
const A = 60;
const B = 0.5;
const MC = 20;

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function makeToken() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function marketPrice(totalQ) {
  return Math.max(0, A - B * totalQ);
}

function profit(q, qOpp) {
  const p = marketPrice(q + qOpp);
  return (p - MC) * q;
}

function bestResponse(qOpp) {
  const threshold = (A - MC) / B;
  const unconstrained = (A - MC - B * qOpp) / (2 * B);
  const br = qOpp <= threshold ? unconstrained : 0;
  return clamp(br, 0, C_MAX);
}

function buildProfitSeries(qOpp, step = 1) {
  const points = [];
  for (let q = 0; q <= C_MAX; q += step) {
    points.push({ q, profit: round2(profit(q, qOpp)) });
  }
  return points;
}

function getLevel1RecordsForStudent(studentId) {
  return STATE.records
    .filter((r) => r.studentId === studentId && r.level === 1)
    .sort((a, b) => a.round - b.round);
}

function isLevel2Unlocked(studentId) {
  const student = STATE.students.get(studentId);
  if (student && student.forceLevel2) return true;
  if (student && student.level1Round > TOTAL_ROUNDS) return true;
  const records = getLevel1RecordsForStudent(studentId);
  return records.length >= TOTAL_ROUNDS;
}

function loadRoster() {
  const rosterPath = path.join(__dirname, "data", "roster.xlsx");
  if (!fs.existsSync(rosterPath)) {
    throw new Error(`Fichier introuvable: ${rosterPath}`);
  }
  const wb = XLSX.readFile(rosterPath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  if (!rows.length) {
    throw new Error("Le fichier roster.xlsx est vide.");
  }

  STATE.students.clear();
  for (const row of rows) {
    const entries = Object.entries(row).map(([k, v]) => [normalizeHeader(k), v]);
    const byKey = Object.fromEntries(entries);

    let studentId = byKey.numeroetudiant || byKey.etudiant || byKey.id || byKey.studentid || byKey.numero;
    if (!studentId) {
      const firstNumeric = Object.values(row).find((x) => /^\d+$/.test(String(x).trim()));
      studentId = firstNumeric;
    }
    if (!studentId) continue;

    const id = String(studentId).trim();
    const firstName = String(
      byKey.prenom || byKey.firstname || byKey.givenname || row.prenom || row.firstName || ""
    ).trim();
    const lastName = String(
      byKey.nom || byKey.lastname || byKey.familyname || row.nom || row.lastName || ""
    ).trim();

    STATE.students.set(id, {
      id,
      firstName: firstName || "Étudiant",
      lastName: lastName || "",
      level1Round: 1,
      level2Round: 1,
      level1OppQuantity: null,
      forceLevel2: false
    });
  }

  if (!STATE.students.size) {
    throw new Error("Impossible de lire les étudiants depuis roster.xlsx.");
  }
}

function safeStudentPublic(student) {
  return {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    level1Round: student.level1Round,
    level2Round: student.level2Round,
    level2Unlocked: isLevel2Unlocked(student.id)
  };
}

function getSession(req) {
  const token = req.headers["x-session-token"];
  if (!token || !STATE.sessions.has(token)) return null;
  const studentId = STATE.sessions.get(token);
  const student = STATE.students.get(studentId);
  if (!student) return null;
  return { token, student };
}

function isGameRunning() {
  return STATE.game.started && !STATE.game.paused;
}

app.post("/api/login", (req, res) => {
  const studentId = String(req.body.studentId || "").trim();
  if (!STATE.students.has(studentId)) {
    return res.status(401).json({ error: "Numéro étudiant introuvable." });
  }
  const token = makeToken();
  STATE.sessions.set(token, studentId);
  return res.json({ token, student: safeStudentPublic(STATE.students.get(studentId)) });
});

app.get("/api/me", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  return res.json({ student: safeStudentPublic(session.student) });
});

app.get("/api/history", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  const { student } = session;

  const rows = STATE.records
    .filter((r) => r.studentId === student.id)
    .sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if (a.round !== b.round) return a.round - b.round;
      return String(a.ts).localeCompare(String(b.ts));
    });

  let cumulativeProfit = 0;
  const history = rows.map((r) => {
    cumulativeProfit = round2(cumulativeProfit + toNumber(r.profit));
    return {
      level: r.level,
      round: r.round,
      quantity: r.qStudent,
      competitorQuantity: r.qCompetitor,
      price: r.price,
      payment: r.profit,
      cumulativeProfit
    };
  });

  return res.json({
    cumulativeProfit,
    rows: history
  });
});

app.get("/api/level1/state", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  const { student } = session;
  const finished = student.level1Round > TOTAL_ROUNDS;
  if (!finished && student.level1OppQuantity === null) {
    student.level1OppQuantity = randInt(0, C_MAX);
  }
  return res.json({
    finished,
    round: finished ? TOTAL_ROUNDS : student.level1Round,
    totalRounds: TOTAL_ROUNDS,
    competitorQuantity: finished ? null : student.level1OppQuantity,
    gameStarted: STATE.game.started,
    gamePaused: STATE.game.paused,
    gameRunning: isGameRunning()
  });
});

app.post("/api/level1/play", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  if (!isGameRunning()) {
    return res.status(423).json({
      error: STATE.game.started
        ? "Le jeu est en pause. Attendez la reprise par le professeur."
        : "Le jeu n'a pas encore démarré. Attendez le lancement par le professeur."
    });
  }
  const { student } = session;
  if (student.level1Round > TOTAL_ROUNDS) {
    return res.status(400).json({ error: "Niveau 1 déjà terminé." });
  }

  const q = clamp(toNumber(req.body.quantity), 0, C_MAX);
  const qOpp =
    student.level1OppQuantity === null
      ? randInt(0, C_MAX)
      : clamp(toNumber(student.level1OppQuantity), 0, C_MAX);
  const p = round2(marketPrice(q + qOpp));
  const pi = round2(profit(q, qOpp));
  const round = student.level1Round;

  STATE.records.push({
    ts: new Date().toISOString(),
    studentId: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    level: 1,
    round,
    pairId: "",
    competitorId: "concurrent",
    qStudent: round2(q),
    qCompetitor: round2(qOpp),
    totalQ: round2(q + qOpp),
    price: p,
    profit: pi,
    bestResponseToCompetitor: round2(bestResponse(qOpp))
  });

  student.level1Round += 1;
  student.level1OppQuantity = null;

  return res.json({
    round,
    quantity: round2(q),
    competitorQuantity: round2(qOpp),
    price: p,
    profit: pi,
    bestResponse: round2(bestResponse(qOpp)),
    profitSeries: buildProfitSeries(qOpp),
    nextRound: student.level1Round <= TOTAL_ROUNDS ? student.level1Round : null
  });
});

app.get("/api/level2/state", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  const { student } = session;
  const finished = student.level2Round > TOTAL_ROUNDS;
  return res.json({
    finished,
    round: finished ? TOTAL_ROUNDS : student.level2Round,
    totalRounds: TOTAL_ROUNDS,
    unlocked: isLevel2Unlocked(student.id),
    gameStarted: STATE.game.started,
    gamePaused: STATE.game.paused,
    gameRunning: isGameRunning()
  });
});

app.post("/api/level2/play", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  if (!isGameRunning()) {
    return res.status(423).json({
      error: STATE.game.started
        ? "Le jeu est en pause. Attendez la reprise par le professeur."
        : "Le jeu n'a pas encore démarré. Attendez le lancement par le professeur."
    });
  }
  const { student } = session;
  if (student.level2Round > TOTAL_ROUNDS) {
    return res.status(400).json({ error: "Niveau 2 déjà terminé." });
  }
  if (!isLevel2Unlocked(student.id)) {
    return res.status(403).json({
      error: "Niveau 2 verrouillé. Condition: profit strictement positif durant les 10 derniers rounds du niveau 1."
    });
  }

  const q = clamp(toNumber(req.body.quantity), 0, C_MAX);
  const round = student.level2Round;
  const pendingList = STATE.level2PendingByRound.get(round) || [];

  const alreadySubmitted = pendingList.find((x) => x.studentId === student.id);
  if (alreadySubmitted) {
    return res.status(400).json({ error: "Quantité déjà soumise pour ce round." });
  }

  pendingList.push({ studentId: student.id, quantity: round2(q) });
  STATE.level2PendingByRound.set(round, pendingList);

  if (pendingList.length < 2) {
    return res.json({ waiting: true, message: "En attente d'un autre étudiant pour former une paire.", round });
  }

  const shuffled = [...pendingList].sort(() => Math.random() - 0.5);
  const pairedResults = [];
  const leftovers = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    if (!b) {
      leftovers.push(a);
      continue;
    }
    const studentA = STATE.students.get(a.studentId);
    const studentB = STATE.students.get(b.studentId);
    if (!studentA || !studentB) continue;

    const pairId = `${round}_${studentA.id}_${studentB.id}`;
    const totalQ = a.quantity + b.quantity;
    const p = round2(marketPrice(totalQ));
    const piA = round2(profit(a.quantity, b.quantity));
    const piB = round2(profit(b.quantity, a.quantity));

    STATE.records.push({
      ts: new Date().toISOString(),
      studentId: studentA.id,
      firstName: studentA.firstName,
      lastName: studentA.lastName,
      level: 2,
      round,
      pairId,
      competitorId: studentB.id,
      qStudent: a.quantity,
      qCompetitor: b.quantity,
      totalQ: round2(totalQ),
      price: p,
      profit: piA,
      bestResponseToCompetitor: round2(bestResponse(b.quantity))
    });
    STATE.records.push({
      ts: new Date().toISOString(),
      studentId: studentB.id,
      firstName: studentB.firstName,
      lastName: studentB.lastName,
      level: 2,
      round,
      pairId,
      competitorId: studentA.id,
      qStudent: b.quantity,
      qCompetitor: a.quantity,
      totalQ: round2(totalQ),
      price: p,
      profit: piB,
      bestResponseToCompetitor: round2(bestResponse(a.quantity))
    });

    studentA.level2Round += 1;
    studentB.level2Round += 1;

    pairedResults.push({
      studentId: studentA.id,
      competitorId: studentB.id,
      quantity: a.quantity,
      competitorQuantity: b.quantity,
      totalQ: round2(totalQ),
      price: p,
      profit: piA
    });
    pairedResults.push({
      studentId: studentB.id,
      competitorId: studentA.id,
      quantity: b.quantity,
      competitorQuantity: a.quantity,
      totalQ: round2(totalQ),
      price: p,
      profit: piB
    });
  }

  STATE.level2PendingByRound.set(round, leftovers);

  const myResult = pairedResults.find((x) => x.studentId === student.id);
  if (!myResult) {
    return res.json({ waiting: true, message: "En attente d'un autre étudiant pour former une paire.", round });
  }

  return res.json({
    waiting: false,
    round,
    ...myResult,
    profitSeries: buildProfitSeries(myResult.competitorQuantity),
    nextRound: student.level2Round <= TOTAL_ROUNDS ? student.level2Round : null
  });
});

app.get("/api/level2/poll", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Session invalide." });
  const { student } = session;
  const lastRound = Math.max(1, student.level2Round - 1);
  const record = [...STATE.records]
    .reverse()
    .find((r) => r.studentId === student.id && r.level === 2 && r.round === lastRound);
  if (!record) return res.json({ ready: false });
  return res.json({
    ready: true,
    round: record.round,
    quantity: record.qStudent,
    competitorQuantity: record.qCompetitor,
    totalQ: record.totalQ,
    price: record.price,
    profit: record.profit,
    competitorId: record.competitorId,
    nextRound: student.level2Round <= TOTAL_ROUNDS ? student.level2Round : null,
    profitSeries: buildProfitSeries(record.qCompetitor)
  });
});

app.get("/api/prof/summary", (_req, res) => {
  const level1 = STATE.records.filter((r) => r.level === 1);
  const level2 = STATE.records.filter((r) => r.level === 2);

  const level1Points = level1.map((r) => ({
    studentId: r.studentId,
    round: r.round,
    qCompetitor: r.qCompetitor,
    qStudent: r.qStudent,
    qBestResponse: r.bestResponseToCompetitor,
    gapToBestResponse: round2(Math.abs(r.qStudent - r.bestResponseToCompetitor))
  }));

  const level2Points = level2.map((r) => ({
    studentId: r.studentId,
    round: r.round,
    qCompetitor: r.qCompetitor,
    qStudent: r.qStudent,
    profit: r.profit
  }));

  const brSeries = [];
  for (let qOpp = 0; qOpp <= C_MAX; qOpp += 1) brSeries.push({ qOpp, br: round2(bestResponse(qOpp)) });
  const profitCurveVsFixedQOpp30 = buildProfitSeries(30);
  const level1AvgGapToBR =
    level1Points.length > 0
      ? round2(level1Points.reduce((acc, x) => acc + x.gapToBestResponse, 0) / level1Points.length)
      : 0;

  return res.json({
    studentsTotal: STATE.students.size,
    sessionsActive: STATE.sessions.size,
    gameStarted: STATE.game.started,
    gamePaused: STATE.game.paused,
    gameRunning: isGameRunning(),
    level1Attempts: level1.length,
    level2Attempts: level2.length,
    level1AvgGapToBestResponse: level1AvgGapToBR,
    marginalCost: MC,
    level1Points,
    level2Points,
    bestResponseSeries: brSeries,
    referenceProfitSeries: profitCurveVsFixedQOpp30
  });
});

app.post("/api/prof/force-level2", (_req, res) => {
  let updated = 0;
  for (const student of STATE.students.values()) {
    student.forceLevel2 = true;
    student.level1Round = Math.max(student.level1Round, TOTAL_ROUNDS + 1);
    student.level1OppQuantity = null;
    updated += 1;
  }
  return res.json({
    ok: true,
    updated,
    message: "Tous les étudiants peuvent maintenant commencer immédiatement au niveau 2."
  });
});

app.post("/api/prof/game/start", (_req, res) => {
  STATE.game.started = true;
  STATE.game.paused = false;
  return res.json({ ok: true, gameStarted: true, gamePaused: false, message: "Le jeu est démarré." });
});

app.post("/api/prof/game/pause", (_req, res) => {
  STATE.game.paused = true;
  if (!STATE.game.started) STATE.game.started = true;
  return res.json({ ok: true, gameStarted: true, gamePaused: true, message: "Le jeu est en pause." });
});

app.post("/api/prof/reset", (_req, res) => {
  STATE.sessions.clear();
  STATE.level2PendingByRound.clear();
  STATE.records = [];
  STATE.game.started = false;
  STATE.game.paused = true;

  loadRoster();

  return res.json({
    ok: true,
    studentsTotal: STATE.students.size,
    message: "Réinitialisation complète effectuée. Toutes les sessions, décisions et progressions ont été remises à zéro."
  });
});

function recordsToCsv(rows) {
  const headers = [
    "timestamp",
    "studentId",
    "firstName",
    "lastName",
    "level",
    "round",
    "pairId",
    "competitorId",
    "qStudent",
    "qCompetitor",
    "totalQ",
    "price",
    "profit",
    "bestResponseToCompetitor"
  ];
  const escaped = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    const data = [
      row.ts,
      row.studentId,
      row.firstName,
      row.lastName,
      row.level,
      row.round,
      row.pairId,
      row.competitorId,
      row.qStudent,
      row.qCompetitor,
      row.totalQ,
      row.price,
      row.profit,
      row.bestResponseToCompetitor
    ];
    lines.push(data.map(escaped).join(","));
  }
  return lines.join("\n");
}

app.get("/api/prof/export.csv", (_req, res) => {
  const csv = recordsToCsv(STATE.records);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="cournot_pilot_data.csv"');
  res.send(csv);
});

app.get("/api/prof/export.json", (_req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="cournot_pilot_data.json"');
  res.json({ exportedAt: new Date().toISOString(), rows: STATE.records });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.path === "/prof" || req.path === "/prof/") {
    return res.sendFile(path.join(__dirname, "public", "prof.html"));
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

try {
  loadRoster();
  app.listen(PORT, () => {
    console.log(`Cournot Pilot démarre sur http://localhost:${PORT}`);
    console.log(`Étudiants chargés: ${STATE.students.size}`);
  });
} catch (err) {
  console.error("Erreur au démarrage:", err.message);
  process.exit(1);
}

