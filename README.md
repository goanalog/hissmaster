# Tape Loop Lab

A cassette-inspired loop sandbox. Load audio into the deck, adjust transport direction, speed, and routing posts, and watch the
virtual tape path respond in real time. Capture a quick idea directly from your microphone with the **Sample Mic** button.

### Physical modelling highlights

- **Loop physics readout** – The SVG path length is continuously sampled and reported as physical inches/feet so you can relate a
  short, glitchy loop to a long ambient drift.
- **Real IPS speed control** – The transport runs from 1.875 to 15 inches-per-second. The UI shows the implied loop duration and
  pitch shift relative to a 7.5 IPS reference so you can hear the "bright vs. dark" trade-off.
- **Record/Play head distance** – Dragging guide posts re-shapes the loop while a dedicated slider sets the head spacing that feeds
  a synced delay line. Feedback blends back into the "tape" for proper echo build-up.
- **Guide-induced flutter** – Every extra guide post subtly increases wow/flutter depth, mimicking the instability of long,
  friction-heavy tape paths.
- **Rounded guide wraps** – The tape now hugs reels and posts with smooth arcs, so moving the default guides (or adding your own)
  redraws the loop like the real cassette diagrams that inspired the lab.
- **Directional tape animation** – The tape ribbon renders as a continuous loop with a shimmering dash pattern, animated tracer
  dots, and a bright play-head halo so you always see the speed and direction the tape is travelling.
- **Tone & flutter shaping** – A low-cut slider feeds the high-pass stage and a dedicated wow/flutter control scales the
  modulation depth so "more flutter" audibly delivers more wobble.

### Tape head gaps & covering the erase head

- **Erase → record gap** – On most cassette decks the tape hits the erase head first, then the record head. That physical gap
  means a short strip of tape is wiped clean before new audio is laid down, which translates into a tiny silent splice each time
  the loop comes back around.
- **Record → play gap** – Three-head decks separate record and play heads, introducing a delay equal to the head spacing divided
  by tape speed. This is the timing foundation the built-in echo control is modelling.
- **Cover the erase head, not record** – When you mask the erase head with tape or foil you stop the wipe cycle, eliminating the
  silent splice and enabling sound-on-sound overdubs. Covering the record head would simply prevent new material from ever
  hitting the tape.

## Getting started

Open `index.html` in any modern browser. No build step required.
