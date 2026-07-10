const TEAM_ID = 147;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const MLB_LIVE_API = "https://statsapi.mlb.com/api/v1.1";
const HARD_HIT_MPH = 95;

const els = {
  status: document.querySelector("#recap-status"),
  title: document.querySelector("#recap-title"),
  subtitle: document.querySelector("#recap-subtitle"),
  scoreboard: document.querySelector("#recap-scoreboard"),
  grid: document.querySelector("#recap-grid"),
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

function teamAbbreviation(team) {
  return team?.abbreviation || team?.teamName || team?.name || "TBD";
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

async function getLatestFinalGame() {
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

    if (games.length) return games[0];
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

function renderRecap(game, feed) {
  const side = yankeesSide(game);
  const opponent = game.teams?.[opponentSide(game)]?.team;
  const teamStats = feed.liveData?.boxscore?.teams?.[side]?.teamStats || {};
  const batting = teamStats.batting || {};
  const pitching = teamStats.pitching || {};
  const lineTeam = feed.liveData?.linescore?.teams?.[side] || {};
  const metrics = collectGameMetrics(feed, side);
  const batted = metrics.battedBalls;
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
    <span>${escapeHtml(resultLabel(game))}</span>
    <strong>${escapeHtml(scoreLine(game))}</strong>
    <small>${escapeHtml(niceDate(game.officialDate))}</small>
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
    const latestGame = await getLatestFinalGame();
    const feed = await getLiveJson(`/game/${latestGame.gamePk}/feed/live`);
    renderRecap(latestGame, feed);
  } catch (error) {
    els.status.textContent = "Recap unavailable";
    els.status.style.color = "#ffbec4";
    els.title.textContent = "Latest recap could not be loaded";
    els.subtitle.textContent = "The MLB data feed did not return the completed game recap right now.";
    els.scoreboard.innerHTML = `
      <span>Unavailable</span>
      <strong>Try again shortly</strong>
      <small>${escapeHtml(error.message)}</small>
    `;
    els.grid.innerHTML = `
      <article class="recap-column recap-error">
        <h3>Data Error</h3>
        <p class="recap-loading mb-0">${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}

init();
