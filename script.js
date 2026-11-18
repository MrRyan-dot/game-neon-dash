
import * as THREE from "three";

// ========================================
// NEON DASH — ULTIMATE PREMIUM EDITION
// ========================================

const SAVE_KEY = "neonDashSave";
const WIDTH = 900;
const HEIGHT = 420;
const GROUND_Y = -2.35;
const LANES = [-2.6, 0, 2.6];
const MAX_PARTICLES = 120;

const $ = id => document.getElementById(id);

const characters = [
  { name: "NEON RUNNER", emoji: "⚡", color: 0x35e8ff, price: 0, desc: "The original city sprinter." },
  { name: "CYBER NINJA", emoji: "🥷", color: 0xa16bff, price: 100, desc: "Silent, sharp, and lightning fast." },
  { name: "STREET REBEL", emoji: "🧑‍🎤", color: 0xff4fc8, price: 150, desc: "Made to break the city rules." },
  { name: "TECH SOLDIER", emoji: "🦾", color: 0x43f5ad, price: 200, desc: "Built for high-risk missions." },
  { name: "CYBER LEGEND", emoji: "👾", color: 0xffce5c, price: 250, desc: "A rare icon of the neon age." }
];

const modes = [
  { name: "EASY", speed: 0.18, gap: 2.2, gravity: 0.012, jump: 0.28 },
  { name: "NORMAL", speed: 0.24, gap: 1.8, gravity: 0.014, jump: 0.31 },
  { name: "HARD", speed: 0.31, gap: 1.5, gravity: 0.016, jump: 0.34 }
];

// ========================================
// SAVE SYSTEM
// ========================================

function loadSave() {
  const fallback = {
    coins: 0,
    best: 0,
    games: 0,
    selected: 0,
    unlocked: [0]
  };

  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");

    if (!raw || typeof raw !== "object") return fallback;

    const unlocked = Array.isArray(raw.unlocked)
      ? [...new Set(raw.unlocked.map(Number).filter(n =>
          Number.isInteger(n) && n >= 0 && n < characters.length
        ))]
      : [0];

    if (!unlocked.includes(0)) unlocked.unshift(0);

    const selected = Number(raw.selected);

    return {
      coins: Math.max(0, Number(raw.coins) || 0),
      best: Math.max(0, Number(raw.best) || 0),
      games: Math.max(0, Number(raw.games) || 0),
      selected: unlocked.includes(selected) ? selected : 0,
      unlocked
    };
  } catch {
    return fallback;
  }
}

let save = loadSave();

function saveData() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("Save failed:", error);
  }
}

// ========================================
// GLOBAL VARIABLES
// ========================================

let scene, camera, renderer, clock;
let player, cityGroup, roadGroup;
let obstacleGroup, coinGroup, powerGroup, starField;

let gameState = "menu";
let currentMode = 1;
let currentLane = 1;
let targetLaneX = LANES[1];

let score = 0;
let scoreProgress = 0;
let runCoins = 0;
let level = 1;
let speed = 1;
let elapsed = 0;

let spawnTimer = 0;
let coinTimer = 0;
let powerTimer = 0;
let hudTimer = 0;
let trailTimer = 0;

let playerY = 0;
let velocityY = 0;
let grounded = true;
let landingPulse = 0;
let cameraShake = 0;

let obstacles = [];
let coins = [];
let powerups = [];
let particles = [];

let activePowers = {
  shield: 0,
  magnet: 0,
  double: 0
};

let soundOn = true;
let audioContext = null;
let newRecord = false;
let animationStarted = false;

// ========================================
// SCREEN SYSTEM
// ========================================

const screens = ["menuScreen", "shopScreen", "gameScreen"];
const modals = ["pauseScreen", "gameOverScreen"];

function showScreen(id) {
  screens.forEach(name => {
    $(name).classList.toggle("active", name === id);
  });

  modals.forEach(name => {
    $(name).classList.remove("active");
  });
}

function showModal(id) {
  $(id).classList.add("active");
}

function hideModal(id) {
  $(id).classList.remove("active");
}

function updateWallet() {
  $("walletCoins").textContent = save.coins;
  $("menuCoins").textContent = save.coins;
  $("menuBest").textContent = save.best;
  $("menuGames").textContent = save.games;
  $("menuAvatar").textContent = characters[save.selected].emoji;
  $("menuCharacter").textContent = characters[save.selected].name;
  $("shopCoins").textContent = save.coins;
  $("bestScore").textContent = save.best;
}

// ========================================
// AUDIO SYSTEM
// ========================================

function tone(frequency = 440, duration = .08, type = "sine", volume = .035) {
  if (!soundOn) return;

  try {
    audioContext ||= new (
      window.AudioContext || window.webkitAudioContext
    )();

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(
      frequency,
      audioContext.currentTime
    );

    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      .001,
      audioContext.currentTime + duration
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {}
}

function playCoinSound() {
  tone(880, .07, "sine", .025);
  setTimeout(() => tone(1180, .08, "sine", .018), 45);
}

function playPowerSound() {
  tone(520, .12, "triangle", .035);
  setTimeout(() => tone(780, .16, "triangle", .025), 90);
}

function playHitSound() {
  tone(110, .2, "sawtooth", .045);
}

$("soundButton").addEventListener("click", () => {
  soundOn = !soundOn;

  $("soundButton").textContent = soundOn ? "♫" : "♪̸";
  $("soundButton").style.color =
    soundOn ? "var(--cyan)" : "var(--muted)";

  if (soundOn) tone(660);
});

// ========================================
// THREE.JS MATERIAL HELPERS
// ========================================

function material(color, emissive = color, intensity = .45, roughness = .55) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness,
    metalness: .35
  });
}

function makeBox(w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mat
  );

  mesh.position.set(x, y, z);
  return mesh;
}

function disposeObject(object) {
  object.traverse(child => {
    if (child.geometry) child.geometry.dispose();

    if (child.material) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      materials.forEach(mat => mat.dispose());
    }
  });
}

function clearGroup(group, items) {
  for (const item of items) {
    group.remove(item.mesh);
    disposeObject(item.mesh);
  }

  items.length = 0;
}

// ========================================
// PLAYER
// ========================================

function createPlayer() {
  const group = new THREE.Group();
  const color = characters[save.selected].color;

  const suit = material(color, color, 1.25);
  const dark = material(0x11162b, 0x26375e, .55);
  const visor = material(0xdafaff, 0x36e7ff, 2);
  const legs = material(0x202b4a, color, .75);

  const torso = makeBox(.72, .9, .48, suit, 0, .05, 0);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(.34, 20, 16),
    dark
  );

  head.position.set(0, .72, 0);

  group.add(torso, head);
  group.add(makeBox(.48, .12, .06, visor, 0, .75, .3));
  group.add(makeBox(.76, .13, .5, dark, 0, -.43, 0));

  const legL = makeBox(.23, .52, .28, legs, -.2, -.76, 0);
  const legR = makeBox(.23, .52, .28, legs, .2, -.76, 0);
  const armL = makeBox(.2, .58, .24, suit, -.48, .05, 0);
  const armR = makeBox(.2, .58, .24, suit, .48, .05, 0);

  group.add(legL, legR, armL, armR);

  const glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(.62, .025, 8, 40),
    material(color, color, 2)
  );

  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = -.95;
  group.add(glowRing);

  group.position.set(LANES[1], GROUND_Y + 1.05, 2);

  group.userData = {
    torso, head, legL, legR, armL, armR,
    glowRing,
    shield: null,
    shieldMaterial: null
  };

  return group;
}

function rebuildPlayer() {
  if (player) {
    scene.remove(player);
    disposeObject(player);
  }

  player = createPlayer();
  scene.add(player);
}

// ========================================
// BUILDING DETAILS
// ========================================

function addBuildingLights(building, color) {
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, .045, .04),
    material(color, color, 1.8)
  );

  glow.position.set(0, .2, 1.43);
  building.add(glow);

  for (let i = 0; i < 3; i++) {
    const windowMesh = new THREE.Mesh(
      new THREE.BoxGeometry(.25, .45, .035),
      material(0x6f8dff, color, .7)
    );

    windowMesh.position.set(-.55 + i * .55, -.35, 1.44);
    building.add(windowMesh);
  }
}

// ========================================
// INITIALIZE THREE.JS
// ========================================

function initThree() {
  if (renderer) return;

  const viewport = $("gameViewport");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080d20);
  scene.fog = new THREE.Fog(0x080d20, 18, 75);

  camera = new THREE.PerspectiveCamera(52, WIDTH / HEIGHT, .1, 120);
  camera.position.set(0, 4.8, 13.8);
  camera.lookAt(0, -.5, -7);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = false;

  renderer.domElement.setAttribute(
    "aria-label",
    "NEON DASH game view"
  );

  viewport.prepend(renderer.domElement);
  $("loadingMessage").style.display = "none";

  scene.add(new THREE.HemisphereLight(0x8eacff, 0x111020, 2.1));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
  keyLight.position.set(-5, 10, 7);
  scene.add(keyLight);

  const cyanLight = new THREE.PointLight(0x28dcff, 30, 24);
  cyanLight.position.set(-5, 3, -4);
  scene.add(cyanLight);

  const pinkLight = new THREE.PointLight(0xff3bbd, 25, 22);
  pinkLight.position.set(5, 2, -9);
  scene.add(pinkLight);

  cityGroup = new THREE.Group();
  roadGroup = new THREE.Group();
  obstacleGroup = new THREE.Group();
  coinGroup = new THREE.Group();
  powerGroup = new THREE.Group();

  scene.add(
    cityGroup,
    roadGroup,
    obstacleGroup,
    coinGroup,
    powerGroup
  );

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 100),
    material(0x10152b, 0x080d20, .3)
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y - .12, -35);
  roadGroup.add(ground);

  const road = makeBox(
    10, .12, 100,
    material(0x10172d, 0x121a3d, .4),
    0, GROUND_Y - .03, -35
  );

  roadGroup.add(road);

  // City buildings
  for (let i = 0; i < 24; i++) {
    const z = -i * 4.2 - 2;
    const leftHeight = 2 + Math.random() * 9;
    const rightHeight = 2 + Math.random() * 10;

    const left = makeBox(
      2.8, leftHeight, 2.8,
      material(0x172044, 0x132d69, .5),
      -8.2, GROUND_Y + leftHeight / 2, z
    );

    const right = makeBox(
      2.8, rightHeight, 2.8,
      material(0x20183d, 0x4b176e, .5),
      8.2, GROUND_Y + rightHeight / 2, z - 1.5
    );

    cityGroup.add(left, right);
    addBuildingLights(left, 0x35e8ff);
    addBuildingLights(right, 0xff4fc8);
  }

  // Road stripes
  for (let i = 0; i < 34; i++) {
    const stripe = makeBox(
      .055, .025, 1.5,
      material(0x36e7ff, 0x36e7ff, 2),
      (i % 2 ? -1 : 1) * 1.7,
      GROUND_Y + .055,
      -i * 3.2
    );

    roadGroup.add(stripe);
  }

  // Road borders
  for (const x of [-4.95, 4.95]) {
    roadGroup.add(makeBox(
      .06, .04, 100,
      material(0x36e7ff, 0x36e7ff, 2),
      x, GROUND_Y + .06, -35
    ));
  }

  // Stars
  const positions = [];

  for (let i = 0; i < 260; i++) {
    positions.push(
      (Math.random() - .5) * 70,
      Math.random() * 23 - 1,
      -Math.random() * 90
    );
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );

  starField = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0x9acfff,
      size: .09,
      transparent: true,
      opacity: .8
    })
  );

  scene.add(starField);

  player = createPlayer();
  scene.add(player);

  clock = new THREE.Clock();

  window.addEventListener("resize", resizeRenderer);

  resizeRenderer();

  if (!animationStarted) {
    animationStarted = true;
    animate();
  }
}

// ========================================
// RESIZE
// ========================================

function resizeRenderer() {
  if (!renderer) return;

  const viewport = $("gameViewport");
  const width = viewport.clientWidth || WIDTH;
  const height = Math.max(220, Math.round(width * HEIGHT / WIDTH));

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// ========================================
// PARTICLE SYSTEM
// ========================================

function addParticle(mesh, velocity, life, spin = 0) {
  if (particles.length >= MAX_PARTICLES) {
    scene.remove(mesh);
    disposeObject(mesh);
    return;
  }

  scene.add(mesh);

  particles.push({
    mesh,
    velocity,
    life,
    maxLife: life,
    spin
  });
}

function createBurst(position, color, count = 12) {
  const amount = Math.min(count, MAX_PARTICLES - particles.length);

  for (let i = 0; i < amount; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(.045 + Math.random() * .04, 6, 6),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1
      })
    );

    mesh.position.copy(position);

    const velocity = new THREE.Vector3(
      (Math.random() - .5) * 5,
      (Math.random() - .5) * 5,
      (Math.random() - .5) * 3
    );

    addParticle(mesh, velocity, .55 + Math.random() * .3);
  }
}

function createRingEffect(position, color, size = .3) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(size, .025, 6, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: .9
    })
  );

  ring.position.copy(position);
  ring.rotation.x = Math.PI / 2;

  addParticle(
    ring,
    new THREE.Vector3(0, .4, 0),
    .42,
    2
  );
}

function createCoinEffect(position) {
  createBurst(position, 0xffd66b, 14);
  createRingEffect(position, 0xffd66b, .25);
}

function createLandingEffect() {
  const color = characters[save.selected].color;

  createRingEffect(
    new THREE.Vector3(
      player.position.x,
      GROUND_Y + .08,
      player.position.z
    ),
    color,
    .35
  );

  createBurst(
    new THREE.Vector3(
      player.position.x,
      GROUND_Y + .12,
      player.position.z
    ),
    color,
    7
  );
}

function createTrailParticle() {
  if (particles.length >= MAX_PARTICLES - 5) return;

  const color = characters[save.selected].color;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(.055, 7, 7),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: .65
    })
  );

  mesh.position.set(
    player.position.x + (Math.random() - .5) * .25,
    player.position.y - .2,
    player.position.z + .45
  );

  addParticle(
    mesh,
    new THREE.Vector3(
      (Math.random() - .5) * .3,
      -.15,
      .8
    ),
    .32
  );
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];

    particle.life -= dt;

    particle.mesh.position.addScaledVector(
      particle.velocity,
      dt
    );

    particle.velocity.y -= 3 * dt;

    if (particle.spin) {
      particle.mesh.rotation.z += particle.spin * dt;
    }

    const progress = Math.max(
      0,
      particle.life / particle.maxLife
    );

    particle.mesh.material.opacity = progress;
    particle.mesh.scale.setScalar(Math.max(.05, progress));

    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      disposeObject(particle.mesh);
      particles.splice(i, 1);
    }
  }
}

function clearParticles() {
  for (const particle of particles) {
    scene.remove(particle.mesh);
    disposeObject(particle.mesh);
  }

  particles.length = 0;
}

// ========================================
// SHOP
// ========================================

function renderShop() {
  $("shopCoins").textContent = save.coins;

  $("characterGrid").innerHTML = characters.map((character, index) => {
    const unlocked = save.unlocked.includes(index);
    const selected = save.selected === index;

    const action = selected
      ? "EQUIPPED"
      : unlocked
        ? "EQUIP RUNNER"
        : `UNLOCK · ${character.price} ◈`;

    return `
      <article class="character-card ${selected ? "selected" : ""}"
        style="--char-color:#${character.color.toString(16).padStart(6, "0")}">

        <div class="avatar">${character.emoji}</div>
        <h3>${character.name}</h3>
        <p>${character.desc}</p>

        <div class="price">
          ${unlocked ? "UNLOCKED" : `${character.price} COINS`}
        </div>

        <button type="button" data-character="${index}" ${selected ? "disabled" : ""}>
          ${action}
        </button>
      </article>
    `;
  }).join("");
}

$("characterGrid").addEventListener("click", event => {
  const button = event.target.closest("button[data-character]");
  if (!button) return;

  const index = Number(button.dataset.character);
  const character = characters[index];

  if (!character) return;

  if (save.unlocked.includes(index)) {
    save.selected = index;
  } else if (save.coins >= character.price) {
    save.coins -= character.price;
    save.unlocked.push(index);
    save.selected = index;
  } else {
    button.textContent =
      `NEED ${character.price - save.coins} MORE COINS`;

    tone(160, .12, "square");
    return;
  }

  saveData();
  updateWallet();
  renderShop();
  tone(720, .1, "triangle");
});

// ========================================
// OBSTACLES
// ========================================

function createObstacle() {
  const group = new THREE.Group();
  const color = Math.random() > .5 ? 0xff3f91 : 0x9b72ff;

  group.add(
    makeBox(.9, 1.25, .85, material(0x1c1734, color, 1.4), 0, .62, 0),
    makeBox(1.08, .12, .95, material(color, color, 2), 0, 1.28, 0),
    makeBox(.08, .95, .92, material(color, color, 1.8), -.49, .65, 0)
  );

  const lane = Math.floor(Math.random() * 3);

  group.position.set(LANES[lane], GROUND_Y, -43);
  obstacleGroup.add(group);

  obstacles.push({
    mesh: group,
    passed: false
  });
}

// ========================================
// COINS
// ========================================

function createCoin() {
  const group = new THREE.Group();

  const coin = new THREE.Mesh(
    new THREE.TorusGeometry(.28, .085, 10, 24),
    material(0xffd66b, 0xffb52e, 2)
  );

  coin.rotation.y = Math.PI / 2;

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(.09, 12, 10),
    material(0xfff1b0, 0xffd66b, 1.8)
  );

  group.add(coin, center);

  const lane = Math.floor(Math.random() * 3);

  group.position.set(
    LANES[lane],
    GROUND_Y + 1.05 + Math.random() * 1.1,
    -38
  );

  coinGroup.add(group);
  coins.push({ mesh: group });
}

// ========================================
// POWER-UPS
// ========================================

function createPowerup() {
  const group = new THREE.Group();

  const colors = [0x36e7ff, 0x55f2b2, 0xff4fc8];
  const types = ["shield", "magnet", "double"];

  const index = Math.floor(Math.random() * types.length);
  const color = colors[index];

  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(.42, 0),
    material(color, color, 2.5)
  );

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(.58, .035, 8, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: .9
    })
  );

  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(.72, 16, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: .12,
      side: THREE.DoubleSide
    })
  );

  ring.rotation.x = Math.PI / 2;
  group.add(gem, ring, aura);

  group.userData = {
    gem,
    ring,
    aura,
    phase: Math.random() * Math.PI * 2
  };

  const lane = Math.floor(Math.random() * 3);

  group.position.set(LANES[lane], GROUND_Y + 1.2, -44);

  powerGroup.add(group);
  powerups.push({
    mesh: group,
    type: types[index]
  });
}

// ========================================
// SHIELD VISUAL
// ========================================

function updateShieldVisual() {
  if (!player) return;

  const parts = player.userData;

  if (activePowers.shield > 0 && !parts.shield) {
    const shieldGroup = new THREE.Group();

    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x36e7ff,
      wireframe: true,
      transparent: true,
      opacity: .42
    });

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(.9, 18, 14),
      shieldMaterial
    );

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(.92, .025, 6, 32),
      new THREE.MeshBasicMaterial({
        color: 0x36e7ff,
        transparent: true,
        opacity: .8
      })
    );

    ring.rotation.x = Math.PI / 2;
    shieldGroup.add(shield, ring);

    shieldGroup.position.y = .1;
    player.add(shieldGroup);

    parts.shield = shieldGroup;
    parts.shieldMaterial = shieldMaterial;
  }

  if (activePowers.shield <= 0 && parts.shield) {
    player.remove(parts.shield);
    disposeObject(parts.shield);

    parts.shield = null;
    parts.shieldMaterial = null;
  }

  if (parts.shield) {
    parts.shield.rotation.y += .035;
    parts.shield.rotation.x += .012;

    parts.shieldMaterial.opacity =
      .3 + Math.sin(elapsed * 8) * .12;

    const pulse = 1 + Math.sin(elapsed * 7) * .035;
    parts.shield.scale.setScalar(pulse);
  }
}

// ========================================
// HUD
// ========================================

function updateHUD() {
  $("score").textContent = score;
  $("bestScore").textContent = Math.max(save.best, score);
  $("runCoins").textContent = runCoins;
  $("level").textContent = String(level).padStart(2, "0");
  $("speed").textContent = `${speed.toFixed(1)}x`;
}

function updatePowerUI() {
  $("powerIndicators").innerHTML =
    Object.entries(activePowers).map(([key, value]) => `
      <span class="power-pill ${value > 0 ? "active" : ""}">
        ${key.toUpperCase()}
        ${value > 0 ? `${Math.ceil(value)}s` : "—"}
      </span>
    `).join("");
}

// ========================================
// START / RESET GAME
// ========================================

function startGame() {
  initThree();

  hideModal("pauseScreen");
  hideModal("gameOverScreen");

  gameState = "running";

  score = 0;
  scoreProgress = 0;
  runCoins = 0;
  level = 1;
  speed = 1;
  elapsed = 0;

  hudTimer = 0;
  trailTimer = 0;
  landingPulse = 0;
  cameraShake = 0;

  spawnTimer = 1.3;
  coinTimer = .8;
  powerTimer = 7;

  velocityY = 0;
  grounded = true;
  playerY = 0;

  currentLane = 1;
  targetLaneX = LANES[1];

  activePowers = {
    shield: 0,
    magnet: 0,
    double: 0
  };

  clearGroup(obstacleGroup, obstacles);
  clearGroup(coinGroup, coins);
  clearGroup(powerGroup, powerups);
  clearParticles();

  rebuildPlayer();

  camera.position.set(0, 4.8, 13.8);
  camera.lookAt(0, -.5, -7);

  updateHUD();
  updatePowerUI();
  updateShieldVisual();

  $("gameStatus").textContent = "● RUNNING";
  $("gameModeHint").textContent = `${modes[currentMode].name} MODE`;
  $("gameModeLabel").textContent = `${modes[currentMode].name} ↻`;

  showScreen("gameScreen");

  resizeRenderer();
  clock.getDelta();

  tone(520, .09, "triangle");
}

// ========================================
// PAUSE / RESUME / EXIT
// ========================================

function pauseGame() {
  if (gameState !== "running") return;

  gameState = "paused";
  $("gameStatus").textContent = "Ⅱ PAUSED";

  showModal("pauseScreen");
  tone(300, .1, "triangle");
}

function resumeGame() {
  if (gameState !== "paused") return;

  gameState = "running";

  hideModal("pauseScreen");
  $("gameStatus").textContent = "● RUNNING";

  clock.getDelta();
  tone(520, .08, "triangle");
}

function exitToMenu() {
  if (gameState === "running" || gameState === "paused") {
    gameState = "menu";
  }

  hideModal("pauseScreen");
  hideModal("gameOverScreen");

  showScreen("menuScreen");
  updateWallet();
}

// ========================================
// JUMP / LANE MOVEMENT
// ========================================

function jump() {
  if (gameState !== "running" || !grounded) return;

  velocityY = modes[currentMode].jump;
  grounded = false;

  tone(390, .08, "square", .025);
}

function moveLane(direction) {
  if (gameState !== "running") return;

  const nextLane = Math.max(
    0,
    Math.min(2, currentLane + direction)
  );

  if (nextLane === currentLane) return;

  currentLane = nextLane;
  targetLaneX = LANES[currentLane];

  tone(560, .045, "triangle", .018);
}

// ========================================
// GAME OVER
// ========================================

function endGame() {
  if (gameState !== "running") return;

  gameState = "over";

  newRecord = score > save.best;

  if (newRecord) save.best = score;

  save.coins += runCoins;
  save.games += 1;

  saveData();
  updateWallet();

  $("finalScore").textContent = score;
  $("finalCoins").textContent = runCoins;
  $("finalBest").textContent = save.best;
  $("finalLevel").textContent = level;

  $("newRecordMessage").classList.toggle("hidden", !newRecord);
  $("gameStatus").textContent = "● RUN COMPLETE";

  showModal("gameOverScreen");

  if (newRecord) {
    tone(660, .15, "triangle");
    setTimeout(() => tone(880, .2, "triangle"), 120);
  } else {
    playHitSound();
  }
}

// ========================================
// MAIN GAME UPDATE
// ========================================

function updateGame(delta) {
  if (gameState !== "running") return;

  const dt = Math.min(delta, .04);
  elapsed += dt;

  const mode = modes[currentMode];

  // Score and level
  scoreProgress += dt * 10 * (
    activePowers.double > 0 ? 2 : 1
  );

  const earnedScore = Math.floor(scoreProgress);

  if (earnedScore > 0) {
    score += earnedScore;
    scoreProgress -= earnedScore;
  }

  level = 1 + Math.floor(score / 250);
  speed = 1 + Math.min(2.4, score / 850);

  const travel = mode.speed * speed * 60 * dt;

  // Jump physics
  const wasGrounded = grounded;

  if (!grounded) {
    velocityY -= mode.gravity * 60 * dt;
    playerY += velocityY * 60 * dt;

    if (playerY <= 0) {
      playerY = 0;
      velocityY = 0;
      grounded = true;
    }
  }

  if (!wasGrounded && grounded) {
    landingPulse = 1;
    createLandingEffect();
    tone(180, .08, "triangle", .025);
  }

  // Lane movement
  player.position.x +=
    (targetLaneX - player.position.x) * Math.min(1, dt * 12);

  player.position.y = GROUND_Y + 1.05 + playerY;

  // Character animation
  const parts = player.userData;
  const runCycle = Math.sin(elapsed * 13);
  const runAmount = grounded ? 1 : .15;

  parts.legL.rotation.x = runCycle * .48 * runAmount;
  parts.legR.rotation.x = -runCycle * .48 * runAmount;

  parts.armL.rotation.x = -runCycle * .3 * runAmount;
  parts.armR.rotation.x = runCycle * .3 * runAmount;

  parts.torso.rotation.x = grounded
    ? Math.sin(elapsed * 13) * .035
    : -.12;

  parts.torso.position.y = .05 + (
    grounded ? Math.abs(runCycle) * .035 : .08
  );

  parts.head.rotation.z = grounded
    ? Math.sin(elapsed * 6) * .035
    : -.08;

  parts.glowRing.rotation.z += dt * 1.8;

  const ringPulse = 1 + Math.sin(elapsed * 8) * .06;
  parts.glowRing.scale.setScalar(ringPulse);

  player.rotation.z = grounded
    ? Math.sin(elapsed * 8) * .025
    : -.08;

  // Landing squash
  landingPulse = Math.max(0, landingPulse - dt * 3.5);

  player.scale.set(
    1 + landingPulse * .12,
    1 - landingPulse * .16,
    1 + landingPulse * .12
  );

  // Trail
  trailTimer += dt;

  if (trailTimer >= .055) {
    trailTimer = 0;
    createTrailParticle();
  }

  // Spawn objects
  spawnTimer -= dt;
  coinTimer -= dt;
  powerTimer -= dt;

  if (spawnTimer <= 0) {
    createObstacle();

    spawnTimer =
      Math.max(.85, mode.gap - Math.min(.45, score / 3000)) +
      Math.random() * .5;
  }

  if (coinTimer <= 0) {
    createCoin();
    coinTimer = .55 + Math.random() * .65;
  }

  if (powerTimer <= 0) {
    createPowerup();
    powerTimer = 10 + Math.random() * 7;
  }

  // Obstacle collision
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const item = obstacles[i];

    item.mesh.position.z += travel;

    if (item.mesh.position.z > 5) {
      if (!item.passed) {
        score += 8;
        item.passed = true;
      }

      obstacleGroup.remove(item.mesh);
      disposeObject(item.mesh);
      obstacles.splice(i, 1);
      continue;
    }

    const closeZ =
      Math.abs(item.mesh.position.z - player.position.z) < .8;

    const closeX =
      Math.abs(item.mesh.position.x - player.position.x) < .85;

    if (closeZ && closeX && playerY < .65) {
      if (activePowers.shield > 0) {
        createBurst(item.mesh.position, 0x36e7ff, 15);
        createRingEffect(item.mesh.position, 0x36e7ff, .55);

        obstacleGroup.remove(item.mesh);
        disposeObject(item.mesh);
        obstacles.splice(i, 1);

        activePowers.shield = 0;
        cameraShake = .35;

        updateShieldVisual();
        tone(760, .12, "triangle");
        continue;
      }

      createBurst(player.position, 0xff4fc8, 12);
      endGame();
      return;
    }
  }

  // Coin movement and collection
  for (let i = coins.length - 1; i >= 0; i--) {
    const item = coins[i];

    item.mesh.position.z += travel;
    item.mesh.rotation.y += dt * 3;
    item.mesh.rotation.x = Math.sin(elapsed * 4) * .12;

    if (activePowers.magnet > 0 && item.mesh.position.z > -8) {
      item.mesh.position.x +=
        (player.position.x - item.mesh.position.x) *
        Math.min(1, dt * 7);

      item.mesh.position.y +=
        (player.position.y - item.mesh.position.y) *
        Math.min(1, dt * 7);
    }

    const close =
      Math.abs(item.mesh.position.z - player.position.z) < .8 &&
      Math.abs(item.mesh.position.x - player.position.x) < .85 &&
      Math.abs(item.mesh.position.y - player.position.y) < 1;

    if (close) {
      runCoins += 1;
      score += 5;

      createCoinEffect(item.mesh.position);

      coinGroup.remove(item.mesh);
      disposeObject(item.mesh);
      coins.splice(i, 1);

      playCoinSound();
      continue;
    }

    if (item.mesh.position.z > 5) {
      coinGroup.remove(item.mesh);
      disposeObject(item.mesh);
      coins.splice(i, 1);
    }
  }

  // Power-up movement and collection
  for (let i = powerups.length - 1; i >= 0; i--) {
    const item = powerups[i];

    item.mesh.position.z += travel;

    const visual = item.mesh.userData;

    item.mesh.rotation.y += dt * 1.8;
    visual.gem.rotation.y -= dt * 2.5;
    visual.ring.rotation.z += dt * 1.8;

    visual.phase += dt * 3;

    visual.aura.scale.setScalar(
      1 + Math.sin(visual.phase) * .12
    );

    visual.aura.material.opacity =
      .08 + (Math.sin(visual.phase) + 1) * .035;

    item.mesh.position.y =
      GROUND_Y + 1.2 + Math.sin(elapsed * 3 + i) * .13;

    const close =
      Math.abs(item.mesh.position.z - player.position.z) < .8 &&
      Math.abs(item.mesh.position.x - player.position.x) < .9 &&
      Math.abs(item.mesh.position.y - player.position.y) < 1.1;

    if (close) {
      activePowers[item.type] = 8;

      createBurst(item.mesh.position, 0x55f2b2, 15);
      createRingEffect(item.mesh.position, 0x55f2b2, .6);

      powerGroup.remove(item.mesh);
      disposeObject(item.mesh);
      powerups.splice(i, 1);

      updatePowerUI();
      playPowerSound();
      continue;
    }

    if (item.mesh.position.z > 5) {
      powerGroup.remove(item.mesh);
      disposeObject(item.mesh);
      powerups.splice(i, 1);
    }
  }

  // Power timers
  for (const key of Object.keys(activePowers)) {
    activePowers[key] = Math.max(
      0,
      activePowers[key] - dt
    );
  }

  updateShieldVisual();

  // Road animation
  roadGroup.children.forEach(mesh => {
    if (mesh.geometry?.parameters?.depth === 1.5) {
      mesh.position.z += travel;

      if (mesh.position.z > 5) {
        mesh.position.z -= 34 * 3.2;
      }
    }
  });

  // City animation
  cityGroup.children.forEach(mesh => {
    mesh.position.z += travel * .55;

    if (mesh.position.z > 7) {
      mesh.position.z -= 24 * 4.2;
    }
  });

  // Stars
  starField.position.z += travel * .15;

  if (starField.position.z > 5) {
    starField.position.z = 0;
  }

  // Dynamic camera
  const cameraTargetX = player.position.x * .12;

  const cameraTargetY =
    4.8 +
    Math.min(speed - 1, 2.4) * .12 +
    playerY * .08;

  cameraShake = Math.max(0, cameraShake - dt);

  camera.position.x +=
    (cameraTargetX - camera.position.x) *
    Math.min(1, dt * 2.5);

  camera.position.y +=
    (cameraTargetY - camera.position.y) *
    Math.min(1, dt * 2.5);

  camera.position.x +=
    (Math.random() - .5) * cameraShake * .12;

  camera.position.y +=
    (Math.random() - .5) * cameraShake * .12;

  camera.lookAt(
    player.position.x * .08,
    -.5 + playerY * .05,
    -7
  );

  // Particles update only during active gameplay
  updateParticles(dt);

  // HUD refresh
  hudTimer += dt;

  if (hudTimer >= .15) {
    hudTimer = 0;
    updateHUD();
    updatePowerUI();
  }
}

// ========================================
// ANIMATION LOOP
// ========================================

function animate() {
  requestAnimationFrame(animate);

  const delta = clock ? clock.getDelta() : .016;

  // Pause and game-over freeze gameplay and particles
  if (gameState === "running") {
    updateGame(delta);
  }

  if (renderer && scene) {
    renderer.render(scene, camera);
  }
}

// ========================================
// DIFFICULTY
// ========================================

function changeMode() {
  currentMode = (currentMode + 1) % modes.length;

  $("gameModeLabel").textContent =
    `${modes[currentMode].name} ↻`;

  $("gameModeHint").textContent =
    `${modes[currentMode].name} MODE`;

  tone(500 + currentMode * 100, .08);
}

$("gameModeLabel").addEventListener("click", changeMode);

// ========================================
// NAVIGATION
// ========================================

$("playButton").addEventListener("click", startGame);

$("shopButton").addEventListener("click", () => {
  renderShop();
  showScreen("shopScreen");
});

$("changeCharacterButton").addEventListener("click", () => {
  renderShop();
  showScreen("shopScreen");
});

$("shopBack").addEventListener("click", () => {
  showScreen("menuScreen");
});

$("gameOverMenuButton").addEventListener("click", exitToMenu);
$("pauseQuitButton").addEventListener("click", exitToMenu);

$("resumeButton").addEventListener("click", resumeGame);
$("pauseButton").addEventListener("click", pauseGame);

$("quitButton").addEventListener("click", () => {
  if (gameState === "running") exitToMenu();
});

$("restartButton").addEventListener("click", startGame);
$("retryButton").addEventListener("click", startGame);

// ========================================
// MOBILE JUMP
// ========================================

$("mobileJump").addEventListener("pointerdown", event => {
  event.preventDefault();
  jump();
});

// ========================================
// KEYBOARD CONTROLS
// ========================================

window.addEventListener("keydown", event => {
  if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
    if (gameState === "running") {
      event.preventDefault();
      jump();
    }
  }

  if (["ArrowLeft", "KeyA"].includes(event.code)) {
    if (gameState === "running") {
      event.preventDefault();
      moveLane(-1);
    }
  }

  if (["ArrowRight", "KeyD"].includes(event.code)) {
    if (gameState === "running") {
      event.preventDefault();
      moveLane(1);
    }
  }

  if (event.code === "KeyP" || event.code === "Escape") {
    if (gameState === "running") pauseGame();
    else if (gameState === "paused") resumeGame();
  }
});

// ========================================
// MOBILE SWIPE CONTROLS
// ========================================

const gameViewport = $("gameViewport");

let touchStartX = 0;
let touchStartY = 0;
let pointerActive = false;

gameViewport.addEventListener("pointerdown", event => {
  if (gameState !== "running" || !event.isPrimary) return;
  if (event.target.closest("button")) return;

  pointerActive = true;
  touchStartX = event.clientX;
  touchStartY = event.clientY;

  gameViewport.setPointerCapture?.(event.pointerId);
});

gameViewport.addEventListener("pointerup", event => {
  if (!pointerActive || gameState !== "running") {
    pointerActive = false;
    return;
  }

  pointerActive = false;

  const deltaX = event.clientX - touchStartX;
  const deltaY = event.clientY - touchStartY;
  const threshold = 35;

  if (
    Math.abs(deltaX) < threshold &&
    Math.abs(deltaY) < threshold
  ) {
    jump();
    return;
  }

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    moveLane(deltaX < 0 ? -1 : 1);
  } else if (deltaY < -threshold) {
    jump();
  }
});

gameViewport.addEventListener("pointercancel", () => {
  pointerActive = false;
});

// ========================================
// INITIAL SETUP
// ========================================

updateWallet();
renderShop();

initThree();
showScreen("menuScreen");
