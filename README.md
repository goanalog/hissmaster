# Tape Loop Lab

A cassette-inspired loop sandbox. Load audio into the deck, adjust transport direction, speed, and routing posts, and watch the virtual tape path respond in real time. Capture a quick idea directly from your microphone with the **Sample Mic** button.

### Physical modelling highlights

- **Loop physics readout** – The SVG path length is continuously sampled and reported as physical inches/feet so you can relate a short, glitchy loop to a long ambient drift.
- **Real IPS speed control** – The transport runs from 1.875 to 15 inches-per-second. The UI shows the implied loop duration and pitch shift relative to a 7.5 IPS reference so you can hear the "bright vs. dark" trade-off.
- **Record/Play head distance** – Dragging guide posts re-shapes the loop while a dedicated slider sets the head spacing that feeds a synced delay line. Feedback blends back into the "tape" for proper echo build-up.
- **Guide-induced flutter** – Every extra guide post subtly increases wow/flutter depth, mimicking the instability of long, friction-heavy tape paths.

## Getting started

Open `index.html` in any modern browser. No build step required.
