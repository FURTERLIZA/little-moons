import * as Midi from '../midi.js';

// Swap to CC#7 (Channel Volume) here if a synth ignores CC#11
const EXPRESSION_CC = 11;

export class MidiVoice {
  constructor() {
    this._notes     = new Map(); // `${moonId}:${planetId}` → note number
    this._lastLevel = new Map(); // `${moonId}:${planetId}` → last sent 0–127 value
  }

  on(moonId, planetId, note, velocity) {
    const key = `${moonId}:${planetId}`;
    this._notes.set(key, note);
    Midi.noteOn(moonId, note, Math.round(velocity * 127));
  }

  setLevel(moonId, planetId, level, _tc) {
    const key = `${moonId}:${planetId}`;
    const val  = Math.round(level * 127);
    const last = this._lastLevel.get(key) ?? -99;
    if (Math.abs(val - last) <= 1) return;
    this._lastLevel.set(key, val);
    Midi.expression(moonId, val);
  }

  off(moonId, planetId) {
    const key  = `${moonId}:${planetId}`;
    const note = this._notes.get(key);
    if (note !== undefined) {
      Midi.noteOff(moonId, note);
      this._notes.delete(key);
    }
    this._lastLevel.delete(key);
  }

  allOff() {
    this._notes.clear();
    this._lastLevel.clear();
    Midi.allNotesOff();
  }
}
