const MAX_VOICES = 20;

export const DEFAULT_SYNTH_PARAMS = {
  waveform:     'sawtooth',
  filterFreq:   1100,
  lfoRate:      0.3,
  detuneSpread: 8,
  reverb:       0.28,
  volume:       0.7,
};

// ── Per-voice graph ────────────────────────────────────────────────────────

class VoiceGraph {
  constructor(note, ctx, masterGain, reverbNode, params) {
    this._ctx = ctx;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const { waveform, filterFreq, lfoRate, detuneSpread } = params;

    const detunes = [0, detuneSpread, -Math.round(detuneSpread * 0.75)];
    this._oscs = detunes.map(cents => {
      const osc = ctx.createOscillator();
      osc.type = waveform;
      osc.frequency.value = freq;
      osc.detune.value = cents;
      return osc;
    });

    this._oscMix = ctx.createGain();
    this._oscMix.gain.value = 1 / 3;
    for (const osc of this._oscs) osc.connect(this._oscMix);

    this._filter = ctx.createBiquadFilter();
    this._filter.type = 'lowpass';
    this._filter.frequency.value = filterFreq;
    this._filter.Q.value = 0.8;

    // LFO depth scales with filter freq so modulation stays proportional
    this._lfo = ctx.createOscillator();
    this._lfo.frequency.value = lfoRate;
    this._lfoGain = ctx.createGain();
    this._lfoGain.gain.value = filterFreq * 0.3;
    this._lfo.connect(this._lfoGain);
    this._lfoGain.connect(this._filter.frequency);

    this._gain = ctx.createGain();
    this._gain.gain.value = 0;

    this._sendGain = ctx.createGain();
    this._sendGain.gain.value = 0.35;

    this._oscMix.connect(this._filter);
    this._filter.connect(this._gain);
    this._gain.connect(masterGain);
    this._gain.connect(this._sendGain);
    this._sendGain.connect(reverbNode);

    const now = ctx.currentTime;
    for (const osc of this._oscs) osc.start(now);
    this._lfo.start(now);
  }

  update(params, skipFilter = false) {
    const now = this._ctx.currentTime;
    const { filterFreq, lfoRate, detuneSpread } = params;

    if (!skipFilter) {
      this._filter.frequency.setTargetAtTime(filterFreq, now, 0.08);
      this._lfoGain.gain.setTargetAtTime(filterFreq * 0.3, now, 0.08);
    }
    this._lfo.frequency.setTargetAtTime(lfoRate, now, 0.05);

    const detunes = [0, detuneSpread, -Math.round(detuneSpread * 0.75)];
    for (let i = 0; i < this._oscs.length; i++) {
      this._oscs[i].detune.setTargetAtTime(detunes[i], now, 0.05);
    }
  }

  setWaveform(type) {
    for (const osc of this._oscs) osc.type = type;
  }

  setFilter(freq) {
    const now = this._ctx.currentTime;
    this._filter.frequency.setTargetAtTime(freq, now, 0.15);
    this._lfoGain.gain.setTargetAtTime(freq * 0.3, now, 0.15);
  }

  setLevel(level, tc = 0.12) {
    this._gain.gain.setTargetAtTime(level * 0.55, this._ctx.currentTime, tc);
  }

  stop() {
    const now     = this._ctx.currentTime;
    const release = 0.25;
    this._gain.gain.setTargetAtTime(0, now, release / 3);
    const stopAt = now + release * 3;
    for (const osc of this._oscs) { try { osc.stop(stopAt); } catch (_) {} }
    try { this._lfo.stop(stopAt); } catch (_) {}
    setTimeout(() => {
      try { this._gain.disconnect(); } catch (_) {}
      try { this._sendGain.disconnect(); } catch (_) {}
    }, (release * 3 + 0.15) * 1000);
  }
}

// ── Shared reverb IR ───────────────────────────────────────────────────────

function buildIR(ctx) {
  const sr     = ctx.sampleRate;
  const length = Math.round(sr * 2.2);
  const buf    = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.8);
    }
  }
  return buf;
}

// ── WebAudioVoice ──────────────────────────────────────────────────────────

export class WebAudioVoice {
  constructor() {
    this._ctx        = null;
    this._masterGain = null;
    this._reverbNode = null;
    this._reverbOut  = null;
    this._voices        = new Map();
    this._params        = { ...DEFAULT_SYNTH_PARAMS };
    this._filterMode    = 'dynamic';
    this._waveformMode  = 'random';
    this._moonWaveforms = new Map();
  }

  static get _WAVE_TYPES() { return ['sawtooth', 'triangle', 'sine', 'square']; }

  resume() {
    if (!this._ctx) this._init();
    if (this._ctx.state === 'suspended') this._ctx.resume();
  }

  setFilterMode(mode) {
    this._filterMode = mode;
  }

  setWaveformMode(mode) {
    this._waveformMode = mode;
    this._moonWaveforms.clear();
    if (mode === 'random') {
      for (const [key, v] of this._voices) {
        const moonId = +key.split(':')[0];
        if (!this._moonWaveforms.has(moonId)) {
          const t = WebAudioVoice._WAVE_TYPES;
          this._moonWaveforms.set(moonId, t[Math.floor(Math.random() * t.length)]);
        }
        v.setWaveform(this._moonWaveforms.get(moonId));
      }
    } else {
      this._params.waveform = mode;
      for (const v of this._voices.values()) v.setWaveform(mode);
    }
  }

  updateParams(params) {
    Object.assign(this._params, params);
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(this._params.volume, this._ctx.currentTime, 0.05);
    }
    if (this._reverbOut) {
      this._reverbOut.gain.setTargetAtTime(this._params.reverb, this._ctx.currentTime, 0.05);
    }
    const skipFilter = this._filterMode === 'dynamic';
    for (const v of this._voices.values()) v.update(this._params, skipFilter);
  }

  setMoonFilter(moonId, freq) {
    if (!this._ctx) return;
    const prefix = `${moonId}:`;
    for (const [key, v] of this._voices) {
      if (key.startsWith(prefix)) v.setFilter(freq);
    }
  }

  _init() {
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();

    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._params.volume;
    this._masterGain.connect(this._ctx.destination);

    this._reverbNode = this._ctx.createConvolver();
    this._reverbNode.buffer = buildIR(this._ctx);

    this._reverbOut = this._ctx.createGain();
    this._reverbOut.gain.value = this._params.reverb;
    this._reverbNode.connect(this._reverbOut);
    this._reverbOut.connect(this._ctx.destination);
  }

  on(moonId, planetId, note, velocity) {
    if (!this._ctx) this._init();
    if (this._ctx.state === 'suspended') this._ctx.resume();

    const key = `${moonId}:${planetId}`;
    if (this._voices.has(key)) return;
    if (this._voices.size >= MAX_VOICES) return;

    let waveform = this._params.waveform;
    if (this._waveformMode === 'random') {
      if (!this._moonWaveforms.has(moonId)) {
        const t = WebAudioVoice._WAVE_TYPES;
        this._moonWaveforms.set(moonId, t[Math.floor(Math.random() * t.length)]);
      }
      waveform = this._moonWaveforms.get(moonId);
    }

    const v = new VoiceGraph(note, this._ctx, this._masterGain, this._reverbNode, { ...this._params, waveform });
    this._voices.set(key, v);
    v.setLevel(velocity);
  }

  setLevel(moonId, planetId, level, tc = 0.12) {
    this._voices.get(`${moonId}:${planetId}`)?.setLevel(level, tc);
  }

  off(moonId, planetId) {
    const key = `${moonId}:${planetId}`;
    const v   = this._voices.get(key);
    if (!v) return;
    v.stop();
    this._voices.delete(key);
  }

  allOff() {
    for (const v of this._voices.values()) v.stop();
    this._voices.clear();
  }
}
