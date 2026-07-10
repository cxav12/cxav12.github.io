const TEAM_ID = 147;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const MLB_LIVE_API = "https://statsapi.mlb.com/api/v1.1";
const HARD_HIT_MPH = 95;

const els = {
  status: document.querySelector("#recap-status"),
  title: document.querySelector("#recap-title"),
  subtitle: document.querySelector("#recap-subtitle"),
  scoreboard: document.querySelector("#recap-scoreboard"),
  recent: document.querySelector("#recent-games-grid"),
  grid: document.querySelector("#recap-grid"),
};

const state = {
  recentGames: [],
};

async function getJson(path, params = {}) {
  const url = new URL(`${MLB_API}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MLB API returned ${response.status}`);
  return response.json();
}

async function getLiveJson(path) {
  const response = await fetch(`${MLB_LIVE_API}${path}`);
  if (!response.ok) throw new Error(`MLB game feed returned ${response.status}`);
  return response.json();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateWindow(daysBack) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - daysBack);
  return { start: formatDate(start), end: formatDate(end) };
}

function niceDate(value) {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function dateTileParts(value) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return {
    weekday: new Intl.DateTimeFormat("en", { weekday: "short" }).format(date).toUpperCase(),
    month: new Intl.DateTimeFormat("en", { month: "short" }).format(date).toUpperCase(),
    day: new Intl.DateTimeFormat("en", { day: "numeric" }).format(date),
  };
}

function teamAbbreviation(team) {
  return team?.abbreviation || team?.teamName || team?.name || "TBD";
}

function teamLogoUrl(team) {
  const id = typeof team === "number" ? team : team?.id;
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : "";
}

function statValue(source, key, fallback = "-") {
  const value = source?.[key];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function numberValue(source, key) {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function isYankeesHome(game) {
  return game.teams?.home?.team?.id === TEAM_ID;
}

function yankeesSide(game) {
  return isYankeesHome(game) ? "home" : "away";
}

function opponentSide(game) {
  return isYankeesHome(game) ? "away" : "home";
}

function teamEntry(game, side) {
  return game.teams?.[side] || {};
}

function scoreLine(game) {
  const away = game.teams?.away;
  const home = game.teams?.home;
  return `${teamAbbreviation(away?.team)} ${away?.score ?? "-"}, ${teamAbbreviation(home?.team)} ${home?.score ?? "-"}`;
}

function resultLabel(game) {
  const yankees = game.teams?.[yankeesSide(game)]?.score;
  const opponent = game.teams?.[opponentSide(game)]?.score;
  if (!Number.isFinite(Number(yankees)) || !Number.isFinite(Number(opponent))) return "Final";
  return Number(yankees) > Number(opponent) ? "Final - Win" : "Final - Loss";
}

function resultWord(game) {
  const yankees = game.teams?.[yankeesSide(game)]?.score;
  const opponent = game.teams?.[opponentSide(game)]?.score;
  if (!Number.isFinite(Number(yankees)) || !Number.isFinite(Number(opponent))) return "Final";
  return Number(yankees) > Number(opponent) ? "Win" : "Loss";
}

function resultShort(game) {
  const yankees = teamEntry(game, yankeesSide(game))?.score;
  const opponent = teamEntry(game, opponentSide(game))?.score;
  if (!Number.isFinite(Number(yankees)) || !Number.isFinite(Number(opponent))) return "Final";
  return Number(yankees) > Number(opponent) ? "Win" : "Loss";
}

function formatDecisionPitcher(player, fallback = "None") {
  if (!player) return fallback;
  const name = player.initLastName || player.lastName || player.fullName || fallback;
  const wins = player.stats?.pitching?.wins ?? player.stats?.statsSingleSeason?.pitching?.wins;
  const losses = player.stats?.pitching?.losses ?? player.stats?.statsSingleSeason?.pitching?.losses;
  const era = player.stats?.pitching?.era ?? player.stats?.statsSingleSeason?.pitching?.era;
  const record = wins !== undefined && losses !== undefined && era !== undefined
    ? ` (${wins}-${losses}, ${era})`
    : "";
  return `${name}${record}`;
}

async function getRecentFinalGames() {
  for (const daysBack of [21, 45, 90]) {
    const { start, end } = dateWindow(daysBack);
    const schedule = await getJson("/schedule", {
      sportId: 1,
      teamId: TEAM_ID,
      startDate: start,
      endDate: end,
      hydrate: "team,venue,linescore",
    });
    const games = (schedule.dates || [])
      .flatMap((dateEntry) => dateEntry.games || [])
      .filter((game) => game.status?.abstractGameState === "Final")
      .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

    if (games.length >= 5 || daysBack === 90) return games;
  }

  throw new Error("No completed Yankees games found.");
}

function battedBallCategory(play) {
  const events = (play.playEvents || []).slice().reverse();
  const hitEvent = events.find((event) => event.hitData || event.details?.isInPlay);
  const angle = Number(hitEvent?.hitData?.launchAngle);

  if (Number.isFinite(angle)) {
    if (angle < 10) return "ground";
    if (angle < 25) return "line";
    if (angle < 50) return "fly";
    return "popup";
  }

  const text = `${play.result?.eventType || ""} ${play.result?.event || ""}`.toLowerCase();
  if (text.includes("ground")) return "ground";
  if (text.includes("line")) return "line";
  if (text.includes("fly")) return "fly";
  if (text.includes("pop")) return "popup";
  return "";
}

function collectGameMetrics(feed, side) {
  const allPlays = feed.liveData?.plays?.allPlays || [];
  const battingHalf = side === "home" ? "bottom" : "top";
  const pitchingHalf = side === "home" ? "top" : "bottom";
  const battedBalls = {
    ground: 0,
    line: 0,
    fly: 0,
    popup: 0,
    total: 0,
  };
  const exitVelos = [];
  let maxExit = null;
  let maxPitch = null;

  allPlays.forEach((play) => {
    if (play.about?.halfInning === battingHalf) {
      const category = battedBallCategory(play);
      const hitEvent = (play.playEvents || []).slice().reverse().find((event) => event.hitData?.launchSpeed);
      const exitVelo = Number(hitEvent?.hitData?.launchSpeed);

      if (category) {
        battedBalls[category] += 1;
        battedBalls.total += 1;
      }

      if (Number.isFinite(exitVelo)) {
        const distance = Number(hitEvent?.hitData?.totalDistance);
        const entry = {
          value: exitVelo,
          player: play.matchup?.batter?.fullName || "Yankees batter",
          detail: Number.isFinite(distance) ? `${Math.round(distance)} ft` : "Batted ball",
        };
        exitVelos.push(exitVelo);
        if (!maxExit || exitVelo > maxExit.value) maxExit = entry;
      }
    }

    if (play.about?.halfInning === pitchingHalf) {
      (play.playEvents || []).forEach((event) => {
        const speed = Number(event.pitchData?.startSpeed);
        if (!Number.isFinite(speed)) return;
        const entry = {
          value: speed,
          player: play.matchup?.pitcher?.fullName || "Yankees pitcher",
          detail: event.details?.type?.description || event.details?.type?.code || "Pitch",
        };
        if (!maxPitch || speed > maxPitch.value) maxPitch = entry;
      });
    }
  });

  const avgExit = exitVelos.length
    ? exitVelos.reduce((sum, value) => sum + value, 0) / exitVelos.length
    : null;
  const hardHitCount = exitVelos.filter((value) => value >= HARD_HIT_MPH).length;

  return {
    battedBalls,
    maxExit,
    avgExit,
    hardHitCount,
    trackedBattedBalls: exitVelos.length,
    maxPitch,
  };
}

function statRow(label, value) {
  return `
    <div class="recap-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function barRow(label, count, total, tone) {
  const percentage = total ? Math.round((count / total) * 100) : 0;
  return `
    <div class="bar-stat">
      <div class="bar-stat-heading">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(count)}</strong>
      </div>
      <div class="bar-track" aria-hidden="true">
        <span class="bar-fill ${tone}" style="width: ${percentage}%">${percentage ? `${percentage}%` : ""}</span>
      </div>
    </div>
  `;
}

function metricFeature(label, value, unit, detail) {
  return `
    <div class="metric-feature">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}${unit ? ` <small>${escapeHtml(unit)}</small>` : ""}</strong>
      <em>${escapeHtml(detail)}</em>
    </div>
  `;
}

function renderRecapColumn(title, body) {
  return `
    <article class="recap-column">
      <h3>${escapeHtml(title)}</h3>
      <div class="recap-divider"></div>
      ${body}
    </article>
  `;
}

function renderRecentGames(games, selectedGamePk) {
  const previousGames = games.slice(1, 5);

  if (!previousGames.length) {
    els.recent.innerHTML = `<button class="recent-game-button" type="button" disabled>No previous games found.</button>`;
    return;
  }

  els.recent.innerHTML = previousGames.map((game) => {
    const yankees = teamEntry(game, yankeesSide(game));
    const opponentEntry = teamEntry(game, opponentSide(game));
    const opponent = opponentEntry.team;
    const isSelected = Number(game.gamePk) === Number(selectedGamePk);
    return `
      <button class="recent-game-button${isSelected ? " active" : ""}" type="button" data-game-pk="${escapeHtml(game.gamePk)}">
        <span class="recent-game-date">${escapeHtml(niceDate(game.officialDate))}</span>
        <span class="recent-game-matchup">
          <img src="${escapeHtml(teamLogoUrl(yankees.team))}" alt="${escapeHtml(teamAbbreviation(yankees.team))} logo" />
          <strong>NYY ${escapeHtml(yankees.score ?? "-")}</strong>
          <i aria-hidden="true">-</i>
          <strong>${escapeHtml(opponentEntry.score ?? "-")} ${escapeHtml(teamAbbreviation(opponent))}</strong>
          <img src="${escapeHtml(teamLogoUrl(opponent))}" alt="${escapeHtml(teamAbbreviation(opponent))} logo" />
        </span>
        <span class="recent-game-result ${resultShort(game).toLowerCase()}">${escapeHtml(resultShort(game))}</span>
      </button>
    `;
  }).join("");
}

function renderRecap(game, feed) {
  const side = yankeesSide(game);
  const yankees = teamEntry(game, yankeesSide(game));
  const opponentEntry = teamEntry(game, opponentSide(game));
  const opponent = game.teams?.[opponentSide(game)]?.team;
  const teamStats = feed.liveData?.boxscore?.teams?.[side]?.teamStats || {};
  const batting = teamStats.batting || {};
  const pitching = teamStats.pitching || {};
  const lineTeam = feed.liveData?.linescore?.teams?.[side] || {};
  const decisions = feed.liveData?.decisions || {};
  const metrics = collectGameMetrics(feed, side);
  const batted = metrics.battedBalls;
  const yankeesScore = yankees.score ?? "-";
  const opponentScore = opponentEntry.score ?? "-";
  const opponentAbbr = teamAbbreviation(opponent);
  const gameResult = resultWord(game);
  const strikePercentage = numberValue(pitching, "numberOfPitches")
    ? Math.round((numberValue(pitching, "strikes") / numberValue(pitching, "numberOfPitches")) * 100)
    : 0;
  const avgExit = metrics.avgExit === null ? "-" : metrics.avgExit.toFixed(1);
  const hardHitPct = metrics.trackedBattedBalls
    ? ((metrics.hardHitCount / metrics.trackedBattedBalls) * 100).toFixed(1)
    : "-";

  els.status.textContent = "Latest final loaded";
  els.status.style.color = "#9af0c8";
  els.title.textContent = `${resultLabel(game)} vs ${teamAbbreviation(opponent)}`;
  els.subtitle.textContent = `${niceDate(game.officialDate)} - ${game.venue?.name || "Ballpark"} - ${scoreLine(game)}`;
  els.scoreboard.innerHTML = `
    <div class="game-result-badge ${gameResult.toLowerCase()}">${escapeHtml(gameResult)}</div>
    <div class="game-score-strip">
      <img class="team-logo" src="${escapeHtml(teamLogoUrl(yankees.team))}" alt="New York Yankees logo" />
      <span>NYY</span>
      <strong>${escapeHtml(yankeesScore)}</strong>
      <i aria-hidden="true">-</i>
      <strong>${escapeHtml(opponentScore)}</strong>
      <span>${escapeHtml(opponentAbbr)}</span>
      <img class="team-logo" src="${escapeHtml(teamLogoUrl(opponent))}" alt="${escapeHtml(opponentAbbr)} logo" />
    </div>
    <div class="game-decisions">
      <p><span class="win-label">W:</span> ${escapeHtml(formatDecisionPitcher(decisions.winner))}</p>
      <p><span class="loss-label">L:</span> ${escapeHtml(formatDecisionPitcher(decisions.loser))}</p>
      <p><span class="save-label">SV:</span> ${escapeHtml(formatDecisionPitcher(decisions.save))}</p>
    </div>
  `;

  els.grid.innerHTML = [
    renderRecapColumn("NYY Hitting", [
      statRow("Hits", statValue(batting, "hits")),
      statRow("Doubles", statValue(batting, "doubles")),
      statRow("Triples", statValue(batting, "triples")),
      statRow("Home Runs", statValue(batting, "homeRuns")),
      statRow("Walks", statValue(batting, "baseOnBalls")),
      statRow("Strikeouts", statValue(batting, "strikeOuts")),
      statRow("Team LOB", statValue(lineTeam, "leftOnBase", statValue(batting, "leftOnBase"))),
      statRow("Batter LOB", statValue(batting, "leftOnBase")),
      statRow("SB / CS", `${statValue(batting, "stolenBases", 0)} / ${statValue(batting, "caughtStealing", 0)}`),
      statRow("GIDP", statValue(batting, "groundIntoDoublePlay")),
      statRow("Runs", statValue(batting, "runs")),
    ].join("")),
    renderRecapColumn("NYY Batted Balls", [
      barRow("Ground Balls", batted.ground, batted.total, "blue"),
      barRow("Line Drives", batted.line, batted.total, "green"),
      barRow("Fly Balls", batted.fly, batted.total, "gold"),
      barRow("Popups", batted.popup, batted.total, "red"),
      `<div class="recap-row total-row"><span>Total</span><strong>${escapeHtml(batted.total || "-")}</strong></div>`,
    ].join("")),
    renderRecapColumn("NYY Pitching", [
      statRow("Strikeouts", statValue(pitching, "strikeOuts")),
      statRow("Walks", statValue(pitching, "baseOnBalls")),
      statRow("Hits Allowed", statValue(pitching, "hits")),
      statRow("HR Allowed", statValue(pitching, "homeRuns")),
      statRow("Earned Runs", statValue(pitching, "earnedRuns")),
      statRow("Ground Balls", statValue(pitching, "groundOuts")),
      statRow("Fly Balls", statValue(pitching, "airOuts")),
      statRow("Innings", statValue(pitching, "inningsPitched")),
      statRow("Pitches", statValue(pitching, "numberOfPitches")),
      `
        <div class="bar-stat compact-bar">
          <div class="bar-stat-heading">
            <span>Strike %</span>
            <strong>${strikePercentage ? `${strikePercentage}%` : "-"}</strong>
          </div>
          <div class="bar-track" aria-hidden="true">
            <span class="bar-fill green" style="width: ${strikePercentage}%"></span>
          </div>
        </div>
      `,
    ].join("")),
    renderRecapColumn("NYY Metrics", [
      metricFeature("Max Exit Velo", metrics.maxExit ? metrics.maxExit.value.toFixed(1) : "-", "MPH", metrics.maxExit ? `${metrics.maxExit.player} - ${metrics.maxExit.detail}` : "No tracked batted balls"),
      metricFeature("Avg Exit Velo", avgExit, avgExit === "-" ? "" : "MPH", `${metrics.trackedBattedBalls || 0} tracked batted balls`),
      metricFeature("Hard Hit %", hardHitPct, hardHitPct === "-" ? "" : "%", `${metrics.hardHitCount} of ${metrics.trackedBattedBalls} batted balls`),
      metricFeature("Max Pitch Velo", metrics.maxPitch ? metrics.maxPitch.value.toFixed(1) : "-", "MPH", metrics.maxPitch ? `${metrics.maxPitch.player} - ${metrics.maxPitch.detail}` : "No tracked pitches"),
    ].join("")),
  ].join("");
}

async function init() {
  try {
    const games = await getRecentFinalGames();
    const latestGame = games[0];
    state.recentGames = games;
    renderRecentGames(games, latestGame?.gamePk);
    if (!latestGame) throw new Error("No completed Yankees games found.");
    const feed = await getLiveJson(`/game/${latestGame.gamePk}/feed/live`);
    renderRecap(latestGame, feed);
  } catch (error) {
    els.status.textContent = "Recap unavailable";
    els.status.style.color = "#ffbec4";
    els.title.textContent = "Latest recap could not be loaded";
    els.subtitle.textContent = "The MLB data feed did not return the completed game recap right now.";
    els.scoreboard.innerHTML = `
      <div class="game-result-badge">Unavailable</div>
      <div class="game-score-strip">
        <span>NYY</span>
        <strong>-</strong>
        <i aria-hidden="true">-</i>
        <strong>-</strong>
        <span>OPP</span>
      </div>
      <div class="game-decisions">
        <p><span class="win-label">W:</span> Try again shortly</p>
        <p><span class="loss-label">L:</span> ${escapeHtml(error.message)}</p>
        <p><span class="save-label">SV:</span> None</p>
      </div>
    `;
    els.grid.innerHTML = `
      <article class="recap-column recap-error">
        <h3>Data Error</h3>
        <p class="recap-loading mb-0">${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}

els.recent.addEventListener("click", async (event) => {
  const button = event.target.closest(".recent-game-button[data-game-pk]");
  if (!button) return;

  const gamePk = Number(button.dataset.gamePk);
  const game = state.recentGames.find((item) => Number(item.gamePk) === gamePk);
  if (!game) return;

  els.status.textContent = "Loading selected recap";
  els.status.style.color = "";
  els.scoreboard.classList.add("loading");
  renderRecentGames(state.recentGames, gamePk);

  try {
    const feed = await getLiveJson(`/game/${game.gamePk}/feed/live`);
    renderRecap(game, feed);
  } catch (error) {
    els.status.textContent = "Selected recap unavailable";
    els.status.style.color = "#ffbec4";
  } finally {
    els.scoreboard.classList.remove("loading");
  }
});

init();
