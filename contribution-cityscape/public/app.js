import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const FALLBACK_DEFAULTS = {
  weights: { pullRequests: 10, reviews: 8, commits: 3 },
  commitDecay: "sqrt",
  dailyCommitCap: 25
};

const COLORS = {
  pr: 0x5b8def,
  review: 0xb57edc,
  commit: 0x4caf7d,
  neutral: 0x5f6675
};

const state = {
  weights: { P: 10, R: 8, C: 3 },
  commitDecay: "sqrt",
  commitCap: 25,
  dataset: {},
  currentUser: "",
  bars: []
};

const sceneRoot = document.getElementById("scene-root");
const tooltip = document.getElementById("tooltip");
const userSelect = document.getElementById("user-select");
const fileInput = document.getElementById("file-input");
const decaySelect = document.getElementById("commit-decay");
const capSlider = document.getElementById("commit-cap");
const capOut = document.getElementById("commit-cap-out");
const resetBtn = document.getElementById("reset-defaults");

const sliderP = document.getElementById("w-p");
const sliderR = document.getElementById("w-r");
const sliderC = document.getElementById("w-c");
const outP = document.getElementById("w-p-out");
const outR = document.getElementById("w-r-out");
const outC = document.getElementById("w-c-out");

const manualDate = document.getElementById("m-date");
const manualTotal = document.getElementById("m-total");
const manualPctP = document.getElementById("m-pct-p");
const manualPctR = document.getElementById("m-pct-r");
const manualPctC = document.getElementById("m-pct-c");
const manualAdd = document.getElementById("manual-add");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
sceneRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
scene.fog = new THREE.FogExp2(0x0a0d12, 0.02);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(38, 44, 38);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 12;
controls.maxDistance = 180;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const keyLight = new THREE.DirectionalLight(0xfff8ec, 0.75);
keyLight.position.set(22, 38, 24);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xe8a33d, 0.35);
rimLight.position.set(-24, 16, -12);
scene.add(rimLight);

const grid = new THREE.GridHelper(190, 73, 0x243145, 0x1b2433);
grid.position.y = 0;
scene.add(grid);

const barsGroup = new THREE.Group();
scene.add(barsGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const CELL = 2.6;
const GAP = 0.35;
const BASE_GEOMETRY = new THREE.BoxGeometry(CELL - GAP, 1, CELL - GAP);
const HEIGHT_SCALE = 0.27;

const materials = {
  pr: new THREE.MeshStandardMaterial({ color: COLORS.pr }),
  review: new THREE.MeshStandardMaterial({ color: COLORS.review }),
  commit: new THREE.MeshStandardMaterial({ color: COLORS.commit }),
  neutral: new THREE.MeshStandardMaterial({ color: COLORS.neutral })
};

function decay(commits) {
  const capped = Math.min(Math.max(0, Number(commits) || 0), state.commitCap);
  if (state.commitDecay === "log") return Math.log2(capped + 1);
  if (state.commitDecay === "linear") return capped;
  return Math.sqrt(capped);
}

function computeScore(entry) {
  const raw = {
    P: Math.max(0, Number(entry?.P) || 0),
    R: Math.max(0, Number(entry?.R) || 0),
    C: Math.max(0, Number(entry?.C) || 0)
  };

  const pScore = state.weights.P * raw.P;
  const rScore = state.weights.R * raw.R;
  const cScore = state.weights.C * decay(raw.C);
  const total = pScore + rScore + cScore;

  let dominant = "neutral";
  if (total > 0) {
    if (pScore >= rScore && pScore >= cScore) dominant = "pr";
    else if (rScore >= cScore) dominant = "review";
    else dominant = "commit";
  }

  return { pScore, rScore, cScore, total, dominant, raw };
}

function isoWeekInfo(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const dayOfWeek = (date.getUTCDay() + 6) % 7;

  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayOfWeek);

  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - dayOfWeek);

  const weekYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstThursdayDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - firstThursdayDow);

  const week = 1 + Math.round((thursday - firstThursday) / 604800000);

  return {
    week,
    dayOfWeek,
    weekStartMs: monday.getTime()
  };
}

function clearBars() {
  for (const child of barsGroup.children) {
    barsGroup.remove(child);
  }
  state.bars = [];
}

function recenterCameraTarget() {
  if (state.bars.length === 0) {
    controls.target.set(0, 0, 0);
    return;
  }

  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity
  };

  for (const bar of state.bars) {
    const halfW = (CELL - GAP) / 2;
    const x = bar.mesh.position.x;
    const z = bar.mesh.position.z;
    bounds.minX = Math.min(bounds.minX, x - halfW);
    bounds.maxX = Math.max(bounds.maxX, x + halfW);
    bounds.minZ = Math.min(bounds.minZ, z - halfW);
    bounds.maxZ = Math.max(bounds.maxZ, z + halfW);
  }

  controls.target.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
}

function buildBars() {
  clearBars();

  const userData = state.dataset?.[state.currentUser];
  const days = userData?.days;
  if (!days || typeof days !== "object") {
    tooltip.classList.add("hidden");
    return;
  }

  const entries = Object.entries(days).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    tooltip.classList.add("hidden");
    recenterCameraTarget();
    return;
  }

  const weekStarts = entries.map(([date]) => isoWeekInfo(date).weekStartMs);
  const minWeekStart = Math.min(...weekStarts);

  for (const [date, entry] of entries) {
    const score = computeScore(entry);
    if (score.total === 0) continue;

    const info = isoWeekInfo(date);
    const weekOffset = Math.round((info.weekStartMs - minWeekStart) / 604800000);
    const x = weekOffset * CELL;
    const z = info.dayOfWeek * CELL;
    const height = Math.max(0.15, score.total * HEIGHT_SCALE);

    const mesh = new THREE.Mesh(BASE_GEOMETRY, materials[score.dominant] || materials.neutral);
    mesh.scale.y = height;
    mesh.position.set(x, height / 2, z);
    mesh.userData = { date, entry, score };

    barsGroup.add(mesh);
    state.bars.push({ mesh, date, entry, score });
  }

  recenterCameraTarget();
}

function updateWeightOutputs() {
  outP.textContent = state.weights.P.toFixed(1);
  outR.textContent = state.weights.R.toFixed(1);
  outC.textContent = state.weights.C.toFixed(1);
  capOut.textContent = String(state.commitCap);
}

function syncControlsFromState() {
  sliderP.value = String(state.weights.P);
  sliderR.value = String(state.weights.R);
  sliderC.value = String(state.weights.C);
  decaySelect.value = state.commitDecay;
  capSlider.value = String(state.commitCap);
  updateWeightOutputs();
}

function applyDefaults(defaults) {
  state.weights.P = Number(defaults.weights?.pullRequests ?? FALLBACK_DEFAULTS.weights.pullRequests);
  state.weights.R = Number(defaults.weights?.reviews ?? FALLBACK_DEFAULTS.weights.reviews);
  state.weights.C = Number(defaults.weights?.commits ?? FALLBACK_DEFAULTS.weights.commits);
  state.commitDecay = defaults.commitDecay ?? FALLBACK_DEFAULTS.commitDecay;
  state.commitCap = Number(defaults.dailyCommitCap ?? FALLBACK_DEFAULTS.dailyCommitCap);
  syncControlsFromState();
}

async function loadDefaultsFromConfig() {
  try {
    const res = await fetch("../config.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Unable to load config.json");
    return await res.json();
  } catch {
    return FALLBACK_DEFAULTS;
  }
}

function populateUsers() {
  const users = Object.keys(state.dataset || {});
  userSelect.innerHTML = "";

  if (users.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No users loaded";
    userSelect.appendChild(option);
    state.currentUser = "";
    return;
  }

  for (const user of users) {
    const option = document.createElement("option");
    option.value = user;
    option.textContent = user;
    userSelect.appendChild(option);
  }

  if (!users.includes(state.currentUser)) {
    state.currentUser = users[0];
  }
  userSelect.value = state.currentUser;
}

function setTooltipHidden(hidden) {
  tooltip.classList.toggle("hidden", hidden);
}

function renderTooltip(bar, x, y) {
  const score = bar.score;
  tooltip.innerHTML = `
    <div class="date">${bar.date}</div>
    <div class="row"><span>PR (${score.raw.P})</span><span>${score.pScore.toFixed(2)}</span></div>
    <div class="row"><span>Review (${score.raw.R})</span><span>${score.rScore.toFixed(2)}</span></div>
    <div class="row"><span>Commit (${score.raw.C})</span><span>${score.cScore.toFixed(2)}</span></div>
    <div class="total"><span>Total</span><span>${score.total.toFixed(2)}</span></div>
  `;
  tooltip.style.left = `${x + 14}px`;
  tooltip.style.top = `${y + 14}px`;
  setTooltipHidden(false);
}

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const meshes = state.bars.map((bar) => bar.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];

  if (!hit) {
    setTooltipHidden(true);
    return;
  }

  const data = hit.object.userData;
  if (!data?.score) {
    setTooltipHidden(true);
    return;
  }

  renderTooltip(data, event.clientX, event.clientY);
}

function updateRangeFromDay(user, day) {
  const userData = state.dataset[user];
  if (!userData.range) {
    userData.range = { from: day, to: day };
    return;
  }
  if (!userData.range.from || day < userData.range.from) userData.range.from = day;
  if (!userData.range.to || day > userData.range.to) userData.range.to = day;
}

function wireEvents() {
  sliderP.addEventListener("input", () => {
    state.weights.P = Number(sliderP.value);
    updateWeightOutputs();
    buildBars();
  });

  sliderR.addEventListener("input", () => {
    state.weights.R = Number(sliderR.value);
    updateWeightOutputs();
    buildBars();
  });

  sliderC.addEventListener("input", () => {
    state.weights.C = Number(sliderC.value);
    updateWeightOutputs();
    buildBars();
  });

  decaySelect.addEventListener("change", () => {
    state.commitDecay = decaySelect.value;
    buildBars();
  });

  capSlider.addEventListener("input", () => {
    state.commitCap = Number(capSlider.value);
    updateWeightOutputs();
    buildBars();
  });

  resetBtn.addEventListener("click", async () => {
    const defaults = await loadDefaultsFromConfig();
    applyDefaults(defaults);
    buildBars();
  });

  userSelect.addEventListener("change", () => {
    state.currentUser = userSelect.value;
    buildBars();
  });

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      state.dataset = parsed && typeof parsed === "object" ? parsed : {};
      populateUsers();
      buildBars();
    } catch {
      alert("Could not parse JSON file.");
    }
  });

  manualAdd.addEventListener("click", () => {
    const date = manualDate.value;
    const user = state.currentUser;
    const total = Number(manualTotal.value);

    if (!date) {
      alert("Pick a date first.");
      return;
    }

    if (!user) {
      alert("Select a user first.");
      return;
    }

    if (!Number.isFinite(total) || total <= 0) {
      alert("Total contributions must be greater than 0.");
      return;
    }

    const pctP = Number(manualPctP.value) || 0;
    const pctR = Number(manualPctR.value) || 0;
    const pctC = Number(manualPctC.value) || 0;

    const P = Math.round(total * (pctP / 100));
    const R = Math.round(total * (pctR / 100));
    const C = Math.round(total * (pctC / 100));

    if (!state.dataset[user]) {
      state.dataset[user] = { range: { from: date, to: date }, days: {} };
    }
    if (!state.dataset[user].days || typeof state.dataset[user].days !== "object") {
      state.dataset[user].days = {};
    }

    state.dataset[user].days[date] = { P, R, C };
    updateRangeFromDay(user, date);
    buildBars();
  });

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerleave", () => setTooltipHidden(true));
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function init() {
  const defaults = await loadDefaultsFromConfig();
  applyDefaults(defaults);
  wireEvents();

  try {
    const res = await fetch("../data/sample-data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("sample data missing");
    const sample = await res.json();
    state.dataset = sample && typeof sample === "object" ? sample : {};
  } catch {
    state.dataset = {};
  }

  populateUsers();
  buildBars();
  animate();
}

init();
