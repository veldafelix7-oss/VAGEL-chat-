/* ============================================================
   VAGEL — voice engine (AudioWorklet)
   Semua pemrosesan suara terjadi di sini, 100% on-device.

   Rantai: input → DC-block → pitch shift (granular 4-grain)
           → ring modulator (robot) → bitcrush → drive
           → vibrato → echo (delay + feedback) → soft clip
   ============================================================ */

const TAU = Math.PI * 2;

/* ---------- pitch shifter: 4 grain overlap (Hann) ---------- */
class PitchShifter {
  constructor(sampleRate) {
    this.sr = sampleRate;
    let size = 1;
    while (size < sampleRate * 0.6) size <<= 1;      // ≥ 0.6 s buffer
    this.size = size;
    this.mask = size - 1;
    this.buf = new Float32Array(size);
    this.w = 0;
    this.phase = 0;
    this.grains = 4;
    this.inv = 1 / this.grains;
    this.gainNorm = 2 / this.grains;                   // sum(Hann) = grains / 2
  }

  /* returns pitch-shifted sample */
  process(x, ratio, grainSamples) {
    // tulis input ke delay line
    this.buf[this.w & this.mask] = x;

    // geser fase baca: delay = phase * grain
    this.phase += (1 - ratio) / grainSamples;
    this.phase -= Math.floor(this.phase);              // → [0,1)

    let out = 0;
    for (let k = 0; k < this.grains; k++) {
      let p = this.phase + k * this.inv;
      if (p >= 1) p -= 1;

      const delay = p * grainSamples;                  // ≥ 0 sampel
      const rp = this.w - delay;
      const i0 = Math.floor(rp);
      const frac = rp - i0;

      const a = this.buf[i0 & this.mask];
      const b = this.buf[(i0 + 1) & this.mask];
      const s = a + (b - a) * frac;

      // window Hann: 0.5 - 0.5·cos(2πp) → jumlah 4 grain = 2
      const win = 0.5 - 0.5 * Math.cos(TAU * p);
      out += s * win;
    }

    this.w = (this.w + 1) & this.mask;
    return out * this.gainNorm;
  }
}

/* ---------- echo / delay dengan feedback ---------- */
class Echo {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.size = Math.ceil(sampleRate * 1.2);
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.dSmooth = sampleRate * 0.18;
  }
  process(x, delaySec, fb) {
    const target = Math.max(1, Math.min(this.size - 2, delaySec * this.sr));
    this.dSmooth += (target - this.dSmooth) * 0.0006;  // hindari klik saat ubah waktu

    let rp = this.w - this.dSmooth;
    while (rp < 0) rp += this.size;

    const i0 = Math.floor(rp);
    const frac = rp - i0;
    const a = this.buf[i0 % this.size];
    const b = this.buf[(i0 + 1) % this.size];
    const d = a + (b - a) * frac;

    this.buf[this.w] = x + d * fb;
    this.w = (this.w + 1) % this.size;
    return d;
  }
}

/* ---------- processor ---------- */
class VagelVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch',    defaultValue: 0,    minValue: -24, maxValue: 24,   automationRate: 'k-rate' },
      { name: 'ringFreq', defaultValue: 0,    minValue: 0,   maxValue: 400,  automationRate: 'k-rate' },
      { name: 'ringMix',  defaultValue: 0,    minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'drive',    defaultValue: 0,    minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'echoMix',  defaultValue: 0,    minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'echoTime', defaultValue: 0.18, minValue: 0.02, maxValue: 0.7, automationRate: 'k-rate' },
      { name: 'echoFb',   defaultValue: 0.28, minValue: 0,   maxValue: 0.86, automationRate: 'k-rate' },
      { name: 'vibrato',  defaultValue: 0,    minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'crush',    defaultValue: 0,    minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'gain',     defaultValue: 0.85, minValue: 0,   maxValue: 1.6,  automationRate: 'k-rate' },
      { name: 'grain',    defaultValue: 0.055, minValue: 0.02, maxValue: 0.12, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;

    this.shifter = new PitchShifter(sr);
    this.echo = new Echo(sr);

    // DC blocker / highpass
    this.dcX = 0; this.dcY = 0;

    // ring modulator
    this.ringPhase = 0;

    // vibrato LFO
    this.lfoPhase = 0;

    // smoothing
    this.ratioSmooth = 1;
    this.mixSmooth = 0;      // banyaknya sinyal hasil pitch-shift yang dipakai
    this.grainSmooth = 0.055 * sr;

    this.peak = 1e-4;
    this.frameCount = 0;

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'ping') this.port.postMessage({ type: 'pong', peak: this.peak });
    };
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output.length) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const inCh = input && input.length ? input[0] : null;

    const n = outL.length;

    const pitch = params.pitch[0];
    const ringFreq = params.ringFreq[0];
    const ringMix = params.ringMix[0];
    const drive = params.drive[0];
    const echoMix = params.echoMix[0];
    const echoTime = params.echoTime[0];
    const echoFb = params.echoFb[0];
    const vibrato = params.vibrato[0];
    const crush = params.crush[0];
    const gain = params.gain[0];
    const grainSec = params.grain[0];

    const ratioTarget = Math.pow(2, pitch / 12);
    // bypass bertahap kalau pitch ~0 supaya tidak ada artefak granular
    const mixTarget = Math.min(1, Math.abs(pitch) / 0.85);
    const grainTarget = Math.max(256, grainSec * this.sr);

    const ringInc = ringFreq / this.sr;
    const lfoInc = 5.2 / this.sr;
    const driveK = 1 + drive * 9;
    const driveNorm = 1 / Math.tanh(driveK);
    const crushOn = crush > 0.02;
    const crushLevels = crushOn ? Math.pow(2, 15 - crush * 12) : 0;
    const ringOn = ringMix > 0.001 && ringFreq > 0.01;

    for (let i = 0; i < n; i++) {
      let x = inCh ? inCh[i] : 0;

      // DC block (highpass ~70 Hz)
      const y = x - this.dcX + 0.9955 * this.dcY;
      this.dcX = x;
      this.dcY = y;
      x = y;

      // smoothing parameter (per-sample satu pole)
      this.ratioSmooth += (ratioTarget - this.ratioSmooth) * 0.02;
      this.mixSmooth += (mixTarget - this.mixSmooth) * 0.02;
      this.grainSmooth += (grainTarget - this.grainSmooth) * 0.02;

      // vibrato
      let ratio = this.ratioSmooth;
      if (vibrato > 0.001) {
        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= 1;
        ratio *= 1 + vibrato * 0.07 * Math.sin(TAU * this.lfoPhase);
      }

      // pitch shift + blend dengan sinyal kering
      const shifted = this.shifter.process(x, ratio, this.grainSmooth);
      let s = x + (shifted - x) * this.mixSmooth;

      // ring modulator (robot / alien)
      if (ringOn) {
        this.ringPhase += ringInc;
        if (this.ringPhase >= 1) this.ringPhase -= 1;
        const mod = Math.sin(TAU * this.ringPhase);
        s = s * (1 - ringMix) + s * mod * ringMix;
      }

      // bitcrush
      if (crushOn) {
        s = Math.round(s * crushLevels) / crushLevels;
      }

      // distorsi (soft saturation)
      if (drive > 0.001) {
        s = Math.tanh(s * driveK) * driveNorm;
      }

      // echo
      if (echoMix > 0.001) {
        const d = this.echo.process(s, echoTime, echoFb);
        s = s + d * echoMix;
      }

      // output gain + soft clip
      s *= gain;
      if (s > 1) s = 1 - 1 / (s * s + 0.4);
      else if (s < -1) s = -(1 - 1 / (s * s + 0.4));
      else s = s - (s * s * s) / 7;          // soft tanh-ish

      outL[i] = s;
      if (outR !== outL) outR[i] = s;
    }

    this.frameCount++;
    return true;
  }
}

registerProcessor('vagel-voice', VagelVoice);
