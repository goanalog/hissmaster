const lengthSlider = document.getElementById("length-slider");
const speedSlider = document.getElementById("speed-slider");
const lengthReading = document.getElementById("length-reading");
const speedReading = document.getElementById("speed-reading");
const profile = document.getElementById("sonic-profile");
const pulsesGroup = document.querySelector(".loop-pulses");

const profiles = [
  {
    predicate: ({ length, speed }) => length <= 6 && speed >= 9,
    text: "Ultra-short loops blur into pitched tones with metallic grit. Ideal for shimmering drones and granular harmonics.",
  },
  {
    predicate: ({ length, speed }) => length <= 12,
    text: "Short repetitions emphasize rhythm—think percussive clicks, clipped chords, or restless ostinati.",
  },
  {
    predicate: ({ length, speed }) => length <= 45,
    text: "Mid-length loops balance groove and atmosphere, letting harmonic motion remain recognizable while still evolving.",
  },
  {
    predicate: ({ length }) => length <= 120,
    text: "Long pathways soften the sense of repetition and invite slow-moving textures with subtle shifts in tone.",
  },
  {
    predicate: () => true,
    text: "Ultra-long loops behave like evolving environments, perfect for generative ambient installations and site-specific sound art.",
  },
];

function updateReadout() {
  const lengthSeconds = Number(lengthSlider.value);
  const speed = Number(speedSlider.value);
  lengthReading.textContent = `${lengthSeconds}s`;
  speedReading.textContent = `${speed.toFixed(3)} ips`;

  const selected = profiles.find((item) => item.predicate({ length: lengthSeconds, speed }));
  if (selected) {
    profile.textContent = selected.text;
  }

  renderPulses(lengthSeconds, speed);
}

function renderPulses(lengthSeconds, speed) {
  const totalPulses = Math.max(6, Math.round((speed * 10) / (lengthSeconds / 6 + 1)));
  const maxPulse = 14;
  pulsesGroup.innerHTML = "";
  for (let i = 0; i < totalPulses; i += 1) {
    const radius = 6 + ((i % maxPulse) / maxPulse) * 18;
    const angle = (i / totalPulses) * Math.PI * 2;
    const jitter = Math.sin(speed / 3 + i) * 6;
    const cx = 160 + Math.cos(angle) * (60 + jitter);
    const cy = 80 + Math.sin(angle) * (42 + jitter / 2);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", cx.toFixed(2));
    circle.setAttribute("cy", cy.toFixed(2));
    circle.setAttribute("r", radius.toFixed(2));
    circle.style.opacity = Math.min(1, 0.3 + speed / 15);
    pulsesGroup.appendChild(circle);
  }
}

lengthSlider.addEventListener("input", updateReadout);
speedSlider.addEventListener("input", updateReadout);

updateReadout();
