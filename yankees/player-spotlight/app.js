const SEASON = new Date().getFullYear();
const DEFAULT_PLAYER = 592450;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const HEADSHOT = (id) => `https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best/v1/people/${id}/headshot/67/current`;

const state = {
  selectedPlayerId: DEFAULT_PLAYER,
  currentGroup: "hitting",
};

const els = {
  status: document.querySelector("#data-status"),
  headshot: document.querySelector("#player-headshot"),
  bio: document.querySelector("#player-bio"),
  meta: document.querySelector("#player-meta"),
  name: document.querySelector("#player-name"),
  savant: document.querySelector("#savant-link"),
  seasonLabel: document.querySelector("#season-label"),
  primaryStats: document.querySelector("#primary-stats"),
  secondaryStats: document.querySelector("#secondary-stats"),
  gameHead: document.querySelector("#game-log-head"),
  gameBody: document.querySelector("#game-log-body"),
  recentSummary: document.querySelector("#recent-summary"),
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

function bioRows(person) {
  return [
    ["#", `${person.primaryNumber ? `#${person.primaryNumber}` : "No number"} ${playerPosition(person)}`],
    ["⌁", `${person.currentAge || "-"} years old`],
    ["↕", `${person.height || "-"} / ${person.weight ? `${person.weight} lbs` : "-"}`],
    ["◐", `B/T: ${person.batSide?.code || "-"} / ${person.pitchHand?.code || "-"}`],
    ["⌂", person.birthCity && person.birthStateProvince ? `${person.birthCity}, ${person.birthStateProvince}` : person.birthCountry || "Birthplace unavailable"],
    ["★", person.mlbDebutDate ? `Debut: ${niceDate(person.mlbDebutDate)}` : "Debut unavailable"],
  ];
}

function renderBio(person) {
  els.bio.replaceChildren();
  bioRows(person).forEach(([icon, label]) => {
    const row = document.createElement("div");
    row.className = "bio-row";
    row.innerHTML = `<span>${icon}</span><span>${label}</span>`;
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
  els.meta.textContent = `${person.primaryNumber ? `#${person.primaryNumber}` : "Yankees"} ${playerPosition(person)}${person.currentTeam?.name ? ` · ${person.currentTeam.name}` : ""}`;
  els.name.textContent = person.fullName;
  els.seasonLabel.textContent = `${SEASON} Season · ${state.currentGroup}`;
  els.savant.href = `https://baseballsavant.mlb.com/savant-player/${person.id}`;
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
  const splits = data.stats?.[0]?.splits?.slice(-8).reverse() || [];
  const headers = group === "pitching" ? ["Date", "Opponent", "IP", "ER", "SO", "BB", "Result"] : ["Date", "Opponent", "H-AB", "HR", "RBI", "R", "BB"];
  els.gameHead.innerHTML = `<tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr>`;
  els.gameBody.replaceChildren();
  els.recentSummary.textContent = splits.length ? `${splits.length} games shown` : "No recent games found";

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

async function searchPlayers() {
  const query = els.searchInput.value.trim();
  if (!query) return;
  els.searchResults.hidden = false;
  els.searchResults.innerHTML = `<p class="empty">Searching players...</p>`;
  try {
    const data = await api.searchPlayer(query);
    const people = (data.people || []).slice(0, 8);
    if (!people.length) {
      els.searchResults.innerHTML = `<p class="empty">No players found for "${query}".</p>`;
      return;
    }
    els.searchResults.replaceChildren();
    people.forEach((person) => {
      const shell = document.createElement("div");
      shell.className = "col-12 col-md-6 result-shell";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-button";
      button.innerHTML = `<span>${person.fullName}</span><small>${person.primaryPosition?.abbreviation || "Player"} · ${person.currentTeam?.name || "MLB"}</small>`;
      button.addEventListener("click", () => {
        els.searchResults.hidden = true;
        els.searchInput.value = person.fullName;
        loadPlayer(person.id);
      });
      shell.append(button);
      els.searchResults.append(shell);
    });
  } catch (error) {
    els.searchResults.innerHTML = `<p class="error">Search is unavailable right now.</p>`;
  }
}

function bindEvents() {
  els.searchButton.addEventListener("click", searchPlayers);
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchPlayers();
  });
}

async function init() {
  bindEvents();
  const requestedPlayer = Number(new URLSearchParams(window.location.search).get("player"));
  await loadPlayer(Number.isFinite(requestedPlayer) && requestedPlayer > 0 ? requestedPlayer : DEFAULT_PLAYER);
}

init();
