// Voice backend interface
//
// on(moonId, planetId, note, velocity)  — note: MIDI note number, velocity: 0–1
// setLevel(moonId, planetId, level)     — level: 0–1, called every tick while sounding
// off(moonId, planetId)                 — leaving influence radius
// allOff()                              — silence everything (scene reset, backend disabled)
