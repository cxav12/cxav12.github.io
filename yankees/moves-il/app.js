const TEAM_ID = 147;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const TRANSACTIONS_PER_PAGE = 5;

const state = {
  transactions: [],
  transactionPage: 1,
  activeRosterTab: "batters",
};

const els = {
  status: document.querySelector("#data-status"),
  roster: document.querySelector("#roster-list"),
  rosterTabs: document.querySelectorAll(".roster-tab"),
  rosterGroups: document.querySelectorAll(".roster-group"),
  batters: document.querySelector("#batters-list"),
  pitchers: document.querySelector("#pitchers-list"),
  rosterCount: document.querySelector("#roster-count"),
  battersCount: document.querySelector("#batters-count"),
  pitchersCount: document.querySelector("#pitchers-count"),
  activeCount: document.querySelector("#active-count"),
  transactionFeed: document.querySelector("#transaction-feed"),
  transactionPagination: document.querySelector("#transaction-pagination"),
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

function isPitcher(entry) {
  return entry.position?.abbreviation === "P" || entry.position?.code === "1";
}

function rosterCard(entry) {
  const link = document.createElement("a");
  link.className = "roster-link";
  link.href = `../player-spotlight/?player=${entry.person.id}`;
  link.innerHTML = `<span>${entry.person.fullName}</span><small>${entry.jerseyNumber ? `#${entry.jerseyNumber} - ` : ""}${entry.position?.abbreviation || "NYY"}</small>`;
  return link;
}

function renderRosterGroup(target, entries) {
  target.replaceChildren();
  if (!entries.length) {
    target.innerHTML = `<p class="empty">No players returned.</p>`;
    return;
  }
  entries.forEach((entry) => target.append(rosterCard(entry)));
}

async function renderRoster() {
  try {
    const data = await api.roster();
    const roster = (data.roster || []).slice().sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
    const pitchers = roster.filter(isPitcher);
    const batters = roster.filter((entry) => !isPitcher(entry));

    els.rosterCount.textContent = `${roster.length} active`;
    els.activeCount.textContent = roster.length;
    els.battersCount.textContent = `${batters.length}`;
    els.pitchersCount.textContent = `${pitchers.length}`;

    if (!roster.length) {
      els.batters.innerHTML = `<p class="empty">No active roster entries were returned.</p>`;
      els.pitchers.replaceChildren();
      return;
    }

    renderRosterGroup(els.batters, batters);
    renderRosterGroup(els.pitchers, pitchers);
  } catch (error) {
    els.batters.innerHTML = `<p class="error">Roster data is unavailable right now.</p>`;
    els.pitchers.replaceChildren();
    els.rosterCount.textContent = "Unavailable";
    els.battersCount.textContent = "--";
    els.pitchersCount.textContent = "--";
    els.activeCount.textContent = "--";
  }
}

function renderTransactionPage() {
  const totalPages = Math.max(1, Math.ceil(state.transactions.length / TRANSACTIONS_PER_PAGE));
  state.transactionPage = Math.min(Math.max(1, state.transactionPage), totalPages);
  const start = (state.transactionPage - 1) * TRANSACTIONS_PER_PAGE;
  const pageItems = state.transactions.slice(start, start + TRANSACTIONS_PER_PAGE);

  els.transactionFeed.replaceChildren();
  if (!pageItems.length) {
    els.transactionFeed.innerHTML = `<p class="empty">No Yankees transactions were returned for this window.</p>`;
  } else {
    pageItems.forEach((item) => {
      const article = document.createElement("article");
      const description = item.description || item.note || item.typeDesc || "Transaction";
      article.className = isIlMove(item) ? "il" : "";
      article.innerHTML = `<small>${niceDate(item.date)} - ${item.typeDesc || "Move"}</small><p>${description}</p>`;
      els.transactionFeed.append(article);
    });
  }

  renderTransactionPagination(totalPages);
}

function renderTransactionPagination(totalPages) {
  els.transactionPagination.replaceChildren();
  if (!state.transactions.length) return;

  const controls = document.createElement("div");
  controls.className = "pagination-controls";

  const prev = transactionPageButton("Previous", state.transactionPage - 1, state.transactionPage === 1);
  controls.append(prev);

  const label = document.createElement("span");
  label.className = "pagination-summary";
  label.textContent = `Page ${state.transactionPage} of ${totalPages}`;
  controls.append(label);

  const next = transactionPageButton("Next", state.transactionPage + 1, state.transactionPage === totalPages);
  controls.append(next);
  els.transactionPagination.append(controls);
}

function transactionPageButton(label, page, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pagination-button";
  button.textContent = label;
  button.disabled = disabled;
  button.dataset.page = page;
  return button;
}

async function renderTransactions() {
  try {
    const data = await api.transactions();
    const transactions = (data.transactions || []).slice().reverse();
    const ilMoves = transactions.filter(isIlMove);
    state.transactions = transactions;
    state.transactionPage = 1;
    els.ilCount.textContent = ilMoves.length;
    renderTransactionPage();

  } catch (error) {
    els.transactionFeed.innerHTML = `<p class="error">Transactions are unavailable right now.</p>`;
    els.transactionPagination.replaceChildren();
    els.ilCount.textContent = "--";
  }
}

function bindEvents() {
  els.transactionPagination.addEventListener("click", (event) => {
    const button = event.target.closest(".pagination-button");
    if (!button || button.disabled) return;
    state.transactionPage = Number(button.dataset.page);
    renderTransactionPage();
  });

  els.rosterTabs.forEach((button) => {
    button.addEventListener("click", () => setRosterTab(button.dataset.rosterTab));
  });
}

function setRosterTab(tab) {
  state.activeRosterTab = tab;
  els.rosterTabs.forEach((button) => {
    const active = button.dataset.rosterTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.rosterGroups.forEach((panel) => {
    const active = panel.id === `${tab}-panel`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

async function init() {
  bindEvents();
  setStatus("Loading roster movement");
  await Promise.all([renderRoster(), renderTransactions()]);
  setStatus("Live MLB data", "good");
}

init();
