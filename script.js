let audioCtx;
let sourceNode;
let playing = false;
let reverseMode = false;
let playbackRate = 1.0;
let audioBuffer = null;

let gainNode;
let biquadShelf;
let wowGain;
let wowOsc;
let wowDelay;
let waveshaper;

function makeSaturationCurve(amount = 2.0, n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x);
  }
  return curve;
}

function setupAudioGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  biquadShelf = audioCtx.createBiquadFilter();
  biquadShelf.type = "lowshelf";
  biquadShelf.frequency.value = 200;
  biquadShelf.gain.value = 3;

  const highCut = audioCtx.createBiquadFilter();
  highCut.type = "lowpass";
  highCut.frequency.value = 8000;

  waveshaper = audioCtx.createWaveShaper();
  waveshaper.curve = makeSaturationCurve(2.5);
  waveshaper.oversample = "2x";

  wowDelay = audioCtx.createDelay();
  wowDelay.delayTime.value = 0.005;

  wowGain = audioCtx.createGain();
  wowGain.gain.value = 0.002;

  wowOsc = audioCtx.createOscillator();
  wowOsc.type = "sine";
  wowOsc.frequency.value = 0.6;
  wowOsc.connect(wowGain);
  wowGain.connect(wowDelay.delayTime);
  wowOsc.start();

  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.8;

  waveshaper.connect(biquadShelf);
  biquadShelf.connect(highCut);
  highCut.connect(wowDelay);
  wowDelay.connect(gainNode);
  gainNode.connect(audioCtx.destination);
}

function startSource(playRev = false) {
  if (!audioBuffer || !audioCtx) return;

  if (sourceNode) {
    try {
      sourceNode.stop();
    } catch (e) {
      // ignore
    }
  }

  sourceNode = audioCtx.createBufferSource();

  if (playRev) {
    const revBuffer = audioCtx.createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
      const data = audioBuffer.getChannelData(ch);
      const revData = revBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i += 1) {
        revData[i] = data[data.length - 1 - i];
      }
    }
    sourceNode.buffer = revBuffer;
  } else {
    sourceNode.buffer = audioBuffer;
  }

  sourceNode.playbackRate.value = playbackRate;
  sourceNode.loop = true;
  sourceNode.connect(waveshaper);
  sourceNode.start();
}

function stopSource() {
  if (sourceNode) {
    try {
      sourceNode.stop();
    } catch (e) {
      // ignore
    }
    sourceNode = null;
  }
}

const btnPlay = document.getElementById("btnPlay");
const btnStop = document.getElementById("btnStop");
const btnReverse = document.getElementById("btnReverse");
const speedRange = document.getElementById("speedRange");
const speedVal = document.getElementById("speedVal");
const statusText = document.getElementById("statusText");
const dirText = document.getElementById("dirText");
const fileInput = document.getElementById("fileInput");
const sampleName = document.getElementById("sampleName");

function updateTransportUI() {
  btnPlay.dataset.state = playing && !reverseMode ? "active" : "";
  btnReverse.dataset.state = playing && reverseMode ? "active" : "";
  btnStop.dataset.state = !playing ? "active" : "";

  statusText.innerHTML =
    'status: <span style="color:var(--accent)">' +
    (playing ? "playing" : "stopped") +
    "</span>";
  dirText.textContent = reverseMode ? "← rev" : "→ fwd";
}

btnPlay.addEventListener("click", () => {
  setupAudioGraph();
  reverseMode = false;
  playing = true;
  startSource(false);
  updateTransportUI();
});

btnReverse.addEventListener("click", () => {
  setupAudioGraph();
  reverseMode = true;
  playing = true;
  startSource(true);
  updateTransportUI();
});

btnStop.addEventListener("click", () => {
  playing = false;
  stopSource();
  updateTransportUI();
});

speedRange.addEventListener("input", () => {
  playbackRate = parseFloat(speedRange.value);
  speedVal.textContent = playbackRate.toFixed(2);
  if (sourceNode) {
    sourceNode.playbackRate.value = playbackRate;
  }
});

fileInput.addEventListener("change", async (e) => {
  const [file] = e.target.files;
  if (!file) return;
  sampleName.textContent = file.name;
  setupAudioGraph();
  const arrayBuf = await file.arrayBuffer();
  audioCtx.decodeAudioData(arrayBuf).then((buf) => {
    audioBuffer = buf;
    if (playing) {
      startSource(reverseMode);
      updateTransportUI();
    }
  });
});

const svg = document.getElementById("cassetteSVG");
const leftReel = document.getElementById("leftReel");
const rightReel = document.getElementById("rightReel");
const tapePathEl = document.getElementById("tapePath");
const sprocketLayer = document.getElementById("sprocketLayer");

let sprockets = [
  { x: 275, y: 130, fixed: true },
  { x: 525, y: 130, fixed: true },
];

let lastTime = null;
let leftAngle = 0;
let rightAngle = 0;

function animateReels(ts) {
  if (lastTime === null) lastTime = ts;
  const dt = (ts - lastTime) / 1000;
  lastTime = ts;

  const dir = reverseMode ? -1 : 1;
  const spinSpeed = playing ? playbackRate * 60 : 0;

  leftAngle += dir * spinSpeed * dt;
  rightAngle -= dir * spinSpeed * dt;

  leftReel.setAttribute("transform", `translate(275,130) rotate(${leftAngle})`);
  rightReel.setAttribute("transform", `translate(525,130) rotate(${rightAngle})`);

  requestAnimationFrame(animateReels);
}

requestAnimationFrame(animateReels);

function redrawTapePath() {
  const core = sprockets
    .filter((s) => !s.fixed)
    .sort((a, b) => a.x - b.x);

  const full = [
    sprockets.find((s) => s.x === 275 && s.y === 130),
    ...core,
    sprockets.find((s) => s.x === 525 && s.y === 130),
  ];

  const pts = full.map((p) => `${p.x},${p.y}`).join(" ");
  tapePathEl.setAttribute("points", pts);
}

redrawTapePath();

let dragging = null;

function createSprocketNode(sp) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("sprocket-hit");

  const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circ.setAttribute("r", "10");
  circ.setAttribute("class", "sprocket-body");

  g.appendChild(circ);

  function updatePos() {
    g.setAttribute("transform", `translate(${sp.x},${sp.y})`);
  }

  updatePos();

  g.addEventListener("pointerdown", (e) => {
    if (sp.fixed) return;
    dragging = { sp, offsetX: e.clientX - sp.x, offsetY: e.clientY - sp.y };
    g.setPointerCapture(e.pointerId);
  });

  g.addEventListener("pointermove", (e) => {
    if (!dragging || dragging.sp !== sp) return;
    sp.x = e.clientX - dragging.offsetX;
    sp.y = e.clientY - dragging.offsetY;

    if (sp.x < 150) sp.x = 150;
    if (sp.x > 650) sp.x = 650;
    if (sp.y < 70) sp.y = 70;
    if (sp.y > 220) sp.y = 220;

    updatePos();
    redrawTapePath();
  });

  g.addEventListener("pointerup", () => {
    dragging = null;
  });

  g.addEventListener("pointercancel", () => {
    dragging = null;
  });

  sprocketLayer.appendChild(g);
  sp._el = g;
}

function rebuildSprocketLayer() {
  while (sprocketLayer.firstChild) sprocketLayer.removeChild(sprocketLayer.firstChild);
  sprockets.forEach((sp) => createSprocketNode(sp));
}

rebuildSprocketLayer();

const btnAddSprocket = document.getElementById("btnAddSprocket");
const btnRemoveSprocket = document.getElementById("btnRemoveSprocket");

btnAddSprocket.addEventListener("click", () => {
  const sp = {
    x: 400 + (Math.random() * 80 - 40),
    y: 150 + (Math.random() * 40 - 20),
    fixed: false,
  };
  sprockets.push(sp);
  rebuildSprocketLayer();
  redrawTapePath();
});

btnRemoveSprocket.addEventListener("click", () => {
  for (let i = sprockets.length - 1; i >= 0; i -= 1) {
    if (!sprockets[i].fixed) {
      sprockets.splice(i, 1);
      break;
    }
  }
  rebuildSprocketLayer();
  redrawTapePath();
});
