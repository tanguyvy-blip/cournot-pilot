const $ = (id) => document.getElementById(id);

let l1Chart = null;
let l2Chart = null;

function renderStats(data) {
  $("stats").innerHTML = `
    <span class="pill">Étudiants: ${data.studentsTotal}</span>
    <span class="pill">Sessions actives: ${data.sessionsActive}</span>
    <span class="pill">Jeu: ${data.gameRunning ? "En cours" : data.gameStarted ? "En pause" : "Non démarré"}</span>
    <span class="pill">Décisions niveau 1: ${data.level1Attempts}</span>
    <span class="pill">Décisions niveau 2: ${data.level2Attempts}</span>
    <span class="pill">Écart moyen à BR (N1): ${data.level1AvgGapToBestResponse}</span>
  `;

  $("toggleGameBtn").textContent = data.gameRunning ? "Mettre en pause" : "Démarrer le jeu";
}

function renderL1(data) {
  const ctx = $("profL1Chart").getContext("2d");
  if (l1Chart) l1Chart.destroy();
  l1Chart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Meilleure réponse BR(q concurrent)",
          data: data.bestResponseSeries.map((p) => ({ x: p.qOpp, y: p.br })),
          showLine: true,
          borderColor: "#808b85",
          backgroundColor: "#808b85",
          pointRadius: 0,
          borderWidth: 3
        },
        {
          type: "scatter",
          label: "Choix étudiants",
          data: data.level1Points.map((p) => ({ x: p.qCompetitor, y: p.qStudent })),
          backgroundColor: "#18644e",
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      animation: false,
      parsing: false,
      plugins: {
        tooltip: {
          callbacks: {
            label(context) {
              if (context.dataset.label === "Choix étudiants") {
                const p = data.level1Points[context.dataIndex];
                return `q_j=${p.qCompetitor}, q_i=${p.qStudent}, BR=${p.qBestResponse}, écart=${p.gapToBestResponse}`;
              }
              return `${context.dataset.label}: (${context.parsed.x}, ${context.parsed.y})`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 100,
          title: { display: true, text: "q concurrent" }
        },
        y: { title: { display: true, text: "q étudiant" } }
      }
    }
  });
}

function renderL2(data) {
  const ctx = $("profL2Chart").getContext("2d");
  if (l2Chart) l2Chart.destroy();
  const br1 = [];
  const br2 = [];
  for (let q = 0; q <= 100; q += 1) {
    br1.push({ x: q, y: Math.max(0, 40 - q / 2) });
    br2.push({ x: q, y: Math.max(0, 80 - 2 * q) });
  }
  l2Chart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "BR1: q1 = 40 - q2/2",
          data: br1,
          showLine: true,
          borderColor: "#6c7a89",
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: "BR2: q2 = 40 - q1/2",
          data: br2,
          showLine: true,
          borderColor: "#9c6a2f",
          borderWidth: 2,
          pointRadius: 0
        },
        {
          type: "scatter",
          label: "Choix observés",
          data: data.level2Points.map((p) => ({ x: p.qCompetitor, y: p.qStudent })),
          backgroundColor: "#2d8a6f",
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      animation: false,
      parsing: false,
      plugins: {
        tooltip: {
          callbacks: {
            label(context) {
              if (context.dataset.label === "Choix observés") {
                const p = data.level2Points[context.dataIndex];
                return `round=${p.round}, q_j=${p.qCompetitor}, q_i=${p.qStudent}, profit=${p.profit}`;
              }
              return `${context.dataset.label}: (${context.parsed.x}, ${context.parsed.y})`;
            }
          }
        }
      },
      scales: {
        x: { type: "linear", min: 0, max: 100, title: { display: true, text: "q concurrent (q_j)" } },
        y: { type: "linear", min: 0, max: 100, title: { display: true, text: "q étudiant (q_i)" } }
      }
    }
  });
}

async function refresh() {
  const res = await fetch("/api/prof/summary");
  const data = await res.json();
  renderStats(data);
  renderL1(data);
  renderL2(data);
  return data;
}

async function forceLevel2Now() {
  const res = await fetch("/api/prof/force-level2", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("profActionMsg").textContent = data.error || "Action impossible.";
    return;
  }
  $("profActionMsg").textContent = data.message || "Niveau 2 forcé.";
  await refresh();
}

async function toggleGame() {
  const summary = await refresh();
  const endpoint = summary.gameRunning ? "/api/prof/game/pause" : "/api/prof/game/start";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const data = await res.json().catch(() => ({}));
  $("profActionMsg").textContent = data.message || "État du jeu mis à jour.";
  await refresh();
}

async function resetAll() {
  const confirmed = window.confirm(
    "Confirmer le reset total ? Cette action supprime toutes les décisions, sessions et progressions."
  );
  if (!confirmed) return;
  const res = await fetch("/api/prof/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("profActionMsg").textContent = data.error || "Reset impossible.";
    return;
  }
  $("profActionMsg").textContent = data.message || "Reset effectué.";
  await refresh();
}

$("refreshBtn").addEventListener("click", refresh);
$("toggleGameBtn").addEventListener("click", toggleGame);
$("resetBtn").addEventListener("click", resetAll);
$("forceLevel2Btn").addEventListener("click", forceLevel2Now);
refresh();
setInterval(refresh, 5000);
