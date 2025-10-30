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
let highPass;

const PX_PER_INCH = 5;
const REFERENCE_SPEED_IPS = 7.5;
const RECORD_HEAD_OFFSET_IN = 2.5;
const MIN_HEAD_GAP_IN = 0.5;
const BASE_WOW_DEPTH = 0.002;
const DEFAULT_TONE_CUT_HZ = 90;
const MIN_TONE_CUT_HZ = 20;
const MAX_TONE_CUT_HZ = 1000;
const FLUTTER_JITTER_MULT = 1800;
const MOTION_DOT_MIN = 12;
const MOTION_DOT_MAX = 84;
const MOTION_DOT_SPACING_IN = 1.1;
const PLAYHEAD_FADE_IDLE = 0.35;
const PLAYHEAD_FADE_ACTIVE = 1;

let speedIPS = REFERENCE_SPEED_IPS;
let loopLengthInches = 0;
let loopDurationSeconds = 0;
let headDistanceInches = 12;
let headDelaySeconds = 0;
let recordHeadOffsetInches = RECORD_HEAD_OFFSET_IN;
let currentPathPoints = [];
let currentPathData = "";
let recordHeadMarker;
let playHeadMarker;
let tapeTotalLengthPx = 0;
let tapeDashSpacing = 66;
let tapeDashOffset = 0;
let tapeTravelInches = 0;
let flutterPhase = 0;
let toneCutHz = DEFAULT_TONE_CUT_HZ;
let flutterAmount = 1;
let tapeDotElements = [];
let tapeDotOffsets = [];
let pathSamplePoints = [];

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

  highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = toneCutHz;

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

  highPass.connect(waveshaper);
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
  updateToneCut();
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
  if (highPass) {
    sourceNode.connect(highPass);
  } else {
    sourceNode.connect(waveshaper);
  }
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
const toneCutRange = document.getElementById("toneCutRange");
const toneCutLabel = document.getElementById("toneCutLabel");
const flutterRange = document.getElementById("flutterRange");
const flutterLabel = document.getElementById("flutterLabel");

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

if (toneCutRange) {
  toneCutRange.addEventListener("input", () => {
    const val = parseFloat(toneCutRange.value);
    if (!Number.isNaN(val)) {
      toneCutHz = Math.min(MAX_TONE_CUT_HZ, Math.max(MIN_TONE_CUT_HZ, val));
      updateToneCut();
    }
  });
}

if (flutterRange) {
  flutterRange.addEventListener("input", () => {
    const val = parseFloat(flutterRange.value);
    if (!Number.isNaN(val)) {
      flutterAmount = Math.max(0, Math.min(2.5, val));
      updateFlutterUI();
      updateWowFlutter();
      updateActiveTapeSegment();
    }
  });
}

const svg = document.getElementById("cassetteSVG");
const leftReel = document.getElementById("leftReel");
const rightReel = document.getElementById("rightReel");
const tapeHitPath = document.getElementById("tapeHit");
const tapeBasePath = document.getElementById("tapeBase");
const tapeMotionPath = document.getElementById("tapeMotion");
const tapeActivePath = document.getElementById("tapeActive");
const tapeDotsGroup = document.getElementById("tapeDots");
const playheadTracer = document.getElementById("playheadTracer");
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

let loopGeometry = null;

let sprockets = [
  { id: "leftReel", x: 270, y: 150, locked: true, wrapRadius: 58 },
  { id: "upperGuide", x: 390, y: 90, locked: false, wrapRadius: 22 },
  { id: "rightReel", x: 530, y: 150, locked: true, wrapRadius: 58 },
  { id: "lowerGuide", x: 390, y: 210, locked: false, wrapRadius: 22 },
];

let lastTime = null;
let leftAngle = 0;
let rightAngle = 0;

function getLeftReel() {
  return sprockets.find((sp) => sp.id === "leftReel");
}

function getRightReel() {
  return sprockets.find((sp) => sp.id === "rightReel");
}

function updateReelTransforms() {
  const left = getLeftReel();
  const right = getRightReel();
  if (left && leftReel) {
    leftReel.setAttribute(
      "transform",
      `translate(${left.x},${left.y}) rotate(${leftAngle})`
    );
  }
  if (right && rightReel) {
    rightReel.setAttribute(
      "transform",
      `translate(${right.x},${right.y}) rotate(${rightAngle})`
    );
  }
}

function animateReels(ts) {
  if (lastTime === null) lastTime = ts;
  const dt = (ts - lastTime) / 1000;
  lastTime = ts;

  const dir = reverseMode ? -1 : 1;
  const spinSpeed = playing ? playbackRate * 60 : 0;

  leftAngle += dir * spinSpeed * dt;
  rightAngle -= dir * spinSpeed * dt;

  const tapeSpeed = playing ? speedIPS : 0;
  if (loopLengthInches > 0 && tapeSpeed !== 0) {
    let advance = tapeTravelInches + tapeSpeed * dt * dir;
    advance %= loopLengthInches;
    if (advance < 0) advance += loopLengthInches;
    tapeTravelInches = advance;
  }

  const pxStep = tapeSpeed * PX_PER_INCH * dt * dir;
  if (tapeMotionPath) {
    const spacing = tapeDashSpacing || 1;
    tapeDashOffset = ((tapeDashOffset - pxStep) % spacing + spacing) % spacing;
    tapeMotionPath.setAttribute("stroke-dashoffset", tapeDashOffset.toFixed(2));
  }

  const wowFrequency = wowOsc ? wowOsc.frequency.value : 0.6;
  const flutterDrive = playing ? wowFrequency : wowFrequency * 0.15;
  flutterPhase += 2 * Math.PI * flutterDrive * dt;
  if (flutterPhase > Math.PI * 2) {
    flutterPhase -= Math.PI * 2;
  }

  updateMotionDots();
  updateActiveTapeSegment();
  updateReelTransforms();

  requestAnimationFrame(animateReels);
}

requestAnimationFrame(animateReels);

function clampRadius(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampSprocketPosition(sp) {
  if (!sp) return;
  if (sp.x < 150) sp.x = 150;
  if (sp.x > 650) sp.x = 650;
  if (sp.y < 70) sp.y = 70;
  if (sp.y > 220) sp.y = 220;
}

function normalizeAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  let result = angle % (Math.PI * 2);
  if (result < 0) result += Math.PI * 2;
  return result;
}

function computeLoopOrientation(points) {
  if (!points || points.length < 3) return 1;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    area += curr.x * next.y - next.x * curr.y;
  }
  return area >= 0 ? 1 : -1;
}

function computeOuterTangent(curr, next, orientation) {
  if (!curr || !next) return null;

  const ax = curr.x;
  const ay = curr.y;
  const bx = next.x;
  const by = next.y;

  const ra = clampRadius(curr.wrapRadius ?? 18, 6, 120);
  const rb = clampRadius(next.wrapRadius ?? 18, 6, 120);

  const dx = bx - ax;
  const dy = by - ay;
  const distSq = dx * dx + dy * dy;
  if (distSq < 1e-3) return null;
  const dist = Math.sqrt(distSq);

  if (dist <= Math.abs(ra - rb) + 0.5) {
    return null;
  }

  const sign = orientation >= 0 ? 1 : -1;
  const diff = (ra - rb) / dist;
  const clamped = Math.max(-1, Math.min(1, diff));
  let angleOffset = Math.acos(clamped);
  if (!Number.isFinite(angleOffset)) angleOffset = 0;

  const baseAngle = Math.atan2(dy, dx);
  const theta = baseAngle + sign * angleOffset;

  const start = {
    x: ax + ra * Math.cos(theta),
    y: ay + ra * Math.sin(theta),
  };
  const end = {
    x: bx + rb * Math.cos(theta),
    y: by + rb * Math.sin(theta),
  };

  return {
    start,
    end,
    startAngle: Math.atan2(start.y - ay, start.x - ax),
    endAngle: Math.atan2(end.y - by, end.x - bx),
    radiusA: ra,
    radiusB: rb,
    length: Math.hypot(end.x - start.x, end.y - start.y),
  };
}

function coordinatesClose(a, b, tolerance = 0.5) {
  if (!a || !b) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= tolerance * tolerance;
}

function buildArcCommand(node, radius, entryAngle, exitAngle, orientation, exitPoint) {
  const startAngle = normalizeAngle(entryAngle);
  let endAngle = normalizeAngle(exitAngle);
  let delta = endAngle - startAngle;

  if (orientation >= 0) {
    if (delta <= 0) delta += Math.PI * 2;
  } else if (delta >= 0) {
    delta -= Math.PI * 2;
  }
}

  if (Math.abs(delta) < 1e-4) {
    return {
      cmd: ` L ${exitPoint.x.toFixed(2)} ${exitPoint.y.toFixed(2)}`,
      delta: 0,
      startAngle,
      endAngle,
    };
  }

  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = orientation >= 0 ? 1 : 0;

  return {
    cmd: ` A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} ${sweep} ${exitPoint.x.toFixed(2)} ${exitPoint.y.toFixed(2)}`,
    delta,
    startAngle,
    endAngle,
  };
}

function computeLoopGeometry(nodes) {
  if (!nodes || nodes.length < 2) return null;

  const orientation = computeLoopOrientation(nodes);
  const count = nodes.length;
  const entries = new Array(count);
  const exits = new Array(count);
  const tangents = [];
  const arcs = [];

  for (let i = 0; i < count; i += 1) {
    const curr = nodes[i];
    const next = nodes[(i + 1) % count];
    const tangent = computeOuterTangent(curr, next, orientation);
    if (!tangent) {
      return null;
    }

    exits[i] = {
      point: tangent.start,
      angle: tangent.startAngle,
      radius: tangent.radiusA,
    };
    entries[(i + 1) % count] = {
      point: tangent.end,
      angle: tangent.endAngle,
      radius: tangent.radiusB,
    };

    tangents.push({
      from: i,
      to: (i + 1) % count,
      start: tangent.start,
      end: tangent.end,
      length: tangent.length,
    });
  }

  let startEntry = entries[0];
  if (!startEntry) {
    const firstRadius = clampRadius(nodes[0].wrapRadius ?? 18, 6, 120);
    startEntry = {
      point: { x: nodes[0].x + firstRadius, y: nodes[0].y },
      angle: 0,
      radius: firstRadius,
    };
    entries[0] = startEntry;
  }

  let path = `M ${startEntry.point.x.toFixed(2)} ${startEntry.point.y.toFixed(2)}`;
  let lastPoint = { x: startEntry.point.x, y: startEntry.point.y };

  const pushLine = (target) => {
    if (!target) return;
    if (coordinatesClose(lastPoint, target)) return;
    path += ` L ${target.x.toFixed(2)} ${target.y.toFixed(2)}`;
    lastPoint = { x: target.x, y: target.y };
  };

  for (let i = 0; i < count; i += 1) {
    const node = nodes[i];
    const entry = entries[i];
    const exit = exits[i];
    const radius = clampRadius(node.wrapRadius ?? 18, 6, 120);

    if (entry && !coordinatesClose(lastPoint, entry.point)) {
      pushLine(entry.point);
    }

    if (entry && exit) {
      const arc = buildArcCommand(node, radius, entry.angle, exit.angle, orientation, exit.point);
      path += arc.cmd;
      lastPoint = { x: exit.point.x, y: exit.point.y };
      if (Math.abs(arc.delta) > 1e-4) {
        arcs.push({
          center: { x: node.x, y: node.y },
          radius,
          startAngle: arc.startAngle,
          endAngle: arc.endAngle,
          orientation,
          length: Math.abs(arc.delta) * radius,
        });
      }
    } else if (exit) {
      pushLine(exit.point);
    }

    const tangent = tangents[i];
    if (tangent) {
      pushLine(tangent.end);
    }
  }

  path += " Z";

  return {
    path,
    tangents,
    arcs,
    entries,
    exits,
    orientation,
  };
}

function generateFallbackLoop(points) {
  const entries = points.map((pt) => ({
    x: pt.x,
    y: pt.y,
    radius: clampRadius(pt.wrapRadius ?? 18, 6, 90),
  }));

  const len = entries.length;
  if (len < 2) {
    return "";
  }

  const instructions = [];

  for (let i = 0; i < len; i += 1) {
    const prev = entries[(i - 1 + len) % len];
    const curr = entries[i];
    const next = entries[(i + 1) % len];

    const vIn = { x: curr.x - prev.x, y: curr.y - prev.y };
    const vOut = { x: next.x - curr.x, y: next.y - curr.y };
    const lenIn = Math.hypot(vIn.x, vIn.y);
    const lenOut = Math.hypot(vOut.x, vOut.y);

    if (lenIn < 0.01 || lenOut < 0.01) {
      instructions.push({ type: "line", point: { x: curr.x, y: curr.y } });
      continue;
    }

    const inUnit = { x: vIn.x / lenIn, y: vIn.y / lenIn };
    const outUnit = { x: vOut.x / lenOut, y: vOut.y / lenOut };

    let dot = inUnit.x * outUnit.x + inUnit.y * outUnit.y;
    dot = Math.max(-0.9999, Math.min(0.9999, dot));
    let angle = Math.acos(dot);
    if (!Number.isFinite(angle)) angle = Math.PI;

    if (angle < 0.05 || Math.abs(Math.PI - angle) < 0.05) {
      instructions.push({ type: "line", point: { x: curr.x, y: curr.y } });
      continue;
    }

    const rawRadius = clampRadius(curr.radius, 4, 120);
    const maxRadius = Math.min(lenIn, lenOut) / 2.2;
    const radius = clampRadius(Math.min(rawRadius, maxRadius), 4, 120);

    const tanFactor = Math.tan(angle / 2);
    if (Math.abs(tanFactor) < 0.001) {
      instructions.push({ type: "line", point: { x: curr.x, y: curr.y } });
      continue;
    }

    const maxCut = Math.min(lenIn, lenOut) * 0.48;
    let cutLen = radius / tanFactor;
    cutLen = clampRadius(cutLen, 4, maxCut);

    const start = {
      x: curr.x - inUnit.x * cutLen,
      y: curr.y - inUnit.y * cutLen,
    };
    const end = {
      x: curr.x + outUnit.x * cutLen,
      y: curr.y + outUnit.y * cutLen,
    };

    const cross = inUnit.x * outUnit.y - inUnit.y * outUnit.x;
    const sweep = cross < 0 ? 0 : 1;

    instructions.push({
      type: "arc",
      start,
      end,
      radius,
      sweep,
    });
  }

  let path = "";
  for (let i = 0; i < instructions.length; i += 1) {
    const instr = instructions[i];
    if (instr.type === "line") {
      if (!path) {
        path = `M ${instr.point.x.toFixed(2)} ${instr.point.y.toFixed(2)}`;
      } else {
        path += ` L ${instr.point.x.toFixed(2)} ${instr.point.y.toFixed(2)}`;
      }
      continue;
    }

    const { start, end, radius, sweep } = instr;
    if (!path) {
      path = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
    } else {
      path += ` L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
    }
    path += ` A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  if (path) {
    path += " Z";
  }

  return path;
}

function redrawTapePath() {
  const ordered = sprockets.slice();

  currentPathPoints = ordered.map((p) => ({ x: p.x, y: p.y }));

  const geometry = ordered.length >= 2 ? computeLoopGeometry(ordered) : null;
  if (geometry && geometry.path) {
    currentPathData = geometry.path;
    loopGeometry = geometry;
  } else {
    currentPathData = ordered.length >= 2 ? generateFallbackLoop(ordered) : "";
    loopGeometry = null;
  }

  if (tapeHitPath) {
    tapeHitPath.setAttribute("d", currentPathData);
  }
  if (tapeBasePath) {
    tapeBasePath.setAttribute("d", currentPathData);
  }
  if (tapeMotionPath) {
    tapeMotionPath.setAttribute("d", currentPathData);
  }
  if (tapeActivePath) {
    tapeActivePath.setAttribute("d", currentPathData);
  }

  refreshPathMetrics();
  updateReelTransforms();
  updateTapePhysics();
  rebuildMotionDots();
}

redrawTapePath();

function refreshPathMetrics() {
  pathSamplePoints = [];
  tapeTotalLengthPx = 0;

  if (!tapeBasePath || !currentPathData) {
    return;
  }

  try {
    tapeTotalLengthPx = tapeBasePath.getTotalLength();
  } catch (err) {
    tapeTotalLengthPx = 0;
    return;
  }

  const total = Math.max(tapeTotalLengthPx, 0);
  const sampleCount = Math.max(16, Math.min(420, Math.round(total / 6)));

  for (let i = 0; i < sampleCount; i += 1) {
    const ratio = i / sampleCount;
    const length = ratio * total;
    const point = tapeBasePath.getPointAtLength(length);
    pathSamplePoints.push({ length, x: point.x, y: point.y });
  }
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
  if (!tapeBasePath || tapeTotalLengthPx <= 0) return null;

  let targetPx = (inches * PX_PER_INCH) % tapeTotalLengthPx;
  if (targetPx < 0) targetPx += tapeTotalLengthPx;

  try {
    const point = tapeBasePath.getPointAtLength(targetPx);
    return { x: point.x, y: point.y };
  } catch (err) {
    if (!pathSamplePoints.length) return null;
    const closest = pathSamplePoints.reduce((best, entry) => {
      const diff = Math.abs(entry.length - targetPx);
      if (!best || diff < best.diff) {
        return { diff, point: { x: entry.x, y: entry.y } };
      }
      return best;
    }, null);
    return closest ? closest.point : null;
  }
}

function updatePlayheadTracer() {
  if (!playheadTracer) return;

  if (!currentPathData || loopLengthInches <= 0) {
    playheadTracer.style.opacity = "0";
    return;
  }

  const totalInches = loopLengthInches;
  if (totalInches <= 0) {
    playheadTracer.style.opacity = "0";
    return;
  }

  let playAhead = recordHeadOffsetInches + headDistanceInches + tapeTravelInches;
  playAhead %= totalInches;
  if (playAhead < 0) playAhead += totalInches;

  const point = getPointAtInches(playAhead);
  if (!point) {
    playheadTracer.style.opacity = "0";
    return;
  }

  playheadTracer.setAttribute("cx", point.x.toFixed(2));
  playheadTracer.setAttribute("cy", point.y.toFixed(2));

  const rateBias = Math.min(1.6, Math.max(0.6, playbackRate));
  playheadTracer.setAttribute("r", (8 * rateBias).toFixed(2));
  playheadTracer.style.opacity = playing ? PLAYHEAD_FADE_ACTIVE : PLAYHEAD_FADE_IDLE;
}

function rebuildMotionDots() {
  if (!tapeDotsGroup) return;

  tapeDotElements = [];
  tapeDotOffsets = [];

  while (tapeDotsGroup.firstChild) {
    tapeDotsGroup.removeChild(tapeDotsGroup.firstChild);
  }

  if (!currentPathData || loopLengthInches <= 0) {
    return;
  }

  const approxCount = Math.round(loopLengthInches / MOTION_DOT_SPACING_IN);
  const dotCount = Math.max(MOTION_DOT_MIN, Math.min(MOTION_DOT_MAX, approxCount));

  for (let i = 0; i < dotCount; i += 1) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "2.4");
    tapeDotsGroup.appendChild(circle);
    tapeDotElements.push(circle);
    tapeDotOffsets.push((i / dotCount) * loopLengthInches);
  }

  updateMotionDots(true);
}

function updateMotionDots(force = false) {
  if (!tapeDotsGroup || tapeDotElements.length === 0 || loopLengthInches <= 0) {
    return;
  }

  const totalInches = loopLengthInches;
  const flutterDepth = wowGain ? wowGain.gain.value : BASE_WOW_DEPTH;
  let headPos = recordHeadOffsetInches + headDistanceInches + tapeTravelInches;
  headPos %= totalInches;
  if (headPos < 0) headPos += totalInches;

  for (let i = 0; i < tapeDotElements.length; i += 1) {
    const circle = tapeDotElements[i];
    let travel = tapeDotOffsets[i] + tapeTravelInches;
    travel %= totalInches;
    if (travel < 0) travel += totalInches;

    const point = getPointAtInches(travel);
    if (!point) continue;

    circle.setAttribute("cx", point.x.toFixed(2));
    circle.setAttribute("cy", point.y.toFixed(2));

    const diff = Math.abs(travel - headPos);
    const wrapDiff = Math.min(diff, totalInches - diff);
    const highlight = Math.max(0, 1 - wrapDiff / Math.max(3, totalInches * 0.12));
    const baseOpacity = playing ? 0.52 : 0.32;
    const flutterBoost = flutterDepth * 260;
    const opacity = Math.min(1, baseOpacity + highlight * 0.55 + flutterBoost);
    circle.style.opacity = opacity.toFixed(2);

    const wobble = Math.sin(flutterPhase + i * 0.55) * flutterDepth * FLUTTER_JITTER_MULT * 0.015;
    const speedInfl = Math.max(0.85, Math.min(1.65, playbackRate));
    const radius = Math.max(1.5, Math.min(4.8, 2.2 * speedInfl + wobble));
    if (force || Math.abs(parseFloat(circle.getAttribute("r")) - radius) > 0.01) {
      circle.setAttribute("r", radius.toFixed(2));
    }
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

function updateToneCut() {
  const clamped = Math.min(MAX_TONE_CUT_HZ, Math.max(MIN_TONE_CUT_HZ, toneCutHz));
  toneCutHz = Math.round(clamped);
  if (toneCutLabel) {
    toneCutLabel.textContent = `${toneCutHz} Hz`;
  }
  if (toneCutRange && parseFloat(toneCutRange.value) !== toneCutHz) {
    toneCutRange.value = toneCutHz.toString();
  }
  if (highPass) {
    highPass.frequency.value = toneCutHz;
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
  const baseDepth = BASE_WOW_DEPTH + guideBonus + lengthBonus;
  const newDepth = Math.max(0, baseDepth * flutterAmount);
  wowGain.gain.value = newDepth;
  if (wowBiasEl) {
    const ratio = BASE_WOW_DEPTH === 0 ? 0 : newDepth / BASE_WOW_DEPTH;
    wowBiasEl.textContent = `${ratio.toFixed(1)}×`;
  }
  if (wowOsc) {
    const speedFactor = speedIPS / REFERENCE_SPEED_IPS;
    const guideFactor = Math.max(0, sprockets.length - 2) * 0.08;
    const baseFrequency = 0.6 + guideFactor + (1 - speedFactor) * 0.4;
    const flutterShape = 0.45 + flutterAmount * 0.75;
    wowOsc.frequency.value = Math.max(0.1, baseFrequency * flutterShape);
  }
  const depthRatio = BASE_WOW_DEPTH === 0 ? 0 : newDepth / BASE_WOW_DEPTH;
  if (tapeMotionPath) {
    const width = 4 * Math.min(1.75, Math.max(0.6, 0.6 + depthRatio));
    tapeMotionPath.setAttribute("stroke-width", width.toFixed(2));
  }
  if (tapeActivePath) {
    const activeWidth = 5.2 * Math.min(1.65, Math.max(0.75, 0.6 + depthRatio));
    tapeActivePath.setAttribute("stroke-width", activeWidth.toFixed(2));
    tapeActivePath.style.opacity = Math.min(1, 0.58 + depthRatio * 0.3);
  }
  updateMotionDots();
}

function updateTapePhysics() {
  updateSpeedUI();

  const prevLength = loopLengthInches || 0;
  if (!Number.isFinite(tapeTotalLengthPx)) {
    tapeTotalLengthPx = 0;
  }
  loopLengthInches = tapeTotalLengthPx / PX_PER_INCH;
  if (!Number.isFinite(loopLengthInches)) {
    loopLengthInches = 0;
  }

  if (tapeMotionPath) {
    const segments = Math.max(currentPathPoints.length, 1);
    const dashA = Math.max(18, Math.min(150, (tapeTotalLengthPx / segments) * 0.45));
    const dashB = dashA * 0.7;
    tapeDashSpacing = dashA + dashB;
    tapeDashOffset = ((tapeDashOffset % tapeDashSpacing) + tapeDashSpacing) % tapeDashSpacing;
    tapeMotionPath.setAttribute(
      "stroke-dasharray",
      `${dashA.toFixed(2)} ${dashB.toFixed(2)}`
    );
    tapeMotionPath.setAttribute("stroke-dashoffset", tapeDashOffset.toFixed(2));
  }

  if (loopLengthInches > 0 && prevLength > 0) {
    const normalized = ((tapeTravelInches % prevLength) + prevLength) % prevLength;
    tapeTravelInches = (normalized / prevLength) * loopLengthInches;
  } else if (loopLengthInches <= 0) {
    tapeTravelInches = 0;
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
    const guideCount = Math.max(0, sprockets.length - 2);
    sprocketCountEl.textContent = String(guideCount);
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
  updateActiveTapeSegment();
  updateMotionDots(true);
}

function updateFlutterUI() {
  if (flutterLabel) {
    flutterLabel.textContent = `${Math.round(flutterAmount * 100)}%`;
  }
  if (flutterRange && Math.abs(parseFloat(flutterRange.value) - flutterAmount) > 0.005) {
    flutterRange.value = flutterAmount.toFixed(2);
  }
}

function updateHeadMarkers() {
  if (!recordHeadMarker || !playHeadMarker || !currentPathData) {
    positionHeadMarker(recordHeadMarker, null);
    positionHeadMarker(playHeadMarker, null);
    return;
  }

  const recordPoint = getPointAtInches(recordHeadOffsetInches);
  const playPoint = getPointAtInches(recordHeadOffsetInches + headDistanceInches);
  positionHeadMarker(recordHeadMarker, recordPoint);
  positionHeadMarker(playHeadMarker, playPoint);
}

function updateActiveTapeSegment() {
  if (!tapeActivePath || !currentPathData) {
    if (tapeActivePath) {
      tapeActivePath.setAttribute("stroke-dasharray", "0 1");
    }
    updatePlayheadTracer();
    return;
  }

  if (loopLengthInches <= 0 || tapeTotalLengthPx <= 0) {
    tapeActivePath.setAttribute("stroke-dasharray", `0 ${tapeTotalLengthPx || 1}`);
    tapeActivePath.setAttribute("stroke-dashoffset", "0");
    updatePlayheadTracer();
    return;
  }

  if (tapeTotalLengthPx <= 6) {
    tapeActivePath.setAttribute("stroke-dasharray", `${tapeTotalLengthPx.toFixed(2)} 0.1`);
    tapeActivePath.setAttribute("stroke-dashoffset", "0");
    updatePlayheadTracer();
    return;
  }

  const totalInches = loopLengthInches;
  const playAhead = (recordHeadOffsetInches + headDistanceInches + tapeTravelInches) % totalInches;
  const activeSpanInches = Math.max(totalInches * 0.06, 3);
  const maxActivePx = Math.max(6, tapeTotalLengthPx - 0.5);
  const activePx = Math.min(maxActivePx, activeSpanInches * PX_PER_INCH);
  const remainder = Math.max(tapeTotalLengthPx - activePx, 0.001);

  tapeActivePath.setAttribute(
    "stroke-dasharray",
    `${activePx.toFixed(2)} ${remainder.toFixed(2)}`
  );

  let offsetInches = playAhead - activeSpanInches / 2;
  offsetInches %= totalInches;
  if (offsetInches < 0) offsetInches += totalInches;

  const flutterDepth = wowGain ? wowGain.gain.value : BASE_WOW_DEPTH;
  const jitterPx = Math.sin(flutterPhase) * flutterDepth * FLUTTER_JITTER_MULT;
  const offsetPx = offsetInches * PX_PER_INCH;
  tapeActivePath.setAttribute("stroke-dashoffset", (-(offsetPx) + jitterPx).toFixed(2));

  updatePlayheadTracer();
}

function updateSpeedUI() {
  if (speedVal) {
    speedVal.textContent = speedIPS.toFixed(2);
  }
  if (speedMeta) {
    speedMeta.textContent = `${speedIPS.toFixed(2)} ips`;
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

function updateToneCut() {
  const clamped = Math.min(MAX_TONE_CUT_HZ, Math.max(MIN_TONE_CUT_HZ, toneCutHz));
  toneCutHz = Math.round(clamped);
  if (toneCutLabel) {
    toneCutLabel.textContent = `${toneCutHz} Hz`;
  }
  if (toneCutRange && parseFloat(toneCutRange.value) !== toneCutHz) {
    toneCutRange.value = toneCutHz.toString();
  }
  if (highPass) {
    highPass.frequency.value = toneCutHz;
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
  const baseDepth = BASE_WOW_DEPTH + guideBonus + lengthBonus;
  const newDepth = Math.max(0, baseDepth * flutterAmount);
  wowGain.gain.value = newDepth;
  if (wowBiasEl) {
    const ratio = BASE_WOW_DEPTH === 0 ? 0 : newDepth / BASE_WOW_DEPTH;
    wowBiasEl.textContent = `${ratio.toFixed(1)}×`;
  }
  if (wowOsc) {
    const speedFactor = speedIPS / REFERENCE_SPEED_IPS;
    const guideFactor = Math.max(0, sprockets.length - 2) * 0.08;
    const baseFrequency = 0.6 + guideFactor + (1 - speedFactor) * 0.4;
    const flutterShape = 0.45 + flutterAmount * 0.75;
    wowOsc.frequency.value = Math.max(0.1, baseFrequency * flutterShape);
  }
  const depthRatio = BASE_WOW_DEPTH === 0 ? 0 : newDepth / BASE_WOW_DEPTH;
  if (tapeMotionPath) {
    const width = 4 * Math.min(1.75, Math.max(0.6, 0.6 + depthRatio));
    tapeMotionPath.setAttribute("stroke-width", width.toFixed(2));
  }
  if (tapeActivePath) {
    const activeWidth = 5.2 * Math.min(1.65, Math.max(0.75, 0.6 + depthRatio));
    tapeActivePath.setAttribute("stroke-width", activeWidth.toFixed(2));
    tapeActivePath.style.opacity = Math.min(1, 0.58 + depthRatio * 0.3);
  }
  updateMotionDots();
}

function updateTapePhysics() {
  updateSpeedUI();

  const prevLength = loopLengthInches || 0;
  if (!Number.isFinite(tapeTotalLengthPx)) {
    tapeTotalLengthPx = 0;
  }
  loopLengthInches = tapeTotalLengthPx / PX_PER_INCH;
  if (!Number.isFinite(loopLengthInches)) {
    loopLengthInches = 0;
  }

  if (tapeMotionPath) {
    const segments = Math.max(currentPathPoints.length, 1);
    const dashA = Math.max(18, Math.min(150, (tapeTotalLengthPx / segments) * 0.45));
    const dashB = dashA * 0.7;
    tapeDashSpacing = dashA + dashB;
    tapeDashOffset = ((tapeDashOffset % tapeDashSpacing) + tapeDashSpacing) % tapeDashSpacing;
    tapeMotionPath.setAttribute(
      "stroke-dasharray",
      `${dashA.toFixed(2)} ${dashB.toFixed(2)}`
    );
    tapeMotionPath.setAttribute("stroke-dashoffset", tapeDashOffset.toFixed(2));
  }

  if (loopLengthInches > 0 && prevLength > 0) {
    const normalized = ((tapeTravelInches % prevLength) + prevLength) % prevLength;
    tapeTravelInches = (normalized / prevLength) * loopLengthInches;
  } else if (loopLengthInches <= 0) {
    tapeTravelInches = 0;
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
    const guideCount = Math.max(0, sprockets.length - 2);
    sprocketCountEl.textContent = String(guideCount);
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
  updateActiveTapeSegment();
  updateMotionDots(true);
}

let dragging = null;

function createSprocketNode(sp) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("sprocket-hit");
  g.dataset.type = sp.id || "guide";

  const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const nodeRadius = clampRadius((sp.wrapRadius ?? 18) * 0.22 + 6, 8, 20);
  circ.setAttribute("r", nodeRadius.toFixed(1));
  circ.setAttribute("class", "sprocket-body");

  g.appendChild(circ);

  function updatePos() {
    g.setAttribute("transform", `translate(${sp.x},${sp.y})`);
  }

  updatePos();

  g.addEventListener("pointerdown", (e) => {
    dragging = { sp, offsetX: e.clientX - sp.x, offsetY: e.clientY - sp.y };
    g.setPointerCapture(e.pointerId);
  });

  g.addEventListener("pointermove", (e) => {
    if (!dragging || dragging.sp !== sp) return;
    sp.x = e.clientX - dragging.offsetX;
    sp.y = e.clientY - dragging.offsetY;

    clampSprocketPosition(sp);

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
updateToneCut();
updateFlutterUI();

function svgPointFromEvent(evt) {
  if (!svg) return null;
  const point = svg.createSVGPoint();
  point.x = evt.clientX;
  point.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inverted = ctm.inverse();
  const transformed = point.matrixTransform(inverted);
  return { x: transformed.x, y: transformed.y };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return {
      dist: Math.hypot(point.x - start.x, point.y - start.y),
      projection: { x: start.x, y: start.y },
      t: 0,
    };
  }
  const denom = dx * dx + dy * dy;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom)
  );
  const projection = { x: start.x + t * dx, y: start.y + t * dy };
  const dist = Math.hypot(point.x - projection.x, point.y - projection.y);
  return { dist, projection, t };
}

if (tapeHitPath) {
  tapeHitPath.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (dragging) return;
    if (!loopGeometry || !loopGeometry.tangents || !loopGeometry.tangents.length) return;

    const svgPoint = svgPointFromEvent(e);
    if (!svgPoint) return;

    let best = null;
    loopGeometry.tangents.forEach((seg) => {
      const measurement = distanceToSegment(svgPoint, seg.start, seg.end);
      if (!best || measurement.dist < best.dist) {
        best = { measurement, seg };
      }
    });

    if (!best || best.measurement.dist > 28) return;

    e.preventDefault();

    const insertIndex = best.seg.to;
    const sp = {
      x: svgPoint.x,
      y: svgPoint.y,
      locked: false,
      wrapRadius: 18,
    };
    clampSprocketPosition(sp);
    sprockets.splice(insertIndex, 0, sp);
    rebuildSprocketLayer();
    redrawTapePath();
  });
}

const btnAddSprocket = document.getElementById("btnAddSprocket");
const btnRemoveSprocket = document.getElementById("btnRemoveSprocket");

btnAddSprocket.addEventListener("click", () => {
  let insertIndex = sprockets.length;
  let candidate = {
    x: 400 + (Math.random() * 80 - 40),
    y: 150 + (Math.random() * 40 - 20),
  };

  if (loopGeometry && loopGeometry.tangents && loopGeometry.tangents.length) {
    const longest = loopGeometry.tangents.reduce(
      (best, seg) => (!best || seg.length > best.length ? seg : best),
      null
    );
    if (longest) {
      insertIndex = longest.to;
      candidate = {
        x: (longest.start.x + longest.end.x) / 2,
        y: (longest.start.y + longest.end.y) / 2,
      };
    }
  }

  const sp = {
    x: candidate.x,
    y: candidate.y,
    locked: false,
    wrapRadius: 18,
  };
  clampSprocketPosition(sp);
  sprockets.splice(insertIndex, 0, sp);
  rebuildSprocketLayer();
  redrawTapePath();
});

btnRemoveSprocket.addEventListener("click", () => {
  for (let i = sprockets.length - 1; i >= 0; i -= 1) {
    if (!sprockets[i].locked) {
      sprockets.splice(i, 1);
      break;
    }
  }
  rebuildSprocketLayer();
  redrawTapePath();
});
