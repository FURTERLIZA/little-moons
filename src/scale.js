const SCALES = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  natural_minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  whole_tone:       [0, 2, 4, 6, 8, 10],
  chromatic:        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function parseRoot(rootStr) {
  const match = rootStr.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) throw new Error(`invalid root: ${rootStr}`);
  const noteIndex = NOTE_NAMES.indexOf(match[1]);
  const octave = parseInt(match[2], 10);
  return (octave + 1) * 12 + noteIndex;
}

export function buildNotePool(rootStr, scaleType) {
  const intervals = SCALES[scaleType];
  if (!intervals) throw new Error(`unknown scale: ${scaleType}`);
  const rootMidi = parseRoot(rootStr);
  const scaleLength = intervals.length;

  const pool = [];
  for (let octave = 0; octave < 2; octave++) {
    for (let i = 0; i < intervals.length; i++) {
      const midi = rootMidi + octave * 12 + intervals[i];
      if (midi >= 0 && midi <= 127) {
        pool.push({ midi, scaleIndex: i, scaleLength });
      }
    }
  }
  return pool;
}

export const SCALE_NAMES = Object.keys(SCALES);
export const NOTE_NAME_LIST = NOTE_NAMES;
