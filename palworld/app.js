const DATA_URL = "./data/passive-skills.json";

const statusPanel = document.querySelector("#data-status");
const statusTitle = document.querySelector("#data-status-title");
const statusMessage = document.querySelector("#data-status-message");
const statusMeta = document.querySelector("#data-status-meta");

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function showStatus({ state, title, message, meta = "" }) {
  statusPanel.dataset.state = state;
  statusTitle.textContent = title;
  statusMessage.textContent = message;
  statusMeta.textContent = meta;
  statusPanel.hidden = false;
}

async function loadDataStatus() {
  try {
    const response = await fetch(DATA_URL);

    if (!response.ok) {
      throw new Error(`Data request failed with status ${response.status}`);
    }

    const data = await response.json();
    const metadata = data.metadata;
    const updateRequired = metadata.updateStatus === "update-required";

    showStatus({
      state: updateRequired ? "update" : "current",
      title: updateRequired
        ? "Palworld data update needed"
        : "Palworld data is current",
      message: updateRequired
        ? metadata.updateMessage
        : `This dataset is verified for Palworld ${metadata.gameVersion}.`,
      meta: `Last checked ${formatDate(metadata.lastChecked)}`,
    });
  } catch (error) {
    console.error("Unable to load Palworld data status.", error);
    showStatus({
      state: "error",
      title: "Data status unavailable",
      message:
        "The local Palworld dataset could not be loaded. Check the data file before publishing.",
    });
  }
}

loadDataStatus();
