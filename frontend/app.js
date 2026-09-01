(() => {
function buildMockData() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(
    Date.UTC(year, month + 1, 0)
  ).getUTCDate();

  const rows = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const pattern = Math.sin(day * 2.4);
    const spent = Math.max(
      0.05,
      Number((0.35 + pattern * 0.85 + (day % 5) * 0.12).toFixed(2))
    );

    rows.push({
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      spent
    });
  }

  return rows;
}

const MOCK_DATA = buildMockData();

let spendingData = [...MOCK_DATA];
let dailyLimit = 0.67;
let currentMode = "daily";
let chartPoints = [];
let hoveredIndex = -1;

const canvas = document.getElementById("spendingChart");
const ctx = canvas.getContext("2d");

const chartCard = document.getElementById("chartCard");
const tooltip = document.getElementById("tooltip");
const emptyState = document.getElementById("emptyState");
const dailyModeButton = document.getElementById("dailyMode");
const compoundModeButton = document.getElementById("compoundMode");
const refreshButton = document.getElementById("refreshButton");
const settingsButton = document.getElementById("settingsButton");
const settingsModal = document.getElementById("settingsModal");
const settingsKeyInput = document.getElementById("settingsKeyInput");
const settingsLimitInput = document.getElementById("settingsLimitInput");
const settingsKeyHint = document.getElementById("settingsKeyHint");
const settingsStatus = document.getElementById("settingsStatus");
const settingsSave = document.getElementById("settingsSave");
const settingsCancel = document.getElementById("settingsCancel");
const settingsClose = document.getElementById("settingsClose");
const settingsClearKey = document.getElementById("settingsClearKey");
const settingsResetLimit = document.getElementById("settingsResetLimit");
const toggleKeyVisibility = document.getElementById("toggleKeyVisibility");

const isTauri =
  Boolean(window.__TAURI__) &&
  Boolean(window.__TAURI__.core) &&
  typeof window.__TAURI__.core.invoke === "function";

function money(value) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeValue);
}

function shortMoney(value) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;

  if (safeValue >= 1000) {
    return `$${(safeValue / 1000).toFixed(1)}k`;
  }

  return `$${safeValue.toFixed(safeValue >= 10 ? 0 : 1)}`;
}

function formatDay(isoDate) {
  if (typeof isoDate !== "string") {
    return "";
  }

  const parts = isoDate.split("-");

  if (parts.length !== 3) {
    return isoDate;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatMonth(isoDate) {
  if (typeof isoDate !== "string") {
    return "";
  }

  const parts = isoDate.split("-");

  if (parts.length !== 3) {
    return isoDate;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);

  const date = new Date(Date.UTC(year, month - 1, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const sanitized = rows
    .map((row) => ({
      date: String(row?.date ?? ""),
      spent: Math.max(0, Number(row?.spent ?? 0))
    }))
    .filter(
      (row) =>
        /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        Number.isFinite(row.spent)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sanitized.length === 0) {
    return [];
  }

  const monthPrefix = sanitized[sanitized.length - 1].date.slice(0, 7);

  return sanitized.filter((row) => row.date.startsWith(monthPrefix));
}

function getDailyData() {
  return spendingData.map((day) => ({
    ...day,
    carry: 0,
    available: dailyLimit,
    remaining: Math.max(dailyLimit - day.spent, 0),
    over: day.spent > dailyLimit
  }));
}

function getCompoundData() {
  let carry = 0;

  return spendingData.map((day) => {
    const available = dailyLimit + carry;
    const remaining = Math.max(available - day.spent, 0);

    const result = {
      ...day,
      carry,
      available,
      remaining,
      over: day.spent > available
    };

    carry = remaining;
    return result;
  });
}

function getData() {
  return currentMode === "compound"
    ? getCompoundData()
    : getDailyData();
}

function setConnectionStatus(status, text) {
  const statusNode = document.getElementById("connectionStatus");
  const textNode = document.getElementById("connectionText");

  statusNode.classList.remove("live", "demo", "error");
  statusNode.classList.add(status);
  textNode.textContent = text;
}

function updateMeta() {
  const data = getData();
  const lastDate = data[data.length - 1]?.date;

  document.getElementById("rangeLabel").textContent =
    formatMonth(lastDate) || "CURRENT MONTH";

  emptyState.hidden = data.length > 0;

  if (currentMode === "compound") {
    document.getElementById("legendLineText").textContent =
      "Available limit";
  } else {
    document.getElementById("legendLineText").textContent =
      "Daily limit";
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.max(
    0,
    Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2)
  );

  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function niceAxisMax(value) {
  const safe = Math.max(1, value);

  if (safe <= 4) {
    return 4;
  }

  if (safe <= 8) {
    return Math.ceil(safe);
  }

  const magnitude = 10 ** Math.floor(Math.log10(safe));
  const normalized = safe / magnitude;

  let nice;

  if (normalized <= 2) {
    nice = 2;
  } else if (normalized <= 5) {
    nice = 5;
  } else {
    nice = 10;
  }

  return nice * magnitude;
}

function chooseTickStep(axisMax) {
  if (axisMax <= 5) return 1;
  if (axisMax <= 10) return 2;
  if (axisMax <= 25) return 5;
  if (axisMax <= 50) return 10;
  return axisMax / 5;
}

function drawChart() {
  resizeCanvas();

  const data = getData();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  ctx.clearRect(0, 0, width, height);
  chartPoints = [];

  if (!data.length || width <= 0 || height <= 0) {
    return;
  }

  const compact = width <= 420;

  const padding = compact
    ? {
        top: 12,
        right: 10,
        bottom: 24,
        left: 12
      }
    : {
        top: 26,
        right: 28,
        bottom: 44,
        left: 58
      };

  const graphWidth = Math.max(1, width - padding.left - padding.right);
  const graphHeight = Math.max(1, height - padding.top - padding.bottom);

  const maxVisibleValue = Math.max(
    dailyLimit,
    ...data.map((day) => Math.max(day.spent, day.available))
  );

  const axisMax = niceAxisMax(maxVisibleValue * 1.18);
  const tickStep = chooseTickStep(axisMax);

  const yFor = (value) =>
    padding.top +
    graphHeight -
    (Math.max(0, value) / axisMax) * graphHeight;

  // Horizontal grid and Y-axis values.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "10px Inter, system-ui, sans-serif";

  for (let value = 0; value <= axisMax + 0.0001; value += tickStep) {
    const y = yFor(value);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.072)";
    ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    if (compact) {
      continue;
    }

    ctx.fillStyle = "#717c8c";
    ctx.fillText(shortMoney(value), padding.left - 11, y);
  }

  const slotWidth = graphWidth / data.length;
  const barWidth = Math.max(8, Math.min(27, slotWidth * 0.38));
  const labelStep = compact
    ? Math.max(1, Math.ceil(data.length / 6))
    : 1;

  data.forEach((day, index) => {
    const centerX =
      padding.left +
      slotWidth * index +
      slotWidth / 2;

    const topY = yFor(day.spent);
    const bottomY = yFor(0);
    const heightPx = Math.max(1.5, bottomY - topY);
    const ratio =
      day.available > 0
        ? day.spent / day.available
        : day.spent > 0
          ? Infinity
          : 0;

    const isHovered = index === hoveredIndex;

    if (day.over) {
      ctx.fillStyle = isHovered ? "#ff7b82" : "#ff6b73";
    } else if (ratio >= 0.8) {
      ctx.fillStyle = isHovered ? "#ffc576" : "#f4ba65";
    } else {
      ctx.fillStyle = isHovered ? "#8ba7ff" : "#7898f7";
    }

    roundedRect(
      ctx,
      centerX - barWidth / 2,
      topY,
      barWidth,
      heightPx,
      4
    );
    ctx.fill();

    // Tiny top highlight.
    ctx.fillStyle = "rgba(255,255,255,0.13)";
    roundedRect(
      ctx,
      centerX - barWidth / 2 + 1,
      topY + 1,
      Math.max(1, barWidth - 2),
      Math.min(2, heightPx),
      2
    );
    ctx.fill();

    ctx.fillStyle = "#737e8e";
    ctx.font = compact
      ? "7px Inter, system-ui, sans-serif"
      : "9px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    if (!compact || index % labelStep === 0) {
      ctx.fillText(
        formatDay(day.date),
        centerX,
        height - padding.bottom + (compact ? 8 : 12)
      );
    }

    chartPoints.push({
      index,
      x: centerX,
      barWidth,
      topY,
      bottomY,
      day
    });
  });

  // Limit line.
  ctx.beginPath();
  ctx.strokeStyle = "#ffc45e";
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 5]);

  data.forEach((day, index) => {
    const x =
      padding.left +
      slotWidth * index +
      slotWidth / 2;

    const y = yFor(day.available);

    if (index === 0) {
      ctx.moveTo(x, y);
      return;
    }

    if (currentMode === "compound") {
      const previousX =
        padding.left +
        slotWidth * (index - 1) +
        slotWidth / 2;

      const previousY =
        yFor(data[index - 1].available);

      const midpoint = (previousX + x) / 2;

      ctx.lineTo(midpoint, previousY);
      ctx.lineTo(midpoint, y);
      ctx.lineTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
  ctx.setLineDash([]);

  // Compound nodes.
  if (currentMode === "compound") {
    data.forEach((day, index) => {
      const x =
        padding.left +
        slotWidth * index +
        slotWidth / 2;

      const y = yFor(day.available);

      ctx.beginPath();
      ctx.fillStyle = "#ffc45e";
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Latest limit value.
  const latest = data[data.length - 1];
  const latestY = yFor(latest.available);
  const limitLabel =
    currentMode === "compound"
      ? money(latest.available)
      : money(dailyLimit);

  ctx.font = compact
    ? "8px Inter, system-ui, sans-serif"
    : "9px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  const labelWidth = ctx.measureText(limitLabel).width + (compact ? 8 : 10);
  const labelHeight = compact ? 14 : 18;
  const labelX = width - padding.right;
  const labelY = Math.max(padding.top, latestY - (compact ? 18 : 23));

  ctx.fillStyle = "rgba(255,196,94,0.10)";
  roundedRect(
    ctx,
    labelX - labelWidth,
    labelY,
    labelWidth,
    labelHeight,
    5
  );
  ctx.fill();

  ctx.fillStyle = "#ffc45e";
  ctx.fillText(
    limitLabel,
    labelX - 5,
    labelY + (compact ? 10 : 13)
  );

  // Hover guide.
  if (
    hoveredIndex >= 0 &&
    hoveredIndex < chartPoints.length
  ) {
    const active = chartPoints[hoveredIndex];

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.moveTo(active.x, padding.top);
    ctx.lineTo(active.x, height - padding.bottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "#eef3ff";
    ctx.arc(active.x, active.topY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function showTooltip(point) {
  const day = point.day;
  const percentage =
    day.available > 0
      ? (day.spent / day.available) * 100
      : 0;

  tooltip.innerHTML = `
    <strong>${formatDay(day.date)}</strong>

    <div class="tooltip-row">
      <span>Spent</span>
      <span>${money(day.spent)}</span>
    </div>

    <div class="tooltip-row">
      <span>Usage</span>
      <span>${Number.isFinite(percentage) ? `${percentage.toFixed(0)}%` : "—"}</span>
    </div>

    ${
      currentMode === "compound"
        ? `
          <div class="tooltip-divider"></div>

          <div class="tooltip-row">
            <span>Base</span>
            <span>${money(dailyLimit)}</span>
          </div>

          <div class="tooltip-row">
            <span>Carried in</span>
            <span>${money(day.carry)}</span>
          </div>
        `
        : ""
    }

    <div class="tooltip-row">
      <span>Available</span>
      <span>${money(day.available)}</span>
    </div>

    <div class="tooltip-row">
      <span>Remaining</span>
      <span>${money(day.remaining)}</span>
    </div>
  `;

  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = canvas.parentElement.getBoundingClientRect();

  const localX = canvasRect.left - wrapRect.left + point.x;
  const localY = canvasRect.top - wrapRect.top + point.topY;

  const clampedX = Math.max(
    92,
    Math.min(canvas.clientWidth - 92, localX)
  );

  const clampedY = Math.max(92, localY);

  tooltip.style.left = `${clampedX}px`;
  tooltip.style.top = `${clampedY}px`;
  tooltip.classList.add("visible");
}

function clearTooltip() {
  hoveredIndex = -1;
  tooltip.classList.remove("visible");
  drawChart();
}

async function startWindowDrag(event) {
  if (!isTauri || event.button !== 0) {
    return;
  }

  if (
    event.target instanceof Element &&
    event.target.closest("button, input, select, textarea, [role=\"dialog\"]")
  ) {
    return;
  }

  event.preventDefault();

  hoveredIndex = -1;
  tooltip.classList.remove("visible");
  drawChart();

  try {
    await window.__TAURI__.window.getCurrentWindow().startDragging();
  } catch (error) {
    console.error("Could not start window drag:", error);
  }
}

async function startWindowResize(event) {
  if (!isTauri || event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  hoveredIndex = -1;
  tooltip.classList.remove("visible");
  drawChart();

  try {
    const direction = event.currentTarget.dataset.direction;
    await window.__TAURI__.window
      .getCurrentWindow()
      .startResizeDragging(direction);
  } catch (error) {
    console.error("Could not start window resize:", error);
  }
}

document
  .querySelectorAll(".resize-handle")
  .forEach((handle) =>
    handle.addEventListener("mousedown", startWindowResize)
  );

chartCard.addEventListener("mousedown", startWindowDrag);

canvas.setAttribute("draggable", "false");
chartCard.addEventListener("dragstart", (event) => event.preventDefault());

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;

  let active = null;

  for (const point of chartPoints) {
    const hitWidth = Math.max(34, point.barWidth);

    if (
      mouseX >= point.x - hitWidth / 2 &&
      mouseX <= point.x + hitWidth / 2
    ) {
      active = point;
      break;
    }
  }

  if (!active) {
    if (hoveredIndex !== -1) {
      clearTooltip();
    }
    return;
  }

  if (hoveredIndex !== active.index) {
    hoveredIndex = active.index;
    drawChart();
  }

  showTooltip(active);
});

canvas.addEventListener("mouseleave", clearTooltip);

function setMode(mode) {
  currentMode = mode === "compound" ? "compound" : "daily";
  hoveredIndex = -1;
  tooltip.classList.remove("visible");

  const dailyActive = currentMode === "daily";

  dailyModeButton.classList.toggle("active", dailyActive);
  compoundModeButton.classList.toggle("active", !dailyActive);

  dailyModeButton.setAttribute(
    "aria-pressed",
    String(dailyActive)
  );

  compoundModeButton.setAttribute(
    "aria-pressed",
    String(!dailyActive)
  );

  updateMeta();
  drawChart();
}

dailyModeButton.addEventListener("click", () => setMode("daily"));
compoundModeButton.addEventListener("click", () => setMode("compound"));

// ── Settings modal ──
let lastConfig = null;

function updateSettingsHint(config) {
  if (!settingsKeyHint || !config) return;
  if (config.keySource === "env") {
    settingsKeyHint.textContent =
      "Key is set via environment variable (env override) — stored key is ignored.";
  } else if (config.keySource === "stored" || config.storedHasKey) {
    settingsKeyHint.textContent = "Key saved locally (stored). Leave blank to keep it.";
  } else {
    settingsKeyHint.textContent = "No key saved. Paste your OpenRouter Management Key.";
  }
}

function openSettings() {
  if (!settingsModal) return;
  if (lastConfig) {
    // Prefill limit from effective config; key input stays blank (never echo back).
    settingsLimitInput.value =
      Number.isFinite(Number(lastConfig.dailyLimit)) ? String(lastConfig.dailyLimit) : "0.67";
    updateSettingsHint(lastConfig);
  }
  settingsKeyInput.value = "";
  settingsKeyInput.type = "password";
  if (toggleKeyVisibility) toggleKeyVisibility.textContent = "Show";
  if (settingsStatus) {
    settingsStatus.textContent = "";
    settingsStatus.className = "settings-status";
  }
  settingsModal.hidden = false;
  settingsModal.setAttribute("aria-hidden", "false");
  // Focus key input after modal is visible
  setTimeout(() => settingsKeyInput.focus(), 0);
}

function closeSettings() {
  if (!settingsModal) return;
  settingsModal.hidden = true;
  settingsModal.setAttribute("aria-hidden", "true");
  if (settingsStatus) {
    settingsStatus.textContent = "";
    settingsStatus.className = "settings-status";
  }
}

function setSettingsStatus(msg, kind) {
  if (!settingsStatus) return;
  settingsStatus.textContent = msg;
  settingsStatus.className = "settings-status" + (kind ? " " + kind : "");
}

if (settingsButton) settingsButton.addEventListener("click", openSettings);
if (settingsClose) settingsClose.addEventListener("click", closeSettings);
if (settingsCancel) settingsCancel.addEventListener("click", closeSettings);
if (settingsModal) {
  settingsModal.addEventListener("click", (e) => {
    if (e.target.matches("[data-close-settings]")) closeSettings();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsModal && !settingsModal.hidden) closeSettings();
});
if (toggleKeyVisibility && settingsKeyInput) {
  toggleKeyVisibility.addEventListener("click", () => {
    const isPw = settingsKeyInput.type === "password";
    settingsKeyInput.type = isPw ? "text" : "password";
    toggleKeyVisibility.textContent = isPw ? "Hide" : "Show";
    toggleKeyVisibility.setAttribute("aria-label", isPw ? "Hide key" : "Show key");
  });
}
if (settingsClearKey) {
  settingsClearKey.addEventListener("click", async () => {
    if (!isTauri) {
      setSettingsStatus("Not running in Tauri — nothing to clear.", "error");
      return;
    }
    settingsClearKey.disabled = true;
    try {
      const config = await window.__TAURI__.core.invoke("save_settings", {
        key: "",
        daily_limit: null,
      });
      lastConfig = config;
      const v = Number(config?.dailyLimit);
      if (Number.isFinite(v) && v > 0) dailyLimit = v;
      updateSettingsHint(config);
      setConnectionStatus(config.hasApiKey ? "live" : "demo", config.hasApiKey ? "LIVE" : "DEMO");
      setSettingsStatus("Key cleared. Paste a new key and Save.", "success");
      await refreshUsage();
    } catch (err) {
      setSettingsStatus(String(err), "error");
    } finally {
      settingsClearKey.disabled = false;
    }
  });
}
if (settingsResetLimit) {
  settingsResetLimit.addEventListener("click", async () => {
    if (!isTauri) {
      settingsLimitInput.value = "0.67";
      setSettingsStatus("Reset to default (not saved — click Save).", "");
      return;
    }
    settingsResetLimit.disabled = true;
    try {
      const config = await window.__TAURI__.core.invoke("clear_daily_limit");
      lastConfig = config;
      const v = Number(config?.dailyLimit);
      if (Number.isFinite(v) && v > 0) dailyLimit = v;
      settingsLimitInput.value = String(v);
      updateMeta();
      drawChart();
      updateSettingsHint(config);
      setSettingsStatus("Daily limit reset to default.", "success");
    } catch (err) {
      setSettingsStatus(String(err), "error");
    } finally {
      settingsResetLimit.disabled = false;
    }
  });
}
if (settingsSave) {
  settingsSave.addEventListener("click", async () => {
    if (!isTauri) {
      const v = Number(settingsLimitInput.value);
      if (Number.isFinite(v) && v > 0) {
        dailyLimit = v;
        updateMeta();
        drawChart();
        setSettingsStatus("Saved (browser preview only).", "success");
        setTimeout(closeSettings, 700);
      } else {
        setSettingsStatus("Daily limit must be a positive number.", "error");
      }
      return;
    }
    const rawKey = settingsKeyInput.value.trim();
    const rawLimit = settingsLimitInput.value.trim();
    // Empty key -> null means "keep existing stored key"
    const keyToSend = rawKey === "" ? null : rawKey;
    let limitToSend = null;
    if (rawLimit !== "") {
      const n = Number(rawLimit);
      if (!Number.isFinite(n) || n <= 0) {
        setSettingsStatus("Daily limit must be a positive number.", "error");
        return;
      }
      limitToSend = n;
    } else {
      // Empty limit -> keep existing? But UX expects saving empty means keep.
      limitToSend = null;
    }

    settingsSave.disabled = true;
    settingsSave.textContent = "Saving…";
    try {
      const config = await window.__TAURI__.core.invoke("save_settings", {
        key: keyToSend,
        daily_limit: limitToSend,
      });
      lastConfig = config;
      const v = Number(config?.dailyLimit);
      if (Number.isFinite(v) && v > 0) dailyLimit = v;
      updateMeta();
      drawChart();
      updateSettingsHint(config);
      setSettingsStatus(
        keyToSend === null && limitToSend === null
          ? "No changes to save."
          : "Saved. Refreshing data…",
        "success"
      );
      await refreshUsage();
      if (config?.hasApiKey) {
        setTimeout(closeSettings, 600);
      }
    } catch (err) {
      setSettingsStatus(String(err), "error");
    } finally {
      settingsSave.disabled = false;
      settingsSave.textContent = "Save";
    }
  });
}

async function loadConfig() {
  if (!isTauri) {
    return null;
  }

  try {
    const config = await window.__TAURI__.core.invoke("get_app_config");
    lastConfig = config;

    const configuredLimit = Number(config?.dailyLimit);
    if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
      dailyLimit = configuredLimit;
    }

    if (settingsLimitInput) {
      settingsLimitInput.value = String(dailyLimit);
    }
    updateSettingsHint(config);

    if (!config?.hasApiKey) {
      setConnectionStatus("demo", "DEMO");
    } else {
      // hasApiKey true: actual LIVE/ERROR will be set by refreshUsage
    }

    return config;
  } catch (error) {
    console.error("Could not load app config:", error);
    return null;
  }
}

async function refreshUsage() {
  refreshButton.classList.add("loading");
  refreshButton.disabled = true;

  try {
    if (!isTauri) {
      spendingData = sanitizeRows(MOCK_DATA);
      setConnectionStatus("demo", "DEMO");
      updateMeta();
      drawChart();
      return;
    }

    const rows =
      await window.__TAURI__.core.invoke("get_usage");

    const sanitized = sanitizeRows(rows);

    if (sanitized.length === 0) {
      spendingData = [];
      setConnectionStatus("live", "LIVE");
    } else {
      spendingData = sanitized;
      setConnectionStatus("live", "LIVE");
    }
  } catch (error) {
    console.error("OpenRouter usage refresh failed:", error);

    spendingData = sanitizeRows(MOCK_DATA);

    const message = String(error || "");
    // Surface the actual backend error in the badge tooltip and in the settings modal if open
    const statusNode = document.getElementById("connectionStatus");
    if (statusNode) statusNode.title = message;
    if (settingsStatus && !settingsModal.hidden) {
      setSettingsStatus(message, "error");
    }

    if (
      message.includes("OPENROUTER_MANAGEMENT_KEY") ||
      message.includes("OPENROUTER_API_KEY")
    ) {
      setConnectionStatus("demo", "DEMO");
    } else {
      setConnectionStatus("error", "ERROR");
    }
  } finally {
    refreshButton.classList.remove("loading");
    refreshButton.disabled = false;

    updateMeta();
    drawChart();
  }
}

refreshButton.addEventListener("click", refreshUsage);

// Tray -> Refresh / Settings: backend emits events.
if (
  isTauri &&
  window.__TAURI__.event &&
  typeof window.__TAURI__.event.listen === "function"
) {
  window.__TAURI__.event
    .listen("usage-refresh", () => {
      refreshUsage();
    })
    .catch((error) => {
      console.error("Could not listen for tray refresh:", error);
    });

  window.__TAURI__.event
    .listen("open-settings", () => {
      openSettings();
    })
    .catch((error) => {
      console.error("Could not listen for open-settings:", error);
    });
}

window.addEventListener("resize", () => {
  tooltip.classList.remove("visible");
  hoveredIndex = -1;
  drawChart();
});

async function init() {
  document.documentElement.classList.toggle("tauri", isTauri);
  spendingData = sanitizeRows(MOCK_DATA);

  const config = await loadConfig();
  await refreshUsage();

  updateMeta();
  drawChart();

  // Auto-open settings on first run if no key is configured (discoverability).
  if (config && !config.hasApiKey) {
    openSettings();
  }
}

init();
})();
