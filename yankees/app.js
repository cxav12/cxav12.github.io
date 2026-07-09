const TEAM_ID = 147;
const SEASON = new Date().getFullYear();
const DEFAULT_PLAYER = 592450;
const MLB_API = "https://statsapi.mlb.com/api/v1";

const els = {
  spotlight: document.querySelector("#spotlight-preview"),
  schedule: document.querySelector("#schedule-preview"),
  moves: document.querySelector("#moves-preview"),
  form: document.querySelector("#form-preview"),
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
    return this.get(`/people/${id}`);
  },
  async playerStats(id, group, type = "season") {
    return this.get(`/people/${id}/stats`, { stats: type, group, season: SEASON });
  },
  async roster() {
    return this.get(`/teams/${TEAM_ID}/roster`, { rosterType: "active", hydrate: "person" });
  },
  async schedule() {
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + 35);
    return this.get("/schedule", {
      sportId: 1,
      teamId: TEAM_ID,
      startDate: formatDate(start),
      endDate: formatDate(end),
      hydrate: "team,venue",
    });
  },
  async transactions() {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 45);
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

function niceDate(value, withYear = false) {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(`${value}T12:00:00`));
}

function timeLabel(value) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function statValue(stats, key, fallback = "-") {
  const value = stats?.[key];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function teamAbbreviation(team) {
  return team?.abbreviation || team?.teamName || team?.name || "TBD";
}

function isYankeesHome(game) {
  return game.teams?.home?.team?.id === TEAM_ID;
}

function opponent(game) {
  return isYankeesHome(game) ? game.teams?.away?.team : game.teams?.home?.team;
}

function inningsToOuts(value) {
  if (!value) return 0;
  const [whole, partial = "0"] = String(value).split(".");
  return Number(whole) * 3 + Number(partial);
}

function scoreRecentPlayer(entry, splits) {
  const position = entry.position?.abbreviation || entry.person?.primaryPosition?.abbreviation || "";
  const isPitcher = position === "P";
  const games = splits.slice(-5);
  if (!games.length) return null;

  if (isPitcher) {
    const totals = games.reduce((acc, split) => {
      const stat = split.stat || {};
      acc.outs += inningsToOuts(stat.inningsPitched);
      acc.so += Number(stat.strikeOuts || 0);
      acc.er += Number(stat.earnedRuns || 0);
      acc.bb += Number(stat.baseOnBalls || 0);
      acc.hits += Number(stat.hits || 0);
      return acc;
    }, { outs: 0, so: 0, er: 0, bb: 0, hits: 0 });
    if (totals.outs < 3) return null;
    const score = totals.outs * 0.42 + totals.so * 0.7 - totals.er * 2 - totals.bb * 0.55 - totals.hits * 0.35;
    return {
      name: entry.person.fullName,
      position,
      href: `./player-spotlight/?player=${entry.person.id}`,
      score,
      detail: `${(totals.outs / 3).toFixed(1)} IP, ${totals.so} K, ${totals.er} ER`,
    };
  }

  const totals = games.reduce((acc, split) => {
    const stat = split.stat || {};
    acc.ab += Number(stat.atBats || 0);
    acc.hits += Number(stat.hits || 0);
    acc.hr += Number(stat.homeRuns || 0);
    acc.rbi += Number(stat.rbi || 0);
    acc.runs += Number(stat.runs || 0);
    acc.bb += Number(stat.baseOnBalls || 0);
    acc.so += Number(stat.strikeOuts || 0);
    return acc;
  }, { ab: 0, hits: 0, hr: 0, rbi: 0, runs: 0, bb: 0, so: 0 });
  if (totals.ab < 6) return null;
  const average = totals.hits / Math.max(totals.ab, 1);
  const score = totals.hits * 1.5 + totals.hr * 3 + totals.rbi + totals.runs + totals.bb * 0.5 - totals.so * 0.35;
  return {
    name: entry.person.fullName,
    position,
    href: `./player-spotlight/?player=${entry.person.id}`,
    score,
    detail: `${totals.hits}-${totals.ab}, ${totals.hr} HR, ${totals.rbi} RBI`,
    average,
  };
}

function setError(target, message) {
  target.innerHTML = `<p class="preview-loading mb-0">${message}</p>`;
}

async function renderSpotlightPreview() {
  try {
    const [profile, stats] = await Promise.all([
      api.player(DEFAULT_PLAYER),
      api.playerStats(DEFAULT_PLAYER, "hitting").catch(() => ({ stats: [] })),
    ]);
    const person = profile.people?.[0];
    const season = stats.stats?.[0]?.splits?.[0]?.stat || {};
    if (!person) throw new Error("No featured player");
    els.spotlight.innerHTML = `
      <p class="preview-label mb-2">Featured Player</p>
      <a class="spotlight-mini" href="./player-spotlight/?player=${person.id}">
        <span>
          <strong>${person.fullName}</strong>
          <small>${person.primaryPosition?.abbreviation || "NYY"} - ${SEASON} snapshot</small>
        </span>
        <span class="mini-stat">${statValue(season, "homeRuns")} HR</span>
        <span class="mini-stat">${statValue(season, "ops")} OPS</span>
      </a>
    `;
  } catch (error) {
    setError(els.spotlight, "Featured player is unavailable right now.");
  }
}

async function renderSchedulePreview() {
  try {
    const data = await api.schedule();
    const games = (data.dates || []).flatMap((dateEntry) => dateEntry.games || []).slice(0, 5);
    if (!games.length) {
      setError(els.schedule, "No upcoming games returned.");
      return;
    }
    els.schedule.replaceChildren(...games.map((game) => {
      const item = document.createElement("a");
      item.className = "preview-row";
      item.href = "./schedule/";
      const prefix = isYankeesHome(game) ? "vs" : "@";
      item.innerHTML = `
        <span><strong>${niceDate(game.officialDate)}</strong><small>${timeLabel(game.gameDate)}</small></span>
        <span>${prefix} ${teamAbbreviation(opponent(game))}</span>
      `;
      return item;
    }));
  } catch (error) {
    setError(els.schedule, "Schedule preview is unavailable right now.");
  }
}

async function renderMovesPreview() {
  try {
    const data = await api.transactions();
    const transactions = (data.transactions || []).slice().reverse().slice(0, 10);
    if (!transactions.length) {
      setError(els.moves, "No recent transactions returned.");
      return;
    }
    els.moves.replaceChildren(...transactions.map((transaction) => {
      const item = document.createElement("a");
      item.className = "preview-row";
      item.href = "./moves-il/";
      const description = transaction.description || transaction.note || transaction.typeDesc || "Transaction";
      item.innerHTML = `
        <span><strong>${niceDate(transaction.date)}</strong><small>${transaction.typeDesc || "Move"}</small></span>
        <span>${description}</span>
      `;
      return item;
    }));
  } catch (error) {
    setError(els.moves, "Moves preview is unavailable right now.");
  }
}

async function renderFormPreview() {
  try {
    const rosterData = await api.roster();
    const roster = (rosterData.roster || []).slice(0, 28);
    const scored = await Promise.all(roster.map(async (entry) => {
      const position = entry.position?.abbreviation || entry.person?.primaryPosition?.abbreviation || "";
      const group = position === "P" ? "pitching" : "hitting";
      const data = await api.playerStats(entry.person.id, group, "gameLog").catch(() => ({ stats: [] }));
      const splits = data.stats?.[0]?.splits || [];
      return scoreRecentPlayer(entry, splits);
    }));
    const players = scored.filter(Boolean).sort((a, b) => b.score - a.score);
    if (players.length < 2) {
      setError(els.form, "Recent form needs more game-log data.");
      return;
    }
    const hot = players[0];
    const watch = players[players.length - 1];
    els.form.innerHTML = `
      <a class="form-row hot" href="${hot.href}">
        <span><strong>Hot</strong><small>${hot.position || "NYY"}</small></span>
        <span><b>${hot.name}</b><small>${hot.detail}</small></span>
      </a>
      <a class="form-row watch" href="${watch.href}">
        <span><strong>Watch</strong><small>${watch.position || "NYY"}</small></span>
        <span><b>${watch.name}</b><small>${watch.detail}</small></span>
      </a>
    `;
  } catch (error) {
    setError(els.form, "Recent form is unavailable right now.");
  }
}

function init() {
  renderSpotlightPreview();
  renderSchedulePreview();
  renderMovesPreview();
  renderFormPreview();
}

init();
