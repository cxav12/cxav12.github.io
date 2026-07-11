const TEAM_ID = 147;
const SEASON = new Date().getFullYear();
const MLB_API = "https://statsapi.mlb.com/api/v1";

const metricConfig = [
  { key: "runs", label: "Runs Scored", badge: "RS", group: "hitting", rank: "desc" },
  { key: "runsAllowed", label: "Runs Allowed", badge: "RA", group: "pitching", rank: "asc" },
  { key: "avg", label: "Team AVG", badge: "AVG", group: "hitting", rank: "desc" },
  { key: "ops", label: "Team OPS", badge: "OPS", group: "hitting", rank: "desc" },
  { key: "obp", label: "OBP", badge: "OBP", group: "hitting", rank: "desc" },
  { key: "homeRuns", label: "Home Runs", badge: "HR", group: "hitting", rank: "desc" },
  { key: "era", label: "Team ERA", badge: "ERA", group: "pitching", rank: "asc" },
];

const els = {
  status: document.querySelector("#data-status"),
  viewTitle: document.querySelector("#view-title"),
  yankeesCard: document.querySelector("#yankees-card"),
  standingsContext: document.querySelector("#standings-context"),
  standingsModeControls: document.querySelector("#standings-mode-controls"),
  standingsFilterControls: document.querySelector("#standings-filter-controls"),
  standingsBody: document.querySelector("#standings-body"),
};

const state = {
  teams: [],
  teamMap: new Map(),
  standings: new Map(),
  standingsRecords: [],
  hitting: new Map(),
  pitching: new Map(),
  ranks: new Map(),
  standingsView: {
    mode: "division",
    filter: "American League East",
  },
};

const api = {
  async get(path, params = {}) {
    const url = new URL(`${MLB_API}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MLB API returned ${response.status}`);
    return response.json();
  },
  teams() {
    return this.get("/teams", { sportId: 1, season: SEASON });
  },
  stats(group) {
    return this.get("/teams/stats", { stats: "season", group, sportIds: 1, season: SEASON });
  },
  standings() {
    return this.get("/standings", { leagueId: "103,104", season: SEASON, standingsTypes: "regularSeason" });
  },
};

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.style.color = tone === "error" ? "#ffbec4" : tone === "good" ? "#9af0c8" : "";
}

function ordinal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th";
  return `${number}${suffix}`;
}

function statNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatStat(key, value) {
  if (value === undefined || value === null || value === "") return "-";
  if (["avg", "ops", "obp"].includes(key)) return String(value).replace(/^0/, "");
  return String(value);
}

function storeStats(group, data) {
  const target = group === "hitting" ? state.hitting : state.pitching;
  const splits = data.stats?.[0]?.splits || [];
  splits.forEach((split) => {
    target.set(split.team.id, split.stat || {});
  });
}

function storeStandings(data) {
  const records = [];
  (data.records || []).forEach((division) => {
    (division.teamRecords || []).forEach((record) => {
      const teamId = record.team?.id;
      if (!teamId) return;
      const team = state.teamMap.get(teamId);
      const leagueName = division.league?.name || team?.league?.name || "";
      const divisionName = division.division?.name || team?.division?.name || "";
      const wins = record.leagueRecord?.wins ?? record.wins ?? "-";
      const losses = record.leagueRecord?.losses ?? record.losses ?? "-";
      const item = {
        teamId,
        teamName: record.team?.name || team?.name || "Team",
        abbreviation: team?.abbreviation || "",
        wins,
        losses,
        pct: record.leagueRecord?.pct || record.winningPercentage || "-",
        divisionGamesBack: record.divisionGamesBack ?? record.gamesBack ?? "-",
        leagueGamesBack: record.leagueGamesBack ?? record.gamesBack ?? "-",
        sportGamesBack: record.sportGamesBack ?? record.leagueGamesBack ?? record.gamesBack ?? "-",
        divisionRank: Number(record.divisionRank),
        leagueRank: Number(record.leagueRank),
        sportRank: Number(record.sportRank),
        divisionId: division.division?.id || team?.division?.id || "",
        divisionName,
        leagueId: division.league?.id || team?.league?.id || "",
        leagueName,
      };
      records.push(item);
      state.standings.set(teamId, {
        wins,
        losses,
        divisionRank: item.divisionRank,
        divisionName,
      });
    });
  });
  state.standingsRecords = records;
}

function metricValue(teamId, metric) {
  const stats = metric.group === "hitting" ? state.hitting.get(teamId) : state.pitching.get(teamId);
  if (metric.key === "runsAllowed") return stats?.runs;
  return stats?.[metric.key];
}

function calculateRanks() {
  metricConfig.forEach((metric) => {
    const ranked = state.teams
      .map((team) => ({ teamId: team.id, value: statNumber(metricValue(team.id, metric)) }))
      .filter((item) => item.value !== null)
      .sort((a, b) => metric.rank === "asc" ? a.value - b.value : b.value - a.value);

    const ranks = new Map();
    ranked.forEach((item, index) => {
      ranks.set(item.teamId, index + 1);
    });
    state.ranks.set(metric.key, ranks);
  });
}

function divisionShortName(name) {
  return name
    .replace("American League", "AL")
    .replace("National League", "NL");
}

function leagueShortName(name) {
  if (name.includes("American")) return "American League";
  if (name.includes("National")) return "National League";
  return name || "League";
}

function leagueOrder(name) {
  return name.includes("American") ? 0 : name.includes("National") ? 1 : 2;
}

function divisionOrder(name) {
  const normalized = divisionShortName(name);
  const order = ["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"];
  const index = order.indexOf(normalized);
  return index === -1 ? order.length : index;
}

function rankValue(record, mode) {
  if (mode === "division") return record.divisionRank;
  if (mode === "league") return record.leagueRank;
  return record.sportRank;
}

function gamesBackValue(record, mode) {
  if (mode === "division") return record.divisionGamesBack;
  if (mode === "league") return record.leagueGamesBack;
  return record.sportGamesBack;
}

function standingsFallbackSort(a, b) {
  const pct = Number(b.pct) - Number(a.pct);
  if (Number.isFinite(pct) && pct !== 0) return pct;
  const wins = Number(b.wins) - Number(a.wins);
  if (Number.isFinite(wins) && wins !== 0) return wins;
  return Number(a.losses) - Number(b.losses);
}

function sortStandings(records, mode) {
  return [...records].sort((a, b) => {
    const aRank = rankValue(a, mode);
    const bRank = rankValue(b, mode);
    if (Number.isFinite(aRank) && Number.isFinite(bRank)) return aRank - bRank;
    return standingsFallbackSort(a, b);
  });
}

function uniqueOptions(key, labeler, sorter) {
  const options = new Map();
  state.standingsRecords.forEach((record) => {
    if (!record[key]) return;
    options.set(record[key], labeler(record[key]));
  });
  return [...options.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort(sorter);
}

function divisionOptions() {
  return uniqueOptions(
    "divisionName",
    divisionShortName,
    (a, b) => divisionOrder(a.value) - divisionOrder(b.value),
  );
}

function leagueOptions() {
  return uniqueOptions(
    "leagueName",
    leagueShortName,
    (a, b) => leagueOrder(a.value) - leagueOrder(b.value),
  );
}

function currentStandingsLabel() {
  const { mode, filter } = state.standingsView;
  if (mode === "division") return divisionShortName(filter);
  if (mode === "league") return leagueShortName(filter);
  return "MLB";
}

function filteredStandings() {
  const { mode, filter } = state.standingsView;
  if (mode === "division") {
    return sortStandings(state.standingsRecords.filter((record) => record.divisionName === filter), mode);
  }
  if (mode === "league") {
    return sortStandings(state.standingsRecords.filter((record) => record.leagueName === filter), mode);
  }
  return sortStandings(state.standingsRecords, mode);
}

function standingsButton(label, value, active) {
  const button = document.createElement("button");
  button.className = `standings-option${active ? " active" : ""}`;
  button.type = "button";
  button.dataset.standingsFilter = value;
  button.textContent = label;
  return button;
}

function setStandingsMode(mode) {
  state.standingsView.mode = mode;
  if (mode === "division") {
    const yankeesStanding = state.standings.get(TEAM_ID);
    state.standingsView.filter = yankeesStanding?.divisionName || divisionOptions()[0]?.value || "";
  } else if (mode === "league") {
    state.standingsView.filter = leagueOptions()[0]?.value || "";
  } else {
    state.standingsView.filter = "MLB";
  }
  renderStandings();
}

function setStandingsFilter(filter) {
  state.standingsView.filter = filter;
  renderStandings();
}

function renderStandingsFilters() {
  els.standingsFilterControls.replaceChildren();
  if (state.standingsView.mode === "mlb") {
    els.standingsFilterControls.hidden = true;
    return;
  }

  els.standingsFilterControls.hidden = false;
  const options = state.standingsView.mode === "division" ? divisionOptions() : leagueOptions();
  options.forEach((option) => {
    els.standingsFilterControls.append(standingsButton(option.label, option.value, option.value === state.standingsView.filter));
  });
}

function renderStandingsRows() {
  const records = filteredStandings();
  els.standingsBody.replaceChildren();

  if (!records.length) {
    els.standingsBody.innerHTML = `<tr><td colspan="6">Standings unavailable</td></tr>`;
    return;
  }

  records.forEach((record, index) => {
    const row = document.createElement("tr");
    if (record.teamId === TEAM_ID) row.classList.add("is-yankees");
    const rank = Number.isFinite(rankValue(record, state.standingsView.mode)) ? rankValue(record, state.standingsView.mode) : index + 1;
    row.innerHTML = `
      <td data-label="Rank">${rank}</td>
      <td data-label="Team"><span>${record.teamName}</span></td>
      <td data-label="W">${record.wins}</td>
      <td data-label="L">${record.losses}</td>
      <td data-label="PCT">${record.pct}</td>
      <td data-label="GB">${gamesBackValue(record, state.standingsView.mode) ?? "-"}</td>
    `;
    els.standingsBody.append(row);
  });
}

function renderStandings() {
  els.standingsContext.textContent = currentStandingsLabel();
  els.standingsModeControls.querySelectorAll("[data-standings-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.standingsMode === state.standingsView.mode);
  });
  renderStandingsFilters();
  renderStandingsRows();
}

function teamOverview(teamId) {
  const team = state.teamMap.get(teamId);
  const standing = state.standings.get(teamId) || {};
  const divisionName = standing.divisionName || team?.division?.name || "";
  return {
    team,
    standing,
    record: `${standing.wins ?? "-"}-${standing.losses ?? "-"}`,
    standingLine: standing.divisionRank ? `${ordinal(standing.divisionRank)} in ${divisionShortName(divisionName)}` : "Standing unavailable",
  };
}

function renderMetric(teamId, metric) {
  const template = document.querySelector("#metric-template");
  const node = template.content.firstElementChild.cloneNode(true);
  const value = metricValue(teamId, metric);
  const rank = state.ranks.get(metric.key)?.get(teamId);
  node.querySelector(".metric-badge").textContent = metric.badge;
  node.querySelector("strong").textContent = metric.label;
  node.querySelector(".metric-value span").textContent = formatStat(metric.key, value);
  node.querySelector(".metric-value small").textContent = rank ? ordinal(rank) : "-";
  return node;
}

function renderCard(target, teamId) {
  const overview = teamOverview(teamId);
  if (!overview.team) {
    target.innerHTML = `<p class="error mb-0">Team data is unavailable.</p>`;
    return;
  }

  target.replaceChildren();
  const header = document.createElement("header");
  header.className = "team-header";
  header.innerHTML = `
    <p class="panel-kicker mb-2">${overview.team.league?.abbreviation || "MLB"} · ${overview.team.division?.name || "Division"}</p>
    <h3 class="team-name">${overview.team.name}</h3>
    <div class="record-line mt-3">${overview.record}</div>
    <div class="standing-line">${overview.standingLine}</div>
  `;

  const list = document.createElement("section");
  list.className = "metric-list";
  metricConfig.forEach((metric) => list.append(renderMetric(teamId, metric)));

  target.append(header, list);
}

function bindEvents() {
  els.standingsModeControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-standings-mode]");
    if (button) setStandingsMode(button.dataset.standingsMode);
  });

  els.standingsFilterControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-standings-filter]");
    if (button) setStandingsFilter(button.dataset.standingsFilter);
  });
}

async function init() {
  bindEvents();
  setStatus("Loading team data");
  try {
    const [teams, hitting, pitching, standings] = await Promise.all([
      api.teams(),
      api.stats("hitting"),
      api.stats("pitching"),
      api.standings(),
    ]);

    state.teams = (teams.teams || []).filter((team) => team.active);
    state.teams.forEach((team) => state.teamMap.set(team.id, team));
    storeStats("hitting", hitting);
    storeStats("pitching", pitching);
    storeStandings(standings);
    calculateRanks();
    state.standingsView.filter = state.standings.get(TEAM_ID)?.divisionName || divisionOptions()[0]?.value || state.standingsView.filter;

    renderCard(els.yankeesCard, TEAM_ID);
    renderStandings();
    setStatus("Live MLB data", "good");
  } catch (error) {
    setStatus("Data connection issue", "error");
    els.yankeesCard.innerHTML = `<p class="error mb-0">Could not load team overview data. ${error.message}</p>`;
    els.standingsBody.innerHTML = `<tr><td colspan="6">Could not load standings.</td></tr>`;
  }
}

init();
