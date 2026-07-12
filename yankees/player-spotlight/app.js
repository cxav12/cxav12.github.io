const SEASON = new Date().getFullYear();
const DEFAULT_PLAYER = 592450;
const RECENT_TABLE_GAMES = 10;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const HEADSHOT = (id) => `https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best/v1/people/${id}/headshot/67/current`;
const DETAIL_PRIMARY_ITEMS = [
  ["AVG", "avg"],
  ["HR", "homeRuns"],
  ["RBI", "rbi"],
  ["OBP", "obp"],
  ["SLG", "slg"],
  ["OPS", "ops"],
];
const DETAIL_SECONDARY_ITEMS = [
  ["AB", "atBats"],
  ["H", "hits"],
  ["2B", "doubles"],
  ["3B", "triples"],
  ["BB", "baseOnBalls"],
  ["K", "strikeOuts"],
  ["K%", "kRate"],
  ["PA", "plateAppearances"],
];
const PACE_ITEMS = [
  ["HR", "homeRuns"],
  ["RBI", "rbi"],
  ["R", "runs"],
  ["H", "hits"],
  ["2B", "doubles"],
  ["BB", "baseOnBalls"],
  ["K", "strikeOuts"],
  ["SB", "stolenBases"],
];

const state = {
  selectedPlayerId: DEFAULT_PLAYER,
  currentGroup: "hitting",
  recentWindow: 5,
  gameLogSplits: [],
  detailSplit: "season",
  detailTab: "pace",
  detailStats: {
    season: {},
    risp: {},
    "vs-lhp": {},
    "vs-rhp": {},
    home: {},
    away: {},
    career: {},
    transactions: [],
  },
  selectedPerson: null,
};

const els = {
  status: document.querySelector("#data-status"),
  headshot: document.querySelector("#player-headshot"),
  bio: document.querySelector("#player-bio"),
  name: document.querySelector("#player-name"),
  seasonLabel: document.querySelector("#season-label"),
  primaryStats: document.querySelector("#primary-stats"),
  secondaryStats: document.querySelector("#secondary-stats"),
  gameHead: document.querySelector("#game-log-head"),
  gameBody: document.querySelector("#game-log-body"),
  recentBar: document.querySelector("#recent-form-bar"),
  recentStats: document.querySelector("#recent-line-stats"),
  recentButtons: document.querySelectorAll(".recent-window-button"),
  searchInput: document.querySelector("#player-search"),
  searchButton: document.querySelector("#search-button"),
  searchResults: document.querySelector("#search-results"),
  detailHeadshot: document.querySelector("#detail-headshot"),
  detailFirstName: document.querySelector("#detail-first-name") || { textContent: "" },
  detailLastName: document.querySelector("#player-detail-title"),
  detailMeta: document.querySelector("#detail-meta") || { textContent: "" },
  detailNumber: document.querySelector("#detail-number"),
  detailBio: document.querySelector("#detail-bio"),
  detailSplitControls: document.querySelector("#detail-split-controls"),
  detailTabControls: document.querySelector("#detail-tab-controls"),
  detailPrimaryStats: document.querySelector("#detail-primary-stats"),
  detailSecondaryStats: document.querySelector("#detail-secondary-stats"),
  detailTabPanel: document.querySelector("#detail-tab-panel"),
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
  async player(id) {
    return this.get(`/people/${id}`, {
      hydrate: "currentTeam,team,education,stats(group=[hitting,pitching],type=[yearByYear])",
    });
  },
  async stats(id, group, type = "season", params = {}) {
    return this.get(`/people/${id}/stats`, { stats: type, group, season: SEASON, ...params });
  },
  async gameLog(id, group) {
    return this.stats(id, group, "gameLog");
  },
  async transactions(id) {
    return this.get("/transactions", {
      playerId: id,
      startDate: `${SEASON}-01-01`,
      endDate: isoDate(new Date()),
    });
  },
  async searchPlayer(query) {
    return this.get("/people/search", { names: query, sportId: 1 });
  },
};

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function niceDate(value) {
  if (!value) return "Unknown";
  const datePart = String(value).includes("T") ? String(value).slice(0, 10) : value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${datePart}T12:00:00`));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatAverage(hits, atBats) {
  if (!atBats) return ".000";
  return (hits / atBats).toFixed(3).replace(/^0/, "");
}

function inningsToOuts(value) {
  if (!value) return 0;
  const [whole, partial = "0"] = String(value).split(".");
  return Number(whole) * 3 + Number(partial);
}

function outsToInnings(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.style.color = tone === "error" ? "#ffbec4" : tone === "good" ? "#9af0c8" : "";
}

function statValue(stats, key, fallback = "-") {
  const value = stats?.[key];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function renderStats(target, stats, items) {
  target.replaceChildren();
  const template = document.querySelector("#stat-template");
  items.forEach(([label, key]) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("strong").textContent = statValue(stats, key);
    node.querySelector("span").textContent = label;
    target.append(node);
  });
}

function firstStatSplit(data) {
  return data?.stats?.[0]?.splits?.[0]?.stat || {};
}

function homeAwayStat(data, key) {
  const splits = data?.stats?.[0]?.splits || [];
  const match = splits.find((split) => {
    if (key === "home" && split.isHome === true) return true;
    if (key === "away" && split.isHome === false) return true;
    const label = normalizeText(split.homeAway || split.split?.name || split.split?.value || split.split);
    return label === key;
  });
  return match?.stat || {};
}

async function splitStat(id, sitCodes) {
  for (const code of sitCodes) {
    const data = await api.stats(id, "hitting", "statSplits", { sitCodes: code }).catch(() => null);
    const stat = firstStatSplit(data);
    if (Object.keys(stat).length) return stat;
  }
  return {};
}

function kRate(stats) {
  const strikeouts = Number(stats?.strikeOuts || 0);
  const plateAppearances = Number(stats?.plateAppearances || 0);
  return plateAppearances ? `${((strikeouts / plateAppearances) * 100).toFixed(1)}%` : "-";
}

function detailStatValue(stats, key) {
  if (key === "kRate") return kRate(stats);
  return statValue(stats, key);
}

function playerNameParts(fullName) {
  return { first: "", last: String(fullName || "Player Detail").trim() };
}

function renderDetailHeader(person) {
  const { first, last } = playerNameParts(person.fullName);
  els.detailHeadshot.src = HEADSHOT(person.id);
  els.detailHeadshot.alt = `${person.fullName} headshot`;
  els.detailHeadshot.onerror = () => {
    els.detailHeadshot.removeAttribute("src");
    els.detailHeadshot.alt = "";
  };
  els.detailFirstName.textContent = first;
  els.detailLastName.textContent = last;
  els.detailNumber.textContent = person.primaryNumber || "--";
  els.detailMeta.textContent = [
    playerPosition(person),
    `${person.batSide?.code || "-"} / ${person.pitchHand?.code || "-"}`,
    person.height || "-",
    person.weight ? `${person.weight} lbs` : "-",
    `Age ${person.currentAge || "-"}`,
  ].join(" · ");
}

function setActiveButtons(container, dataName, activeValue) {
  container?.querySelectorAll(`[data-${dataName}]`).forEach((button) => {
    const active = button.dataset[dataName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === activeValue;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function detailStatCard(label, value, featured = false) {
  const card = document.createElement("article");
  card.className = `detail-stat-card${featured ? " featured" : ""}`;
  card.innerHTML = `<span>${label}</span><strong class="stat-number">${value}</strong>`;
  return card;
}

function renderDetailStats() {
  const stats = state.detailStats[state.detailSplit] || {};
  els.detailPrimaryStats.replaceChildren();
  els.detailSecondaryStats.replaceChildren();
  DETAIL_PRIMARY_ITEMS.forEach(([label, key]) => {
    els.detailPrimaryStats.append(detailStatCard(label, detailStatValue(stats, key), true));
  });
  DETAIL_SECONDARY_ITEMS.forEach(([label, key]) => {
    els.detailSecondaryStats.append(detailStatCard(label, detailStatValue(stats, key)));
  });
}

function paceValue(stats, key) {
  const gamesPlayed = Number(stats?.gamesPlayed || 0);
  const value = Number(stats?.[key] || 0);
  return gamesPlayed ? Math.round((value / gamesPlayed) * 152) : "-";
}

function renderPaceTab() {
  const stats = state.detailStats.season || {};
  const gamesPlayed = statValue(stats, "gamesPlayed");
  const paceCards = PACE_ITEMS.map(([label, key]) => detailStatCard(label, paceValue(stats, key)));
  els.detailTabPanel.replaceChildren();
  const intro = document.createElement("p");
  intro.className = "detail-tab-note";
  intro.textContent = `${gamesPlayed} games played. Counting stats are paced across a 152-game season.`;
  const grid = document.createElement("div");
  grid.className = "detail-tab-grid";
  grid.append(...paceCards);
  els.detailTabPanel.append(intro, grid);
}

function renderRecentActionTab() {
  const games = state.gameLogSplits.slice(-5).reverse();
  els.detailTabPanel.replaceChildren();
  if (!games.length) {
    els.detailTabPanel.innerHTML = `<p class="empty">No recent game rows are available for this player yet.</p>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "detail-table";
  const headers = state.currentGroup === "pitching"
    ? ["Date", "Opp", "IP", "ER", "K", "BB"]
    : ["Date", "Opp", "H-AB", "HR", "RBI", "R"];
  table.innerHTML = `<thead><tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr></thead>`;
  const body = document.createElement("tbody");
  games.forEach((split) => {
    const stat = split.stat || {};
    const values = state.currentGroup === "pitching"
      ? [niceDate(split.date), split.opponent?.abbreviation || split.opponent?.name || "-", stat.inningsPitched, stat.earnedRuns, stat.strikeOuts, stat.baseOnBalls]
      : [niceDate(split.date), split.opponent?.abbreviation || split.opponent?.name || "-", `${stat.hits || 0}-${stat.atBats || 0}`, stat.homeRuns, stat.rbi, stat.runs];
    const row = document.createElement("tr");
    row.innerHTML = values.map((value, index) => `<td data-label="${headers[index]}">${value ?? "-"}</td>`).join("");
    body.append(row);
  });
  table.append(body);
  els.detailTabPanel.append(table);
}

function relevantTransactions(transactions) {
  const keywords = ["recall", "selected", "option", "injured", "il", "activated", "reinstated", "call"];
  const filtered = transactions.filter((transaction) => {
    const text = normalizeText(`${transaction.typeDesc || ""} ${transaction.description || ""}`);
    return keywords.some((keyword) => text.includes(keyword));
  });
  return (filtered.length ? filtered : transactions)
    .slice()
    .sort((a, b) => new Date(b.effectiveDate || b.date || 0) - new Date(a.effectiveDate || a.date || 0));
}

function renderSeasonLogTab() {
  const transactions = relevantTransactions(state.detailStats.transactions || []).slice(0, 8);
  els.detailTabPanel.replaceChildren();
  if (!transactions.length) {
    els.detailTabPanel.innerHTML = `<p class="empty">No call-up, option, or IL notes are available for this season.</p>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "detail-log-list";
  transactions.forEach((transaction) => {
    const row = document.createElement("article");
    row.className = "detail-log-row";
    row.innerHTML = `
      <time>${niceDate(transaction.effectiveDate || transaction.date)}</time>
      <strong>${transaction.typeDesc || "Transaction"}</strong>
      <span>${transaction.description || "No transaction description available."}</span>
    `;
    list.append(row);
  });
  els.detailTabPanel.append(list);
}

function renderCareerTab() {
  const stats = state.detailStats.career || {};
  els.detailTabPanel.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "detail-tab-grid";
  [...DETAIL_PRIMARY_ITEMS, ...DETAIL_SECONDARY_ITEMS].forEach(([label, key], index) => {
    grid.append(detailStatCard(label, detailStatValue(stats, key), index < DETAIL_PRIMARY_ITEMS.length));
  });
  els.detailTabPanel.append(grid);
}

function renderDetailTab() {
  if (state.detailTab === "recent") renderRecentActionTab();
  else if (state.detailTab === "season-log") renderSeasonLogTab();
  else if (state.detailTab === "career") renderCareerTab();
  else renderPaceTab();
}

function renderDetailLoading() {
  els.detailPrimaryStats.innerHTML = `<p class="empty">Loading player detail stats...</p>`;
  els.detailSecondaryStats.replaceChildren();
  els.detailTabPanel.innerHTML = `<p class="empty">Loading player detail tabs...</p>`;
}

function renderDetail() {
  setActiveButtons(els.detailSplitControls, "detail-split", state.detailSplit);
  setActiveButtons(els.detailTabControls, "detail-tab", state.detailTab);
  renderDetailStats();
  renderDetailTab();
}

async function loadDetailData(id, seasonStats) {
  const [careerData, homeAwayData, risp, vsLhp, vsRhp, transactionsData] = await Promise.all([
    api.stats(id, "hitting", "career").catch(() => ({ stats: [] })),
    api.stats(id, "hitting", "homeAndAway").catch(() => ({ stats: [] })),
    splitStat(id, ["risp", "risp2out"]).catch(() => ({})),
    splitStat(id, ["vl", "vsl", "vsLHP"]).catch(() => ({})),
    splitStat(id, ["vr", "vsr", "vsRHP"]).catch(() => ({})),
    api.transactions(id).catch(() => ({ transactions: [] })),
  ]);

  state.detailStats = {
    season: seasonStats || {},
    risp,
    "vs-lhp": vsLhp,
    "vs-rhp": vsRhp,
    home: homeAwayStat(homeAwayData, "home"),
    away: homeAwayStat(homeAwayData, "away"),
    career: firstStatSplit(careerData),
    transactions: transactionsData.transactions || [],
  };
}

function playerPosition(person) {
  return person.primaryPosition?.abbreviation || person.primaryPosition?.name || "Player";
}

function ageWithDays(person) {
  if (!person.birthDate) return `${person.currentAge || "-"} years old`;
  const today = new Date();
  const birth = new Date(`${person.birthDate}T12:00:00`);
  let years = today.getFullYear() - birth.getFullYear();
  let lastBirthday = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (today < lastBirthday) {
    years -= 1;
    lastBirthday = new Date(today.getFullYear() - 1, birth.getMonth(), birth.getDate());
  }
  const days = Math.max(0, Math.floor((today - lastBirthday) / 86400000));
  return `${years} years, ${days} days old`;
}

function draftLabel(person) {
  const year = person.draftYear || person.draft?.year;
  const round = person.draftRound || person.draftRoundNumber || person.draft?.round;
  const pick = person.draftPick || person.pickNumber || person.draftNumber || person.draft?.pickNumber;
  const team = person.draftTeam?.name || person.draftedBy?.name || person.draft?.team?.name;
  if (!year && !round && !pick && !team) return "Details unavailable";

  const parts = [];
  if (round) parts.push(`Round ${round}`);
  if (pick) parts.push(`Pick ${pick}`);
  const base = parts.length ? parts.join(", ") : "Drafted";
  const teamText = team ? ` by ${team}` : "";
  const yearText = year ? ` (${year})` : "";
  return `${base}${teamText}${yearText}`;
}

function detailBioRows(person) {
  return [
    ["Age", ageWithDays(person)],
    ["Size", `${person.height || "-"} / ${person.weight ? `${person.weight} lbs` : "-"}`],
    ["B/T", `${person.batSide?.code || "-"} / ${person.pitchHand?.code || "-"}`],
    ["Born", person.birthCity && person.birthStateProvince ? `${person.birthCity}, ${person.birthStateProvince}` : person.birthCountry || "Birthplace unavailable"],
    ["Draft", draftLabel(person)],
  ];
}

function renderDetailBio(person) {
  els.detailBio.replaceChildren();
  detailBioRows(person).forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "detail-bio-row";
    row.innerHTML = `<span>${label}</span><span>${value}</span>`;
    els.detailBio.append(row);
  });
}

function bioRows(person) {
  return [
    ["No.", `${person.primaryNumber ? `#${person.primaryNumber}` : "No number"} ${playerPosition(person)}`],
    ["Age", ageWithDays(person)],
    ["Size", `${person.height || "-"} / ${person.weight ? `${person.weight} lbs` : "-"}`],
    ["B/T", `${person.batSide?.code || "-"} / ${person.pitchHand?.code || "-"}`],
    ["Born", person.birthCity && person.birthStateProvince ? `${person.birthCity}, ${person.birthStateProvince}` : person.birthCountry || "Birthplace unavailable"],
    ["Debut", person.mlbDebutDate ? niceDate(person.mlbDebutDate) : "Unavailable"],
    ["Draft", draftLabel(person)],
  ];
}

function renderBio(person) {
  els.bio.replaceChildren();
  bioRows(person).forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "bio-row";
    row.innerHTML = `<span>${label}</span><span>${value}</span>`;
    els.bio.append(row);
  });
}

function chooseGroup(person, hittingStats, pitchingStats) {
  const position = playerPosition(person);
  if (position === "P" || Number(statValue(pitchingStats, "gamesPlayed", 0)) > Number(statValue(hittingStats, "gamesPlayed", 0))) {
    return "pitching";
  }
  return "hitting";
}

async function loadPlayer(id) {
  state.selectedPlayerId = id;
  setStatus("Loading player data");
  try {
    const [profile, hitting, pitching] = await Promise.all([
      api.player(id),
      api.stats(id, "hitting").catch(() => ({ stats: [] })),
      api.stats(id, "pitching").catch(() => ({ stats: [] })),
    ]);
    const person = profile.people?.[0];
    if (!person) throw new Error("Player not found");
    const hittingStats = hitting.stats?.[0]?.splits?.[0]?.stat || {};
    const pitchingStats = pitching.stats?.[0]?.splits?.[0]?.stat || {};
    state.currentGroup = chooseGroup(person, hittingStats, pitchingStats);
    state.selectedPerson = person;
    state.detailSplit = "season";
    state.detailTab = "pace";
    const activeStats = state.currentGroup === "pitching" ? pitchingStats : hittingStats;

    renderPlayerHeader(person);
    renderDetailHeader(person);
    renderDetailBio(person);
    renderStatBlocks(activeStats, state.currentGroup);
    renderDetailLoading();
    await Promise.all([
      renderGameLog(id, state.currentGroup),
      loadDetailData(id, hittingStats),
    ]);
    renderDetail();
    setStatus("Live MLB data", "good");
  } catch (error) {
    setStatus("Data connection issue", "error");
    els.primaryStats.innerHTML = `<p class="error">Could not load this player from MLB data. ${error.message}</p>`;
    els.detailTabPanel.innerHTML = `<p class="error">Could not load the player detail preview.</p>`;
  }
}

function renderPlayerHeader(person) {
  els.headshot.src = HEADSHOT(person.id);
  els.headshot.alt = `${person.fullName} headshot`;
  els.headshot.onerror = () => {
    els.headshot.removeAttribute("src");
    els.headshot.alt = "";
  };
  els.name.textContent = person.fullName;
  els.name.href = `https://baseballsavant.mlb.com/savant-player/${person.id}`;
  els.seasonLabel.textContent = `${SEASON} Season - ${state.currentGroup}`;
  renderBio(person);
}

function renderStatBlocks(stats, group) {
  if (group === "pitching") {
    renderStats(els.primaryStats, stats, [
      ["ERA", "era"],
      ["W", "wins"],
      ["SO", "strikeOuts"],
      ["WHIP", "whip"],
    ]);
    renderStats(els.secondaryStats, stats, [
      ["G", "gamesPlayed"],
      ["GS", "gamesStarted"],
      ["IP", "inningsPitched"],
      ["BB", "baseOnBalls"],
      ["HR", "homeRuns"],
      ["AVG", "avg"],
      ["SV", "saves"],
    ]);
    return;
  }
  renderStats(els.primaryStats, stats, [
    ["AVG", "avg"],
    ["HR", "homeRuns"],
    ["RBI", "rbi"],
    ["OPS", "ops"],
  ]);
  renderStats(els.secondaryStats, stats, [
    ["OBP", "obp"],
    ["BB", "baseOnBalls"],
    ["2B", "doubles"],
    ["3B", "triples"],
    ["SB", "stolenBases"],
    ["K", "strikeOuts"],
    ["R", "runs"],
  ]);
}

async function renderGameLog(id, group) {
  const data = await api.gameLog(id, group).catch(() => ({ stats: [] }));
  state.gameLogSplits = data.stats?.[0]?.splits?.slice(-30) || [];
  const splits = state.gameLogSplits.slice(-RECENT_TABLE_GAMES).reverse();
  const headers = group === "pitching" ? ["Date", "Opponent", "IP", "ER", "SO", "BB", "Result"] : ["Date", "Opponent", "H-AB", "HR", "RBI", "R", "BB"];
  els.gameHead.innerHTML = `<tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr>`;
  els.gameBody.replaceChildren();
  renderRecentBar();

  if (!splits.length) {
    els.gameBody.innerHTML = `<tr><td colspan="${headers.length}" class="empty">No game log rows are available for this player yet.</td></tr>`;
    return;
  }

  splits.forEach((split) => {
    const stat = split.stat || {};
    const opponent = split.opponent?.name || "Opponent";
    const values = group === "pitching"
      ? [niceDate(split.date), opponent, stat.inningsPitched, stat.earnedRuns, stat.strikeOuts, stat.baseOnBalls, stat.decision || "-"]
      : [niceDate(split.date), opponent, `${stat.hits || 0}-${stat.atBats || 0}`, stat.homeRuns, stat.rbi, stat.runs, stat.baseOnBalls];
    const row = document.createElement("tr");
    row.innerHTML = values.map((value, index) => `<td data-label="${headers[index]}">${value ?? "-"}</td>`).join("");
    els.gameBody.append(row);
  });
}

function renderRecentBar() {
  const games = state.gameLogSplits.slice(-state.recentWindow);
  if (!games.length) {
    els.recentStats.textContent = "No recent games found";
    return;
  }

  if (state.currentGroup === "pitching") {
    const totals = games.reduce((acc, split) => {
      const stat = split.stat || {};
      acc.outs += inningsToOuts(stat.inningsPitched);
      acc.er += Number(stat.earnedRuns || 0);
      acc.so += Number(stat.strikeOuts || 0);
      acc.bb += Number(stat.baseOnBalls || 0);
      return acc;
    }, { outs: 0, er: 0, so: 0, bb: 0 });
    const era = totals.outs ? ((totals.er * 27) / totals.outs).toFixed(2) : "-";
    els.recentStats.innerHTML = `${era} ERA <span>&middot;</span> ${outsToInnings(totals.outs)} IP <span>&middot;</span> ${totals.so} K <span>&middot;</span> ${totals.bb} BB <span>&middot;</span> ${totals.er} ER`;
    return;
  }

  const totals = games.reduce((acc, split) => {
    const stat = split.stat || {};
    acc.ab += Number(stat.atBats || 0);
    acc.hits += Number(stat.hits || 0);
    acc.hr += Number(stat.homeRuns || 0);
    acc.rbi += Number(stat.rbi || 0);
    acc.runs += Number(stat.runs || 0);
    return acc;
  }, { ab: 0, hits: 0, hr: 0, rbi: 0, runs: 0 });
  els.recentStats.innerHTML = `${formatAverage(totals.hits, totals.ab)} AVG <span>&middot;</span> ${totals.hr} HR <span>&middot;</span> ${totals.rbi} RBI <span>&middot;</span> ${totals.runs} R <span>&middot;</span> ${totals.hits}-${totals.ab} H-AB`;
}

function setRecentWindow(games) {
  state.recentWindow = games;
  els.recentButtons.forEach((button) => {
    const active = Number(button.dataset.games) === games;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderRecentBar();
}

function bestDirectMatch(query, people) {
  const normalized = normalizeText(query);
  const exact = people.find((person) => normalizeText(person.fullName) === normalized);
  if (exact) return exact;
  const lastNameMatches = people.filter((person) => normalizeText(person.lastName) === normalized);
  if (lastNameMatches.length === 1) return lastNameMatches[0];
  return null;
}

async function searchPlayers(options = {}) {
  const query = els.searchInput.value.trim();
  if (!query) return;
  els.searchResults.hidden = false;
  els.searchResults.innerHTML = `<p class="empty">Searching players...</p>`;
  try {
    const data = await api.searchPlayer(query);
    const people = (data.people || []).slice(0, 12);
    if (!people.length) {
      els.searchResults.innerHTML = `<p class="empty">No players found for "${query}".</p>`;
      els.searchInput.value = "";
      return;
    }

    const directMatch = options.direct ? bestDirectMatch(query, people) : null;
    if (directMatch) {
      els.searchResults.hidden = true;
      els.searchInput.value = "";
      await loadPlayer(directMatch.id);
      return;
    }

    els.searchResults.replaceChildren();
    people.forEach((person) => {
      const shell = document.createElement("div");
      shell.className = "col-12 col-md-6 result-shell";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-button";
      button.innerHTML = `<span>${person.fullName}</span><small>${person.primaryPosition?.abbreviation || "Player"} - ${person.currentTeam?.name || "MLB"}</small>`;
      button.addEventListener("click", () => {
        els.searchResults.hidden = true;
        els.searchInput.value = "";
        loadPlayer(person.id);
      });
      shell.append(button);
      els.searchResults.append(shell);
    });
    els.searchInput.value = "";
  } catch (error) {
    els.searchResults.innerHTML = `<p class="error">Search is unavailable right now.</p>`;
  }
}

function bindEvents() {
  els.searchButton.addEventListener("click", () => searchPlayers());
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlayers({ direct: true });
    }
  });
  els.recentButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
    button.addEventListener("click", () => setRecentWindow(Number(button.dataset.games)));
  });
  els.detailSplitControls?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail-split]");
    if (!button) return;
    state.detailSplit = button.dataset.detailSplit;
    renderDetail();
  });
  els.detailTabControls?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail-tab]");
    if (!button) return;
    state.detailTab = button.dataset.detailTab;
    renderDetail();
  });
}

async function init() {
  bindEvents();
  const requestedPlayer = Number(new URLSearchParams(window.location.search).get("player"));
  await loadPlayer(Number.isFinite(requestedPlayer) && requestedPlayer > 0 ? requestedPlayer : DEFAULT_PLAYER);
}

init();
