# little-moons

generative drone / MIDI sequencer. planets are notes, moons are voices, distance is volume.

planets are fixed gravity wells, each tied to a note from a chosen scale. little moons
drift between them pulled by gravity. the closer a moon gets to a planet, the louder
that note sounds. output is browser synth, MIDI, or both at once. start it and leave it on.

**[play in browser →](https://furterliza.github.io/little-moons/)**

---

## requirements

- chrome or edge (Web MIDI and AudioContext both need explicit permission; other browsers
  are hit-or-miss)
- HTTPS or localhost
- for MIDI on linux: a virtual port via `snd-virmidi` or a JACK MIDI bridge routed into
  a DAW — there's no MIDI device until you make one

---

## usage

open `index.html`. click anywhere to start audio. hit regenerate to reseed the scene.

---

## noise engine

### browser synth

each active moon–planet pair spawns a voice: three detuned oscillators through a
lowpass filter with LFO modulation, then into a shared convolution reverb.

| parameter | range | default | notes |
|---|---|---|---|
| waveform | rand / saw / tri / sine / sq | rand | rand assigns one waveform per moon and keeps it |
| filter cutoff | dynamic / static (200–3000 hz) | dynamic | dynamic modulates with proximity — 300 hz when far, 2800 hz when close |
| lfo rate | 0.02–2 hz | 0.30 hz | modulates filter cutoff; depth scales with cutoff so it stays proportional |
| detune spread | 0–30 ¢ | 8 ¢ | spread across three oscillators (0, +n, −¾n) |
| reverb | 0–1 | 0.28 | wet mix into a 2.2 s convolution IR |
| volume | 0–1 | 0.70 | master output gain |

### rhythm

controls the gate pattern applied to all voices. does not affect pitch or MIDI note
scheduling — only amplitude.

| mode | behaviour |
|---|---|
| drone | continuous — gate is always open |
| pulse | tight staccato at ~6 Hz, 25% duty |
| morse | dot-dot-dash pattern |
| rand | each moon gets its own randomly generated gate pattern |

### midi

one channel per moon (up to 5 channels). velocity set at note-on from entry distance;
CC#11 (expression) rides the volume continuously while the note holds. browser synth
and MIDI run simultaneously if both are enabled.

---

## universe

| parameter | range | default | notes |
|---|---|---|---|
| planets | 1–10 | random 5–8 | blank field = random each regenerate |
| moons | 1–5 | 3 | blank field = random |
| gravity | 0.1–3 | 1.0 | gravitational constant — higher pulls moons harder and faster |
| moon speed cap | 0.5–5 | 2.0 | maximum moon velocity in world units/sec |
| influence radius | 1–8 | 4.0 | multiplier on planet size — sets the audible radius beyond which a planet is silent |
| root | C3–B5 | C4 | root note of the scale |
| scale | see below | minor pentatonic | |

supported scales: `major` · `natural_minor` · `dorian` · `phrygian` · `minor_pentatonic`
· `major_pentatonic` · `whole_tone` · `chromatic`

notes are spread across two octaves above the root and assigned one per planet.
planet colour is derived from scale position — same note, same hue.

---

## physics

space is 32 × 32 world units, toroidal — moons that drift off one edge reappear on the
opposite side. a moon settling into a slow orbit around one planet produces a held drone.
that's intentional.

---

## stack

vanilla JS · Canvas 2D · Web Audio API · Web MIDI API · no build step

---

little-moons runs entirely in your browser. your audio is never uploaded — all processing
happens locally. no data is collected.

released under the MIT licence.
