import { buildNotePool, SCALE_NAMES } from './scale.js';
import { tickPhysics, tickPlanets, toroidalDistance } from './physics.js';
import * as Midi from './midi.js';
import { render, clearCanvas } from './render.js';
import { MidiVoice }                          from './voices/midi-voice.js';
import { WebAudioVoice, DEFAULT_SYNTH_PARAMS } from './voices/webaudio-voice.js';

const DEFAULT_CONFIG = {
  bounds: 32,
  boundsX: 32,
  boundsY: 32,
  planetCount: null,
  moonCount: 3,
  scaleRoot: 'C4',
  scaleType: 'minor_pentatonic',
  gravityConstant: 1.0,
  maxMoonSpeed: 2.0,
  damping: 0.995,
  maxPlanetSpeed: 0.35,
  planetDamping: 0.984,
  audibleRadiusMultiplier: 4,
  tickRateHz: 25,
};

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

let state        = null;
let tickInterval = null;
let filterMode   = 'dynamic';
let rhythmMode   = 'drone';
let moonRhythms  = new Map(); // moonChannel → [[onSec, offSec], ...]

// Pulse: tight repeated beat ~4/sec; Morse: dot-dot-dash
const RHYTHM_PATTERNS = {
  pulse: [[0.04, 0.12]],  // ~6 Hz, 25% duty — fast staccato
  morse: [[0.12, 0.09], [0.12, 0.09], [0.36, 0.36]],
};

function generateMoonRhythm() {
  const count   = 3 + Math.floor(Math.random() * 4); // 3–6 events
  const pattern = [];
  for (let i = 0; i < count; i++) {
    if (Math.random() < 0.5) {
      pattern.push([0.1 + Math.random() * 0.15, 0.06 + Math.random() * 0.1]);  // short
    } else {
      pattern.push([0.3 + Math.random() * 0.35, 0.12 + Math.random() * 0.2]);  // long
    }
  }
  return pattern;
}

function refreshMoonRhythms() {
  moonRhythms.clear();
  if (rhythmMode === 'random' && state) {
    for (const moon of state.moons) {
      moonRhythms.set(moon.channel, generateMoonRhythm());
    }
  }
}

function getRhythmGate(channel, t) {
  if (rhythmMode === 'drone') return 1;
  const pattern = rhythmMode === 'random'
    ? (moonRhythms.get(channel) ?? null)
    : RHYTHM_PATTERNS[rhythmMode];
  if (!pattern) return 1;
  const total = pattern.reduce((s, [on, off]) => s + on + off, 0);
  let phase = t % total;
  for (const [on, off] of pattern) {
    if (phase < on) return 1;
    phase -= on;
    if (phase < off) return 0;
    phase -= off;
  }
  return 0;
}

const synthVoice = new WebAudioVoice();
const midiVoice  = new MidiVoice();
let activeBackends = [synthVoice];

function resizeCanvas() {
  if (document.body.classList.contains('is-fullscreen')) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width  = Math.round(W * devicePixelRatio);
    canvas.height = Math.round(H * devicePixelRatio);
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
  } else {
    canvas.style.width  = '';
    canvas.style.height = '';
    const rect = canvas.getBoundingClientRect();
    const size = Math.round(rect.width * devicePixelRatio);
    canvas.width  = size;
    canvas.height = size;
    canvas.style.height = `${rect.width}px`;
  }
}

function setFullscreen(on) {
  document.body.classList.toggle('is-fullscreen', on);
  resizeCanvas();

  if (state) {
    const { bounds } = state.config;
    const oldBoundsX = state.config.boundsX;
    // boundsX scales so that one world unit = H/boundsY px in both axes
    const newBoundsX = on
      ? bounds * (canvas.width / devicePixelRatio) / (canvas.height / devicePixelRatio)
      : bounds;

    // Scale body x-positions proportionally so they fill the new world width
    if (newBoundsX !== oldBoundsX) {
      const sx = newBoundsX / oldBoundsX;
      for (const p of state.planets) p.x *= sx;
      for (const m of state.moons)   m.x *= sx;
    }

    state.config = { ...state.config, boundsX: newBoundsX, boundsY: bounds };
    clearCanvas(ctx, canvas);
  }
}

function initScene(config, seed) {
  const rng      = makeRng(seed);
  const notePool = buildNotePool(config.scaleRoot, config.scaleType);
  const shuffled = [...notePool].sort(() => rng() - 0.5);

  const boundsX = config.boundsX ?? config.bounds;
  const boundsY = config.boundsY ?? config.bounds;

  function generateBody() {
    const style      = Math.random() < 0.35 ? 'banded' : 'smooth';
    const lightAngle = Math.random() * Math.PI * 2;
    const lightDist  = 0.2 + Math.random() * 0.25;
    const sat0  = 55 + Math.floor(Math.random() * 25);
    const sat1  = 60 + Math.floor(Math.random() * 20);
    const sat2  = 55 + Math.floor(Math.random() * 20);
    const lit0  = 60 + Math.floor(Math.random() * 20);
    const lit1  = 50 + Math.floor(Math.random() * 15);
    const lit2  = 22 + Math.floor(Math.random() * 20);
    const mid   = 0.25 + Math.random() * 0.3;
    const hueShift2 = (Math.random() - 0.5) * 25;

    const bands = [];
    if (style === 'banded') {
      let y = -1.0;
      while (y < 1.1) {
        const h = 0.07 + Math.random() * 0.22;
        bands.push({
          y:        y + h / 2,
          h:        h / 2,
          hueShift: (Math.random() - 0.5) * 50,
          sat:      50 + Math.random() * 35,
          lit:      25 + Math.random() * 45,
          alpha:    0.25 + Math.random() * 0.45,
          freq:     (1.0 + Math.random() * 3.0) * Math.PI * 2,
          amp:      0.04 + Math.random() * 0.14,
          phase:    Math.random() * Math.PI * 2,
        });
        y += h;
      }
    }

    return { style, lightAngle, lightDist, sat0, sat1, sat2, lit0, lit1, lit2, mid, hueShift2, bands };
  }

  function generateDust() {
    const count = 5 + Math.floor(Math.random() * 4);
    const blobs = [];
    for (let i = 0; i < count; i++) {
      blobs.push({
        a:  Math.random() * Math.PI * 2,
        d:  0.4 + Math.random() * 0.7,
        r:  2.2 + Math.random() * 1.8,
        op: 0.007 + Math.random() * 0.008,
      });
    }
    return {
      blobs,
      hueShift:   (Math.random() - 0.5) * 30,
      haloRadius: 3.0 + Math.random() * 1.2,
      haloOp:     0.008 + Math.random() * 0.008,
    };
  }

  const planetCount = config.planetCount ?? (5 + Math.floor(rng() * 4));
  const planets = [];
  const minSep  = 5;
  let attempts  = 0;

  while (planets.length < planetCount && attempts < 3000) {
    attempts++;
    const x    = rng() * boundsX;
    const y    = rng() * boundsY;
    const size = 0.8 + rng() * 1.7;

    let ok = true;
    for (const p of planets) {
      if (toroidalDistance(x, y, p.x, p.y, boundsX, boundsY) < minSep) { ok = false; break; }
    }
    if (!ok) continue;

    const entry = shuffled[planets.length % shuffled.length];
    planets.push({
      id: planets.length,
      x, y, vx: 0, vy: 0,
      size,
      mass: size,
      note: entry.midi,
      scaleIndex: entry.scaleIndex,
      scaleLength: entry.scaleLength,
      hasRing: Math.random() < (1 / 15),
      dust: generateDust(),
      body: generateBody(),
    });
  }

  const moonCount = config.moonCount ?? (1 + Math.floor(rng() * 4));
  const moons = [];
  for (let i = 0; i < moonCount; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = 0.1 + rng() * 0.3;
    moons.push({
      x: rng() * boundsX,
      y: rng() * boundsY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      channel: i,
    });
  }

  const moonStates = new Map();
  for (const moon of moons) moonStates.set(moon, new Map());

  return { planets, moons, moonStates, config };
}

function tickVoices(state, backends) {
  if (!backends.length) return;
  const { planets, moons, moonStates, config } = state;
  const boundsX = config.boundsX ?? config.bounds;
  const boundsY = config.boundsY ?? config.bounds;
  const t  = performance.now() / 1000;
  const tc = rhythmMode === 'drone' ? 0.12 : rhythmMode === 'pulse' ? 0.02 : 0.04;

  for (const moon of moons) {
    const active = moonStates.get(moon);
    const gate   = getRhythmGate(moon.channel, t);

    if (filterMode === 'dynamic') {
      let maxCloseness = 0;
      for (const planet of planets) {
        const d = toroidalDistance(moon.x, moon.y, planet.x, planet.y, boundsX, boundsY);
        const closeness = Math.max(0, 1 - d / (planet.size * config.audibleRadiusMultiplier));
        if (closeness > maxCloseness) maxCloseness = closeness;
      }
      // log interpolation: 300 Hz when far from all planets → 2800 Hz when right on one
      const dynFreq = 300 * Math.pow(2800 / 300, maxCloseness);
      for (const b of backends) b.setMoonFilter?.(moon.channel, dynFreq);
    }

    for (const planet of planets) {
      const dist      = toroidalDistance(moon.x, moon.y, planet.x, planet.y, boundsX, boundsY);
      const influence = planet.size * config.audibleRadiusMultiplier;
      const wasActive = active.has(planet);
      const level     = Math.max(0, 1 - dist / influence);

      if (dist < influence) {
        if (!wasActive) {
          for (const b of backends) b.on(moon.channel, planet.id, planet.note, level);
          active.set(planet, true);
        }
        for (const b of backends) b.setLevel(moon.channel, planet.id, level * gate, tc);
      } else if (wasActive) {
        for (const b of backends) b.off(moon.channel, planet.id);
        active.delete(planet);
      }
    }
  }
}

function startScene(config, seed) {
  if (tickInterval) clearInterval(tickInterval);
  for (const b of [midiVoice, synthVoice]) b.allOff();

  state = initScene(config, seed);
  refreshMoonRhythms();
  resizeCanvas();
  clearCanvas(ctx, canvas);

  tickInterval = setInterval(() => {
    tickPlanets(state.planets, state.config);
    tickPhysics(state.moons, state.planets, state.config);
    tickVoices(state, activeBackends);
  }, 1000 / config.tickRateHz);
}

function renderLoop() {
  if (state) render(ctx, canvas, state.planets, state.moons, state.config);
  requestAnimationFrame(renderLoop);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function fmt(v, decimals = 1) {
  return parseFloat(v).toFixed(decimals);
}

function bindRange(inputId, displayId, formatter) {
  const input   = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  display.textContent = formatter(input.value);
  input.addEventListener('input', () => { display.textContent = formatter(input.value); });
  return input;
}

function bindSeg(containerId, onChange) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.value);
    });
  });
  return () => container.querySelector('.seg-btn.active').dataset.value;
}

// ── Controls ──────────────────────────────────────────────────────────────────

function buildControls() {
  // ── Accordion ──────────────────────────────────────────────────────────
  document.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.section');
      const isOpen  = section.classList.contains('is-open');
      document.querySelectorAll('.section').forEach(s => {
        s.classList.remove('is-open');
        const ind = s.querySelector('.section-ind');
        if (ind) ind.textContent = '+';
      });
      if (!isOpen) {
        section.classList.add('is-open');
        btn.querySelector('.section-ind').textContent = '−';
      }
    });
  });

  // ── Root / scale selects ───────────────────────────────────────────────
  const rootSelect  = document.getElementById('rootSelect');
  const scaleSelect = document.getElementById('scaleSelect');

  const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  for (const oct of [3, 4, 5]) {
    for (const n of notes) {
      const opt = document.createElement('option');
      opt.value = `${n}${oct}`;
      opt.textContent = `${n}${oct}`;
      if (`${n}${oct}` === DEFAULT_CONFIG.scaleRoot) opt.selected = true;
      rootSelect.appendChild(opt);
    }
  }

  for (const scale of SCALE_NAMES) {
    const opt = document.createElement('option');
    opt.value = scale;
    opt.textContent = scale.replace(/_/g, ' ');
    if (scale === DEFAULT_CONFIG.scaleType) opt.selected = true;
    scaleSelect.appendChild(opt);
  }

  // ── Universe range displays ────────────────────────────────────────────
  const gravityInput   = bindRange('gravityInput',   'gravityVal',   v => fmt(v));
  const speedCapInput  = bindRange('speedCapInput',  'speedCapVal',  v => fmt(v));
  const influenceInput = bindRange('influenceInput', 'influenceVal', v => fmt(v));

  // ── Regenerate ────────────────────────────────────────────────────────
  document.getElementById('regenBtn').addEventListener('click', () => {
    synthVoice.resume();
    const rawPlanets = parseInt(document.getElementById('planetCountInput').value);
    const rawMoons   = parseInt(document.getElementById('moonCountInput').value);
    startScene({
      ...DEFAULT_CONFIG,
      planetCount:            Number.isNaN(rawPlanets) ? null : Math.max(1, Math.min(10, rawPlanets)),
      moonCount:              Number.isNaN(rawMoons)   ? null : Math.max(1, Math.min(5, rawMoons)),
      gravityConstant:        parseFloat(gravityInput.value),
      maxMoonSpeed:           parseFloat(speedCapInput.value),
      audibleRadiusMultiplier: parseFloat(influenceInput.value),
      scaleRoot:              rootSelect.value,
      scaleType:              scaleSelect.value,
    }, (Math.random() * 0xFFFFFFFF) >>> 0);
  });

  // ── Synth params ──────────────────────────────────────────────────────
  bindSeg('waveformSeg', value => synthVoice.setWaveformMode(value));
  synthVoice.setWaveformMode('random'); // match the default active button

  bindSeg('rhythmSeg', value => {
    rhythmMode = value;
    refreshMoonRhythms();
  });

  const filterInput    = bindRange('filterInput', 'filterVal', v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v} hz`);
  const filterModeSelect  = document.getElementById('filterModeSelect');
  const filterStaticWrap  = document.getElementById('filterStaticWrap');
  const filterValEl       = document.getElementById('filterVal');

  function applyFilterMode(mode) {
    filterMode = mode;
    synthVoice.setFilterMode(mode);
    const isStatic = mode === 'static';
    filterStaticWrap.style.display = isStatic ? '' : 'none';
    filterValEl.style.display      = isStatic ? '' : 'none';
  }
  applyFilterMode('dynamic');
  filterModeSelect.addEventListener('change', () => applyFilterMode(filterModeSelect.value));
  const lfoRateInput = bindRange('lfoRateInput', 'lfoRateVal', v => `${fmt(v, 2)} hz`);
  const detuneInput  = bindRange('detuneInput',  'detuneVal',  v => `${v} ¢`);
  const reverbInput  = bindRange('reverbInput',  'reverbVal',  v => fmt(v, 2));
  const volumeInput  = bindRange('volumeInput',  'volumeVal',  v => fmt(v, 2));

  function onSynthChange() {
    synthVoice.updateParams({
      filterFreq:   parseFloat(filterInput.value),
      lfoRate:      parseFloat(lfoRateInput.value),
      detuneSpread: parseInt(detuneInput.value),
      reverb:       parseFloat(reverbInput.value),
      volume:       parseFloat(volumeInput.value),
    });
  }

  for (const el of [filterInput, lfoRateInput, detuneInput, reverbInput, volumeInput]) {
    el.addEventListener('input', onSynthChange);
  }

  // ── Output toggles + MIDI device visibility ────────────────────────────
  const synthToggle    = document.getElementById('synthToggle');
  const midiToggle     = document.getElementById('midiToggle');
  const midiDeviceWrap = document.getElementById('midiDeviceWrap');
  const synthParams    = document.getElementById('synthParams');

  function setSynthParamsVisible(v) { synthParams.style.display = v ? '' : 'none'; }
  setSynthParamsVisible(synthToggle.checked);

  function setMidiDeviceVisible(visible) {
    midiDeviceWrap.style.display = visible ? '' : 'none';
  }
  setMidiDeviceVisible(false); // MIDI off by default

  function updateBackends() {
    const removing = activeBackends.filter(b =>
      (b === synthVoice && !synthToggle.checked) ||
      (b === midiVoice  && !midiToggle.checked),
    );
    for (const b of removing) b.allOff();
    activeBackends = [
      ...(synthToggle.checked ? [synthVoice] : []),
      ...(midiToggle.checked  ? [midiVoice]  : []),
    ];
  }

  synthToggle.addEventListener('change', () => {
    if (synthToggle.checked) synthVoice.resume();
    setSynthParamsVisible(synthToggle.checked);
    updateBackends();
  });

  midiToggle.addEventListener('change', () => {
    setMidiDeviceVisible(midiToggle.checked);
    updateBackends();
  });

  // ── Fullscreen ────────────────────────────────────────────────────────
  document.getElementById('fullscreenBtn').addEventListener('click',  () => setFullscreen(true));
  document.getElementById('fullscreenExit').addEventListener('click', () => setFullscreen(false));
  document.getElementById('fullscreenRegen').addEventListener('click', () => document.getElementById('regenBtn').click());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('is-fullscreen')) setFullscreen(false);
  });

  // ── Theme ──────────────────────────────────────────────────────────────
  const themeBtn = document.getElementById('themeBtn');
  function applyTheme(mode) {
    if (mode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      themeBtn.textContent = '[ dark ]';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeBtn.textContent = '[ light ]';
    }
  }
  applyTheme(localStorage.getItem('theme') || 'dark');
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });
}

async function setupMidi() {
  const select = document.getElementById('midiSelect');
  const caveat = document.getElementById('midiCaveat');
  const result = await Midi.initMidi();

  if (result.error === 'no-api') {
    caveat.textContent = 'web midi not supported — try chrome or edge.';
    select.innerHTML = '<option value="">— unavailable —</option>';
    return;
  }
  if (result.error === 'denied') {
    caveat.textContent = 'midi permission denied.';
    select.innerHTML = '<option value="">— access denied —</option>';
    return;
  }

  const outputs = result.outputs;
  if (outputs.length === 0) {
    select.innerHTML = '<option value="">— no devices —</option>';
    caveat.textContent = 'no midi output found. on linux: try snd-virmidi or a jack midi bridge.';
    return;
  }

  select.innerHTML = '<option value="">— select device —</option>';
  for (const out of outputs) {
    const opt = document.createElement('option');
    opt.value = out.id;
    opt.textContent = out.name;
    select.appendChild(opt);
  }
  select.value = outputs[0].id;
  Midi.setOutput(outputs[0].id);

  select.addEventListener('change', () => {
    midiVoice.allOff();
    Midi.setOutput(select.value);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  buildControls();
  await setupMidi();

  const startHint = document.getElementById('startHint');
  document.addEventListener('pointerdown', () => {
    synthVoice.resume();
    startHint.style.display = 'none';
  }, { once: true });

  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (state) clearCanvas(ctx, canvas);
  });

  startScene(DEFAULT_CONFIG, (Math.random() * 0xFFFFFFFF) >>> 0);
  requestAnimationFrame(renderLoop);
});
