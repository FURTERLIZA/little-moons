let midiAccess = null;
let output = null;

export async function initMidi() {
  if (!navigator.requestMIDIAccess) return { error: 'no-api' };
  try {
    midiAccess = await navigator.requestMIDIAccess();
    return { outputs: getOutputs() };
  } catch (e) {
    return { error: 'denied' };
  }
}

export function getOutputs() {
  if (!midiAccess) return [];
  return [...midiAccess.outputs.values()].map(o => ({ id: o.id, name: o.name }));
}

export function setOutput(id) {
  if (!midiAccess) return;
  output = midiAccess.outputs.get(id) ?? null;
}

export function noteOn(channel, note, velocity) {
  if (!output) return;
  output.send([0x90 | (channel & 0xF), note & 0x7F, velocity & 0x7F]);
}

export function noteOff(channel, note) {
  if (!output) return;
  output.send([0x80 | (channel & 0xF), note & 0x7F, 0]);
}

export function expression(channel, value) {
  if (!output) return;
  output.send([0xB0 | (channel & 0xF), 11, value & 0x7F]);
}

export function allNotesOff() {
  if (!output) return;
  for (let ch = 0; ch < 16; ch++) {
    output.send([0xB0 | ch, 123, 0]);
  }
}
