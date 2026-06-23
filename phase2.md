# little-moons — phase two spec

builds on the original spec. two goals: fix the MIDI drone bug, add a
standalone browser-synth voice so the whole thing can run without an
external MIDI destination.

## for claude code

this is an existing codebase now — read `src/physics.js`, `src/midi.js`,
and `src/main.js` before changing anything. the bug fix and the new voice
both hook into the existing per-tick moon/planet distance logic; don't
duplicate that calculation.

## part 1 — fix the static drone

### diagnosis

the note holds but never changes volume. almost certainly one of:

1. CC#11 (Expression) is only sent in the note-on branch, not on every tick
   while the note continues to sound — so it gets one value, then nothing.
2. the receiving instrument doesn't respond to CC#11 specifically.

### fix

in the per-moon, per-planet tick logic, make sure the "already sounding"
branch unconditionally sends an updated CC#11 value derived from current
distance — every tick, not just on the transition into range.

```
if planet within radiusOfInfluence:
  if not voice.active:
    voice.active = true
    sendNoteOn(channel, note, velocityFromDistance(d))
  sendCC(channel, EXPRESSION_CC, levelFromDistance(d))   // ← every tick, unconditional
else:
  if voice.active:
    voice.active = false
    sendNoteOff(channel, note)
```

add a small dead-zone so it's not spamming identical values: only send if
the mapped value has changed by more than ~1–2 (out of 127) since the last
send for that voice. cuts MIDI traffic without losing perceptible movement.

make the controller number a constant at the top of the file
(`EXPRESSION_CC = 11`), not hardcoded inline — if part 1's diagnosis turns
out to be "the synth ignores CC11," swapping to CC#7 (Channel Volume) should
be a one-line change.

### acceptance check

with a moon slowly drifting past a planet, the Reaper track receiving that
moon's channel should show clearly swelling/fading volume on the meter, not
a flat sustained level. confirm by ear, not just by eye.

## part 2 — voice abstraction

right now the tick loop talks to MIDI directly. pull that apart so it talks
to a generic **voice** interface instead, with MIDI as one implementation
and a new browser synth as the other. both implementations get driven by
the same three events:

```js
voice.on(moonId, planetId, note, velocity)   // entering range
voice.setLevel(moonId, planetId, level)      // 0–1, every tick while sounding
voice.off(moonId, planetId)                  // leaving range
```

the tick loop calls these on whichever backend(s) are active — see output
selection below. this is the same split as DSP-core-vs-UI in laminar-stretch:
the physics/trigger logic doesn't know or care what's making sound.

### file changes

```
src/
  physics.js          // unchanged
  voice.js            // defines the interface above, nothing else
  voices/
    midi-voice.js      // existing logic, refactored to implement the interface
    webaudio-voice.js  // new
  main.js              // ticks physics, calls voice events on active backend(s)
```

## part 3 — browser synth voice (`webaudio-voice.js`)

a pad, not a beep. per active (moon, planet) pair, build a small voice graph:

```
osc1 ──┐
osc2 ──┼─→ filter (lowpass) ─→ gain ─→ [optional reverb send] ─→ master gain ─→ destination
osc3 ──┘
```

- **oscillators**: 2–3 per voice, sawtooth or triangle, slightly detuned
  from each other (a few cents) for unison warmth. frequency from standard
  MIDI-note-to-Hz conversion: `440 * 2^((note - 69) / 12)`.
- **filter**: lowpass, cutoff somewhere around 800–2000Hz to start, gently
  modulated over time (slow LFO on cutoff, a couple of Hz at most) for
  movement rather than a static tone.
- **envelope / level**: this is where `setLevel` lands —
  `gain.gain.setTargetAtTime(level, audioCtx.currentTime, 0.15)` or similar,
  a short time constant so it follows distance smoothly without zipper
  noise. on `on()`, start from 0 and ramp up (soft attack, ~100–300ms). on
  `off()`, ramp to 0 over a similar window before stopping/disconnecting
  the oscillators — never hard-stop a running oscillator, it clicks.
- **reverb**: one shared `ConvolverNode` (or a simple feedback delay if you
  don't want to source/generate an impulse response) on a send bus, all
  voices route a portion of their signal through it. keeps it cheap — one
  reverb instance, not one per voice.
- **polyphony**: no hard channel limit like MIDI's 16, but cap total
  simultaneous voices (e.g. 16–24) for CPU sanity, since up to 5 moons ×
  several planets in range simultaneously is plausible. if you hit the cap,
  just don't start a new voice rather than stealing one — simplest option,
  fine for this use case.

## output selection

let both backends run simultaneously if both are wanted — they're
independent listeners on the same tick events, no reason to force a choice.
two checkboxes in the UI: **MIDI** (device dropdown, as before) and
**browser synth** (no setup needed). default browser synth **on**, MIDI
**off** — that's the standalone path, and MIDI becomes the opt-in extra for
when Reaper's running.

## stretch (not phase two, just noting for later)

- stereo pan per moon based on its x position in the space
  (`StereoPannerNode`) — ties the visual position to the stereo field,
  fits the spatial/ambient direction
- per-voice or global filter cutoff exposed as a UI control
- reverb mix knob

## MVP for this phase

- CC#11 (or CC#7, whichever works) updates continuously, drone bug
  confirmed fixed by ear
- voice interface in place, MIDI backend refactored onto it with no
  behaviour change
- browser synth backend working: audible pad swells in and fades as a moon
  approaches/leaves a planet, no clicks on start/stop
- both backends toggleable independently, browser synth on by default