const SEASON = new Date().getFullYear();
const DEFAULT_PLAYER = 592450;
const RECENT_TABLE_GAMES = 10;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const HEADSHOT = (id) => `https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best/v1/people/${id}/headshot/67/current`;

const state = {
  selectedPlayerId: DEFAULT_PLAYER,
  currentGroup: "hitting",
  recentWindow: 5,
  gameLogSplits: [],
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
  async stats(id, group, type = "season") {
    return this.get(`/people/${id}/stats`, { stats: type, group, season: SEASON });
  },
  async gameLog(id, group) {
    return this.stats(id, group, "gameLog");
  },
  async searchPlayer(query) {
    return this.get("/people/search", { names: query, sportId: 1 });
  },
};

function niceDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
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
    const activeStats = state.currentGroup === "pitching" ? pitchingStats : hittingStats;

    renderPlayerHeader(person);
    renderStatBlocks(activeStats, state.currentGroup);
    await renderGameLog(id, state.currentGroup);
    setStatus("Live MLB data", "good");
  } catch (error) {
    setStatus("Data connection issue", "error");
    els.primaryStats.innerHTML = `<p class="error">Could not load this player from MLB data. ${error.message}</p>`;
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
}

async function init() {
  bindEvents();
  const requestedPlayer = Number(new URLSearchParams(window.location.search).get("player"));
  await loadPlayer(Number.isFinite(requestedPlayer) && requestedPlayer > 0 ? requestedPlayer : DEFAULT_PLAYER);
}

init();
