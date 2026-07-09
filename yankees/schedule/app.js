const TEAM_ID = 147;
const MLB_API = "https://statsapi.mlb.com/api/v1";

const els = {
  status: document.querySelector("#data-status"),
  monthTitle: document.querySelector("#month-title"),
  monthSummary: document.querySelector("#month-summary"),
  grid: document.querySelector("#calendar-grid"),
  prev: document.querySelector("#prev-month"),
  current: document.querySelector("#current-month"),
  next: document.querySelector("#next-month"),
};

const state = {
  selectedDate: startOfMonth(new Date()),
  currentMonth: startOfMonth(new Date()),
};

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

function agendaDateLabel(date) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function timeLabel(value) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.style.color = tone === "error" ? "#ffbec4" : tone === "good" ? "#9af0c8" : "";
}

async function getSchedule(monthDate) {
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const url = new URL(`${MLB_API}/schedule`);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", TEAM_ID);
  url.searchParams.set("startDate", dateKey(start));
  url.searchParams.set("endDate", dateKey(end));
  url.searchParams.set("hydrate", "team,venue,linescore,probablePitcher");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`MLB API returned ${response.status}`);
  return response.json();
}

function groupGamesByDate(schedule) {
  const games = new Map();
  (schedule.dates || []).forEach((dateEntry) => {
    games.set(dateEntry.date, dateEntry.games || []);
  });
  return games;
}

function isYankeesHome(game) {
  return game.teams?.home?.team?.id === TEAM_ID;
}

function opponent(game) {
  return isYankeesHome(game) ? game.teams?.away?.team : game.teams?.home?.team;
}

function teamAbbreviation(team) {
  return team?.abbreviation || team?.teamName || team?.name || "TBD";
}

function scoreLine(game) {
  const away = game.teams?.away;
  const home = game.teams?.home;
  const awayScore = away?.score ?? "-";
  const homeScore = home?.score ?? "-";
  return `${teamAbbreviation(away?.team)} ${awayScore}, ${teamAbbreviation(home?.team)} ${homeScore}`;
}

function yankeesTeamEntry(game) {
  return isYankeesHome(game) ? game.teams?.home : game.teams?.away;
}

function opponentTeamEntry(game) {
  return isYankeesHome(game) ? game.teams?.away : game.teams?.home;
}

function yankeesResult(game) {
  if (game.status?.abstractGameState !== "Final") return "";
  const yankeesScore = Number(yankeesTeamEntry(game)?.score);
  const opponentScore = Number(opponentTeamEntry(game)?.score);
  if (!Number.isFinite(yankeesScore) || !Number.isFinite(opponentScore)) return "";
  if (yankeesScore === opponentScore) return "";
  return yankeesScore > opponentScore ? "win" : "loss";
}

function statusLabel(game) {
  const status = game.status?.abstractGameState;
  if (status === "Final") {
    const result = yankeesResult(game);
    if (result === "win") return "Final · Win";
    if (result === "loss") return "Final · Loss";
    return "Final";
  }
  if (status === "Live") return game.status?.detailedState || "Live";
  return game.status?.detailedState || "Scheduled";
}

function gameDetail(game) {
  const status = game.status?.abstractGameState;
  if (status === "Final" || status === "Live") return scoreLine(game);

  const details = [timeLabel(game.gameDate)];
  if (game.venue?.name) details.push(game.venue.name);
  return details.join(" · ");
}

function gameClass(game) {
  const status = game.status?.abstractGameState;
  if (status === "Final") return `final ${yankeesResult(game)}`;
  if (status === "Live") return "live";
  return "scheduled";
}

function renderGame(game) {
  const card = document.createElement("article");
  const opp = opponent(game);
  const prefix = isYankeesHome(game) ? "vs" : "@";
  card.className = `game-card ${gameClass(game)}`;
  card.innerHTML = `
    <div class="game-status">${statusLabel(game)}</div>
    <div class="matchup">${prefix} ${teamAbbreviation(opp)}</div>
    <div class="game-detail">${gameDetail(game)}</div>
  `;
  return card;
}

function renderCalendar(monthDate, gamesByDate) {
  els.grid.replaceChildren();

  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const today = dateKey(new Date());
  const cells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;

  for (let index = 0; index < cells; index += 1) {
    const cellDate = new Date(cursor);
    const key = dateKey(cellDate);
    const games = gamesByDate.get(key) || [];
    const cell = document.createElement("article");
    cell.className = "day-cell";
    if (cellDate.getMonth() !== monthDate.getMonth()) cell.classList.add("outside-month");
    if (key === today) cell.classList.add("today");

    const dayNumber = document.createElement("div");
    dayNumber.className = "day-number";
    dayNumber.dataset.mobileLabel = agendaDateLabel(cellDate);
    dayNumber.textContent = String(cellDate.getDate());
    cell.append(dayNumber);

    if (games.length) {
      games.forEach((game) => cell.append(renderGame(game)));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-day";
      empty.textContent = cellDate.getMonth() === monthDate.getMonth() ? "No game" : "";
      cell.append(empty);
    }

    els.grid.append(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function summarize(schedule, monthDate) {
  const games = (schedule.dates || []).flatMap((dateEntry) => dateEntry.games || []);
  const finalCount = games.filter((game) => game.status?.abstractGameState === "Final").length;
  const liveCount = games.filter((game) => game.status?.abstractGameState === "Live").length;
  const upcomingCount = games.length - finalCount - liveCount;
  els.monthSummary.textContent = `${games.length} games in ${monthLabel(monthDate)} · ${finalCount} final · ${liveCount} live · ${upcomingCount} upcoming`;
}

async function loadMonth(monthDate) {
  state.selectedDate = startOfMonth(monthDate);
  els.monthTitle.textContent = monthLabel(state.selectedDate);
  els.grid.innerHTML = `<p class="error p-3 mb-0">Loading schedule...</p>`;
  setStatus("Loading schedule");

  try {
    const schedule = await getSchedule(state.selectedDate);
    renderCalendar(state.selectedDate, groupGamesByDate(schedule));
    summarize(schedule, state.selectedDate);
    setStatus("Live MLB data", "good");
  } catch (error) {
    setStatus("Data connection issue", "error");
    els.monthSummary.textContent = "The schedule could not be loaded right now.";
    els.grid.innerHTML = `<p class="error p-3 mb-0">Could not load the Yankees schedule. ${error.message}</p>`;
  }
}

function bindEvents() {
  els.prev.addEventListener("click", () => loadMonth(addMonths(state.selectedDate, -1)));
  els.current.addEventListener("click", () => loadMonth(state.currentMonth));
  els.next.addEventListener("click", () => loadMonth(addMonths(state.selectedDate, 1)));
}

bindEvents();
loadMonth(state.selectedDate);
