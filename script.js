let audioCtx;
let sourceNode;
let playing = false;
let reverseMode = false;
let playbackRate = 1.0;
let audioBuffer = null;
let micRecorder;
let micStream;
let micTimeout;

let gainNode;
let biquadShelf;
let wowGain;
let wowOsc;
let wowDelay;
let waveshaper;
let highCut;
let dryGain;
let wetGain;
let masterGain;
let echoDelay;
let echoFeedback;

const PX_PER_INCH = 5;
const REFERENCE_SPEED_IPS = 7.5;
const RECORD_HEAD_OFFSET_IN = 2.5;
const MIN_HEAD_GAP_IN = 0.5;
const BASE_WOW_DEPTH = 0.002;

let speedIPS = REFERENCE_SPEED_IPS;
let loopLengthInches = 0;
let loopDurationSeconds = 0;
let headDistanceInches = 12;
let headDelaySeconds = 0;
let recordHeadOffsetInches = RECORD_HEAD_OFFSET_IN;
let currentPathPoints = [];
let recordHeadMarker;
let playHeadMarker;

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

  highCut = audioCtx.createBiquadFilter();
  highCut.type = "lowpass";
  highCut.frequency.value = 8000;

  waveshaper = audioCtx.createWaveShaper();
  waveshaper.curve = makeSaturationCurve(2.5);
  waveshaper.oversample = "2x";

  wowDelay = audioCtx.createDelay();
  wowDelay.delayTime.value = 0.005;

  wowGain = audioCtx.createGain();
  wowGain.gain.value = BASE_WOW_DEPTH;

  wowOsc = audioCtx.createOscillator();
  wowOsc.type = "sine";
  wowOsc.frequency.value = 0.6;
  wowOsc.connect(wowGain);
  wowGain.connect(wowDelay.delayTime);
  wowOsc.start();

  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.85;

  wetGain = audioCtx.createGain();
  wetGain.gain.value = 0.45;

  echoDelay = audioCtx.createDelay(30);
  echoDelay.delayTime.value = headDelaySeconds;

  echoFeedback = audioCtx.createGain();
  echoFeedback.gain.value = 0.35;

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 1;

  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.8;

  waveshaper.connect(biquadShelf);
  biquadShelf.connect(highCut);
  highCut.connect(wowDelay);

  wowDelay.connect(dryGain);
  dryGain.connect(masterGain);

  wowDelay.connect(echoDelay);
  echoDelay.connect(wetGain);
  wetGain.connect(masterGain);

  echoDelay.connect(echoFeedback);
  echoFeedback.connect(echoDelay);

  masterGain.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  updateHeadDelayNode();
  updateFeedbackGain();
  updateSignalColor();
  updateWowFlutter();
}

function startSource(playRev = false) {
  if (!audioBuffer || !audioCtx) return false;

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
  return true;
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
const speedMeta = document.getElementById("speedMeta");
const pitchShiftEl = document.getElementById("pitchShift");
const loopDurationEl = document.getElementById("loopDuration");
const statusText = document.getElementById("statusText");
const dirText = document.getElementById("dirText");
const fileInput = document.getElementById("fileInput");
const sampleName = document.getElementById("sampleName");
const btnMicSample = document.getElementById("btnMicSample");
const loopLengthEl = document.getElementById("loopLength");
const pathSummaryEl = document.getElementById("pathSummary");
const sprocketCountEl = document.getElementById("sprocketCount");
const headDistanceRange = document.getElementById("headDistanceRange");
const headDistanceVal = document.getElementById("headDistanceVal");
const headDelaySummary = document.getElementById("headDelaySummary");
const feedbackRange = document.getElementById("feedbackRange");
const feedbackVal = document.getElementById("feedbackVal");
const headDelayEl = document.getElementById("headDelay");
const wowBiasEl = document.getElementById("wowBias");

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
  playing = startSource(false);
  updateTransportUI();
});

btnReverse.addEventListener("click", () => {
  setupAudioGraph();
  reverseMode = true;
  playing = startSource(true);
  if (!playing) {
    reverseMode = false;
  }
  updateTransportUI();
});

btnStop.addEventListener("click", () => {
  playing = false;
  stopSource();
  updateTransportUI();
});

speedRange.addEventListener("input", () => {
  speedIPS = parseFloat(speedRange.value);
  playbackRate = speedIPS / REFERENCE_SPEED_IPS;
  if (sourceNode) {
    sourceNode.playbackRate.value = playbackRate;
  }
  updateTapePhysics();
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
      playing = startSource(reverseMode);
      updateTransportUI();
    }
  });
});

if (btnMicSample) {
  const resetMicButton = () => {
    btnMicSample.dataset.state = "";
    btnMicSample.textContent = "sample mic";
  };

  btnMicSample.addEventListener("click", async () => {
    if (micRecorder && micRecorder.state === "recording") {
      micRecorder.stop();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      sampleName.textContent = "mic unavailable";
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      sampleName.textContent = "mic unsupported";
      return;
    }

    setupAudioGraph();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      sampleName.textContent = "mic blocked";
      console.error("Microphone access denied", err);
      return;
    }

    micStream = stream;
    const chunks = [];

    micRecorder = new MediaRecorder(stream);
    micRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    micRecorder.addEventListener("stop", async () => {
      const recorder = micRecorder;
      if (micTimeout) {
        clearTimeout(micTimeout);
        micTimeout = null;
      }

      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
        micStream = null;
      }

      const blob = chunks.length
        ? new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" })
        : null;

      resetMicButton();

      try {
        if (blob && audioCtx) {
          const arrayBuffer = await blob.arrayBuffer();
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          const stamp = new Date().toLocaleTimeString();
          sampleName.textContent = `mic capture ${stamp}`;
          if (playing) {
            playing = startSource(reverseMode);
            updateTransportUI();
          }
        }
      } catch (err) {
        sampleName.textContent = "mic capture failed";
        console.error("Failed decoding microphone capture", err);
      } finally {
        micRecorder = null;
      }
    });

    micRecorder.addEventListener("error", (event) => {
      resetMicButton();
      sampleName.textContent = "mic error";
      console.error("Recorder error", event.error);
      if (micRecorder) {
        micRecorder = null;
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
        micStream = null;
      }
    });

    btnMicSample.dataset.state = "recording";
    btnMicSample.textContent = "capturing… tap to stop";

    micRecorder.start();
    micTimeout = window.setTimeout(() => {
      if (micRecorder && micRecorder.state === "recording") {
        micRecorder.stop();
      }
    }, 4000);
  });
}

if (headDistanceRange) {
  headDistanceRange.addEventListener("input", () => {
    headDistanceInches = parseFloat(headDistanceRange.value);
    updateTapePhysics();
  });
}

if (feedbackRange) {
  feedbackRange.addEventListener("input", () => {
    updateFeedbackGain();
  });
}

const svg = document.getElementById("cassetteSVG");
const leftReel = document.getElementById("leftReel");
const rightReel = document.getElementById("rightReel");
const tapePathEl = document.getElementById("tapePath");
const sprocketLayer = document.getElementById("sprocketLayer");
const headLayer = document.getElementById("headLayer");

function createHeadMarker(label) {
  if (!headLayer) return null;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("head-marker");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("r", "9");
  g.appendChild(circle);

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.textContent = label;
  g.appendChild(text);

  headLayer.appendChild(g);
  return g;
}

function positionHeadMarker(marker, point) {
  if (!marker) return;
  if (!point) {
    marker.style.display = "none";
    return;
  }
  marker.style.display = "";
  marker.setAttribute("transform", `translate(${point.x},${point.y})`);
}

if (headLayer) {
  recordHeadMarker = createHeadMarker("R");
  playHeadMarker = createHeadMarker("P");
}

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

  const left = sprockets.find((s) => s.x === 275 && s.y === 130);
  const right = sprockets.find((s) => s.x === 525 && s.y === 130);

  const full = [left, ...core, right].filter(Boolean);

  currentPathPoints = full.map((p) => ({ x: p.x, y: p.y }));

  const pts = currentPathPoints.map((p) => `${p.x},${p.y}`).join(" ");
  tapePathEl.setAttribute("points", pts);
  updateTapePhysics();
}

redrawTapePath();

function computePathLength(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function describeLength(inches) {
  if (!inches || Number.isNaN(inches)) return "0.0 in";
  const rounded = inches.toFixed(1);
  if (inches >= 24) {
    const feet = Math.floor(inches / 12);
    const remainder = inches % 12;
    return `${rounded} in (${feet}' ${remainder.toFixed(1)}\")`;
  }
  return `${rounded} in`;
}

function getPointAtInches(inches) {
  if (!currentPathPoints.length) return null;
  const totalPx = computePathLength(currentPathPoints);
  if (totalPx === 0) return currentPathPoints[0];
  const targetPx = Math.min(Math.max(inches * PX_PER_INCH, 0), totalPx);
  let accum = 0;
  for (let i = 0; i < currentPathPoints.length - 1; i += 1) {
    const start = currentPathPoints[i];
    const end = currentPathPoints[i + 1];
    const seg = Math.hypot(end.x - start.x, end.y - start.y);
    if (accum + seg >= targetPx) {
      const t = seg === 0 ? 0 : (targetPx - accum) / seg;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }
    accum += seg;
  }
  return currentPathPoints[currentPathPoints.length - 1];
}

function updateHeadMarkers() {
  if (!recordHeadMarker || !playHeadMarker || !currentPathPoints.length) {
    positionHeadMarker(recordHeadMarker, null);
    positionHeadMarker(playHeadMarker, null);
    return;
  }

  const recordPoint = getPointAtInches(recordHeadOffsetInches);
  const playPoint = getPointAtInches(recordHeadOffsetInches + headDistanceInches);
  positionHeadMarker(recordHeadMarker, recordPoint);
  positionHeadMarker(playHeadMarker, playPoint);
}

function updateSpeedUI() {
  if (speedVal) {
    speedVal.textContent = speedIPS.toFixed(2);
  }
  if (speedMeta) {
    speedMeta.textContent = `${playbackRate.toFixed(2)}× ref`;
  }
  if (pitchShiftEl) {
    const semis = 12 * Math.log2(Math.max(playbackRate, 0.001));
    const formatted = semis >= 0 ? `+${semis.toFixed(1)}` : semis.toFixed(1);
    pitchShiftEl.textContent = formatted;
  }
}

function updateHeadDelayNode() {
  if (echoDelay) {
    const clamped = Math.max(0, Math.min(29, headDelaySeconds));
    echoDelay.delayTime.value = clamped;
  }
}

function updateFeedbackGain() {
  if (!feedbackRange) return;
  const value = parseFloat(feedbackRange.value);
  if (feedbackVal) {
    feedbackVal.textContent = `${Math.round(value * 100)}%`;
  }
  if (echoFeedback) {
    echoFeedback.gain.value = value;
  }
  if (wetGain) {
    wetGain.gain.value = 0.25 + value * 0.55;
  }
}

function updateSignalColor() {
  if (highCut) {
    const ratio = Math.max(playbackRate, 0.001);
    const target = 8000 * Math.pow(ratio, 0.65);
    highCut.frequency.value = Math.max(1500, Math.min(12000, target));
  }
}

function updateWowFlutter() {
  if (!wowGain) return;
  const guideBonus = Math.max(0, sprockets.length - 2) * 0.0008;
  const lengthBonus = loopLengthInches > 0 ? Math.min(0.003, (loopLengthInches / 120) * 0.0015) : 0;
  const newDepth = BASE_WOW_DEPTH + guideBonus + lengthBonus;
  wowGain.gain.value = newDepth;
  if (wowBiasEl) {
    wowBiasEl.textContent = `${(newDepth / BASE_WOW_DEPTH).toFixed(1)}×`;
  }
  if (wowOsc) {
    const speedFactor = speedIPS / REFERENCE_SPEED_IPS;
    const guideFactor = Math.max(0, sprockets.length - 2) * 0.08;
    wowOsc.frequency.value = 0.6 + guideFactor + (1 - speedFactor) * 0.4;
  }
}

function updateTapePhysics() {
  updateSpeedUI();

  const totalPx = computePathLength(currentPathPoints);
  loopLengthInches = totalPx / PX_PER_INCH;
  if (!Number.isFinite(loopLengthInches)) {
    loopLengthInches = 0;
  }

  const usableLength = Math.max(0, loopLengthInches - MIN_HEAD_GAP_IN);
  recordHeadOffsetInches = Math.min(RECORD_HEAD_OFFSET_IN, usableLength);

  const maxHeadDistance = Math.max(
    0,
    loopLengthInches - recordHeadOffsetInches - MIN_HEAD_GAP_IN
  );

  if (headDistanceRange) {
    headDistanceRange.max = maxHeadDistance.toFixed(2);
    headDistanceRange.disabled = maxHeadDistance <= 0.01;
  }

  if (maxHeadDistance <= 0.01) {
    headDistanceInches = 0;
  } else if (headDistanceInches > maxHeadDistance) {
    headDistanceInches = maxHeadDistance;
  }

  if (headDistanceRange && !Number.isNaN(headDistanceInches)) {
    headDistanceRange.value = headDistanceInches.toFixed(2);
  }

  loopDurationSeconds = loopLengthInches > 0 && speedIPS > 0 ? loopLengthInches / speedIPS : 0;
  headDelaySeconds = headDistanceInches > 0 && speedIPS > 0 ? headDistanceInches / speedIPS : 0;

  if (loopDurationEl) {
    loopDurationEl.textContent = loopDurationSeconds.toFixed(2);
  }
  if (loopLengthEl) {
    loopLengthEl.textContent = describeLength(loopLengthInches);
  }
  if (pathSummaryEl) {
    pathSummaryEl.textContent = `${describeLength(loopLengthInches)} • ${loopDurationSeconds.toFixed(2)} s`;
  }
  if (sprocketCountEl) {
    sprocketCountEl.textContent = String(sprockets.length);
  }
  if (headDistanceVal) {
    headDistanceVal.textContent = headDistanceInches.toFixed(1);
  }
  if (headDelaySummary) {
    headDelaySummary.textContent = `${headDelaySeconds.toFixed(2)} s`;
  }
  if (headDelayEl) {
    headDelayEl.textContent = headDelaySeconds.toFixed(2);
  }

  updateHeadDelayNode();
  updateFeedbackGain();
  updateSignalColor();
  updateWowFlutter();
  updateHeadMarkers();
}

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
