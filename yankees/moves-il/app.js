const TEAM_ID = 147;
const MLB_API = "https://statsapi.mlb.com/api/v1";

const els = {
  status: document.querySelector("#data-status"),
  roster: document.querySelector("#roster-list"),
  rosterCount: document.querySelector("#roster-count"),
  activeCount: document.querySelector("#active-count"),
  transactionFeed: document.querySelector("#transaction-feed"),
  transactionWindow: document.querySelector("#transaction-window"),
  ilCount: document.querySelector("#il-count"),
};

const api = {
  async get(path, params = {}) {
    const url = new URL(`${MLB_API}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MLB API returned ${response.status}`);
    return response.json();
  },
  async roster() {
    return this.get(`/teams/${TEAM_ID}/roster`, { rosterType: "active", hydrate: "person" });
  },
  async transactions() {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 45);
    els.transactionWindow.textContent = `${niceDate(formatDate(start))} - ${niceDate(formatDate(end))}`;
    return this.get("/transactions", {
      teamId: TEAM_ID,
      startDate: formatDate(start),
      endDate: formatDate(end),
    });
  },
};

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function niceDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.style.color = tone === "error" ? "#ffbec4" : tone === "good" ? "#9af0c8" : "";
}

function isIlMove(item) {
  const description = item.description || item.note || item.typeDesc || "";
  return /injured|injury|10-day|15-day|60-day|\bIL\b|rehab|reinstated/i.test(description);
}

async function renderRoster() {
  try {
    const data = await api.roster();
    const roster = (data.roster || []).slice().sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
    els.rosterCount.textContent = `${roster.length} active`;
    els.activeCount.textContent = roster.length;
    els.roster.replaceChildren();

    if (!roster.length) {
      els.roster.innerHTML = `<p class="empty">No active roster entries were returned.</p>`;
      return;
    }

    roster.forEach((entry) => {
      const shell = document.createElement("div");
      shell.className = "col-12 col-md-6 col-xl-12 roster-shell";
      const link = document.createElement("a");
      link.className = "roster-link";
      link.href = `../player-spotlight/?player=${entry.person.id}`;
      link.innerHTML = `<span>${entry.person.fullName}</span><small>${entry.jerseyNumber ? `#${entry.jerseyNumber} - ` : ""}${entry.position?.abbreviation || "NYY"}</small>`;
      shell.append(link);
      els.roster.append(shell);
    });
  } catch (error) {
    els.roster.innerHTML = `<p class="error">Roster data is unavailable right now.</p>`;
    els.rosterCount.textContent = "Unavailable";
    els.activeCount.textContent = "--";
  }
}

async function renderTransactions() {
  try {
    const data = await api.transactions();
    const transactions = (data.transactions || []).slice().reverse();
    const ilMoves = transactions.filter(isIlMove);
    els.ilCount.textContent = ilMoves.length;
    els.transactionFeed.replaceChildren();

    if (!transactions.length) {
      els.transactionFeed.innerHTML = `<p class="empty">No Yankees transactions were returned for this window.</p>`;
      return;
    }

    transactions.slice(0, 32).forEach((item) => {
      const article = document.createElement("article");
      const description = item.description || item.note || item.typeDesc || "Transaction";
      article.className = isIlMove(item) ? "il" : "";
      article.innerHTML = `<small>${niceDate(item.date)} - ${item.typeDesc || "Move"}</small><p>${description}</p>`;
      els.transactionFeed.append(article);
    });
  } catch (error) {
    els.transactionFeed.innerHTML = `<p class="error">Transactions are unavailable right now.</p>`;
    els.ilCount.textContent = "--";
  }
}

async function init() {
  setStatus("Loading roster movement");
  await Promise.all([renderRoster(), renderTransactions()]);
  setStatus("Live MLB data", "good");
}

init();
