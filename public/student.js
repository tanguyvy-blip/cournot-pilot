const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("cournotToken") || "";
let student = null;
let l1Chart = null;
let l2Chart = null;
let currentLevelTab = 1;

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["x-session-token"] = token;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur API");
  return data;
}

function setLoggedInUI() {
  $("loginCard").classList.add("hidden");
  $("gameCard").classList.remove("hidden");
  updateWelcomeTitle();
  $("levelStatusText").textContent = "Vous commencez au niveau 1.";
  $("unlockRuleText").textContent =
    "Débloquer le niveau 2: profit strictement positif durant les 10 derniers rounds du niveau 1.";
  $("gameStateTitle").textContent = "Jeu actif";
  $("gameStateText").textContent = "Vous êtes connecté(e). Passez vos décisions round par round.";
  $("level2Instruction").textContent =
    "Niveau 2: vous choisissez votre quantité sans observer celle du concurrent. Les paires sont tirées au hasard à chaque round.";
  renderRules(1);
  updateLevelBanner(false);
}

function switchTab(level) {
  currentLevelTab = level;
  const l1 = level === 1;
  $("level1Panel").classList.toggle("hidden", !l1);
  $("level2Panel").classList.toggle("hidden", l1);
  updateWelcomeTitle();
  renderRules(level);
  updateLevelBanner(level === 2);
}

function updateWelcomeTitle() {
  const label = currentLevelTab === 2 ? "Niveau 2" : "Niveau 1";
  $("welcomeTitle").textContent = `${label} - ${student.firstName} ${student.lastName}`.trim();
}

function updateLevelBanner(showLevel2) {
  const el = $("levelBanner");
  if (showLevel2) {
    el.textContent = "Félicitations, vous êtes en niveau 2 !";
    el.classList.remove("hidden");
    return;
  }
  el.classList.add("hidden");
}

function renderRules(level) {
  $("rulesTitle").textContent = "Règles du jeu";
  if (level === 2) {
    $("rulesContent").innerHTML = `
      <p>Dans ce jeu, <strong>vous êtes une entreprise</strong> qui produit et vend un bien sur un marché.</p>
      <p>Votre objectif est simple : <strong>maximiser votre profit</strong>.</p>
      <p>À chaque manche, vous serez <strong>apparié(e) aléatoirement</strong> avec un autre participant.</p>
      <p>Cet autre participant est lui aussi une entreprise, qui cherche également à <strong>maximiser son propre profit</strong>.</p>
      <hr />
      <h4>Déroulement d’une manche</h4>
      <ol>
        <li>Vous choisissez la <strong>quantité</strong> que votre entreprise met sur le marché.</li>
        <li>Vous prenez votre décision sans connaître la <strong>quantité choisie par l’autre entreprise</strong>.</li>
        <li>Une fois les deux décisions prises :</li>
      </ol>
      <ul>
        <li>La <strong>quantité totale mise sur le marché</strong> est calculée : <span class="formula">Q = q1 + q2</span></li>
        <li>Le prix de vente sur le marché est déterminé par la fonction de demande : <span class="formula">P = 60 - Q/2</span></li>
        <li>Le <strong>profit de chaque entreprise</strong> est alors calculé en fonction du prix obtenu, de sa propre quantité produite et de son coût de production.</li>
      </ul>
    `;
    return;
  }
  $("rulesContent").innerHTML = `
    <p>
      Dans ce jeu, vous êtes une entreprise, la <strong>firme 1</strong>, en concurrence avec une autre entreprise,
      la <strong>firme 2</strong>. Vous produisez toutes les deux un même bien homogène que vous vendez sur un marché commun.
      Votre objectif est de <strong>maximiser votre profit</strong>.
    </p>
    <p>La quantité totale mise sur le marché est la somme des quantités produites par les deux firmes :</p>
    <p class="formula-center"><span class="formula formula-large">Q = q1 + q2</span></p>
    <p>Le prix de marché est déterminé par la fonction de demande :</p>
    <p class="formula-center"><span class="formula formula-large">P = max(0, 60 - Q/2)</span></p>
    <p>Le coût marginal de production est constant et égal à :</p>
    <p class="formula-center"><span class="formula formula-large">Cm = 20</span></p>
    <p>
      À chaque manche, vous observez la quantité choisie par votre concurrent, vous décidez de la quantité que vous
      souhaitez produire, le prix de marché est déterminé et votre profit est calculé.
    </p>
  `;
}

function renderProfitChart(canvasId, previousChart, series, chosenQ, chosenProfit, qOpp) {
  const ctx = $(canvasId).getContext("2d");
  if (previousChart) previousChart.destroy();
  return new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Fonction de profit complète",
          data: series.map((p) => ({ x: p.q, y: p.profit })),
          showLine: true,
          borderColor: "#df7a2f",
          backgroundColor: "#df7a2f",
          borderWidth: 3,
          pointRadius: 0
        },
        {
          type: "scatter",
          label: "Votre choix",
          data: [{ x: chosenQ, y: chosenProfit }],
          backgroundColor: "#18644e",
          pointRadius: 6
        }
      ]
    },
    options: {
      animation: false,
      parsing: false,
      plugins: {
        title: {
          display: true,
          text: `Fonction de profit: pi_i(q_i | q_j = ${qOpp})`
        }
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 100,
          title: { display: true, text: "Quantité q" }
        },
        y: { title: { display: true, text: "Profit" } }
      }
    }
  });
}

function renderHistory(data) {
  $("cumProfit").textContent = `Profit cumulé: ${data.cumulativeProfit}`;
  const rows = [...(data.rows || [])].reverse();
  $("historyBody").innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.level}</td>
        <td>${r.round}</td>
        <td>${r.quantity}</td>
        <td>${r.competitorQuantity}</td>
        <td>${r.price}</td>
        <td>${r.payment}</td>
        <td>${r.cumulativeProfit}</td>
      </tr>`
    )
    .join("");
}

async function refreshHistory() {
  const data = await api("/api/history");
  renderHistory(data);
}

async function refreshStates() {
  const l1 = await api("/api/level1/state");
  const l2 = await api("/api/level2/state");
  const unlocked = Boolean(l2.unlocked || student.level2Unlocked);
  const shouldShowLevel2 = l1.finished && unlocked;
  switchTab(shouldShowLevel2 ? 2 : 1);

  $("level1RoundLabel").textContent = l1.finished
    ? "Niveau 1 terminé"
    : `Round ${l1.round} / ${l1.totalRounds}`;
  $("level2RoundLabel").textContent = l2.finished
    ? "Niveau 2 terminé"
    : `Round ${l2.round} / ${l2.totalRounds}`;

  const qOpp = l1.competitorQuantity ?? "";
  $("compQInput").value = qOpp;
  $("level1Instruction").textContent = l1.finished
    ? "Niveau 1 terminé."
    : `Le concurrent a mis ${qOpp} unités sur le marché. Quelle quantité voulez-vous mettre sur le marché ?`;

  $("levelStatusText").textContent = unlocked
    ? "Niveau 2 débloqué."
    : "Niveau 1 en cours.";
  $("gameStateText").textContent = unlocked
    ? "Vous pouvez jouer au niveau 1 et au niveau 2."
    : "Continuez le niveau 1 pour tenter de débloquer le niveau 2.";
  if (unlocked && currentLevelTab === 2) updateLevelBanner(true);
}

async function login() {
  const studentId = $("studentIdInput").value.trim();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ studentId })
    });
    token = data.token;
    student = data.student;
    localStorage.setItem("cournotToken", token);
    setLoggedInUI();
    await refreshStates();
    await refreshHistory();
  } catch (e) {
    $("loginError").textContent = e.message;
  }
}

async function bootstrapSession() {
  if (!token) return;
  try {
    const data = await api("/api/me");
    student = data.student;
    setLoggedInUI();
    await refreshStates();
    await refreshHistory();
  } catch (_e) {
    localStorage.removeItem("cournotToken");
    token = "";
  }
}

async function playLevel1() {
  const quantity = Number($("myQ1Input").value);
  try {
    const data = await api("/api/level1/play", {
      method: "POST",
      body: JSON.stringify({ quantity })
    });
    $("l1Result").textContent = `Prix: ${data.price} | Paiement: ${data.profit} | Cm: 20`;
    l1Chart = renderProfitChart("l1Chart", l1Chart, data.profitSeries, data.quantity, data.profit, data.competitorQuantity);
    await refreshStates();
    await refreshHistory();
  } catch (e) {
    $("l1Result").textContent = e.message;
  }
}

async function pollLevel2Result(tries = 20) {
  for (let i = 0; i < tries; i++) {
    const p = await api("/api/level2/poll");
    if (p.ready) return p;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function playLevel2() {
  const quantity = Number($("myQ2Input").value);
  try {
    const data = await api("/api/level2/play", {
      method: "POST",
      body: JSON.stringify({ quantity })
    });
    if (data.waiting) {
      $("l2Status").textContent = data.message;
      const poll = await pollLevel2Result();
      if (!poll) {
        $("l2Status").textContent = "Toujours en attente. Réessayez dans quelques secondes.";
        return;
      }
      $("l2Status").textContent = "";
      $("l2Result").textContent = `Concurrent: ${poll.competitorId} | Prix: ${poll.price} | Paiement: ${poll.profit}`;
      l2Chart = renderProfitChart(
        "l2Chart",
        l2Chart,
        poll.profitSeries,
        poll.quantity,
        poll.profit,
        poll.competitorQuantity
      );
    } else {
      $("l2Status").textContent = "";
      $("l2Result").textContent = `Concurrent: ${data.competitorId} | Prix: ${data.price} | Paiement: ${data.profit}`;
      l2Chart = renderProfitChart(
        "l2Chart",
        l2Chart,
        data.profitSeries,
        data.quantity,
        data.profit,
        data.competitorQuantity
      );
    }
    await refreshStates();
    await refreshHistory();
  } catch (e) {
    $("l2Status").textContent = e.message;
  }
}

$("loginBtn").addEventListener("click", login);
$("playL1Btn").addEventListener("click", playLevel1);
$("playL2Btn").addEventListener("click", playLevel2);

bootstrapSession();
