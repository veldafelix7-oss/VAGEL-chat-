/* ============================================================
   VAGEL — test DSP tanpa browser
   Jalankan: node tests/dsp.test.js
   Memastikan pitch naik/turun tepat dan tidak ada NaN.
   ============================================================ */
const path = require('path');

global.sampleRate = 48000;
global.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null, postMessage() {} }; }
};
let Proc = null;
global.registerProcessor = (name, cls) => { Proc = cls; };
require(path.join(__dirname, '..', 'js', 'worklet.js'));

const SR = 48000;
const P = new Proc();
const defaults = {};
for (const d of Proc.parameterDescriptors) defaults[d.name] = d.defaultValue;

function run(params, freqIn, seconds) {
  const n = 128;
  const total = Math.floor((seconds * SR) / n);
  const out = [];
  const p = { ...defaults };
  for (const k of Object.keys(params)) p[k] = [params[k]];
  for (const k of Object.keys(p)) if (!Array.isArray(p[k])) p[k] = [p[k]];

  let t = 0;
  for (let b = 0; b < total; b++) {
    const inp = new Float32Array(n);
    for (let i = 0; i < n; i++) inp[i] = 0.4 * Math.sin((2 * Math.PI * freqIn * (t + i)) / SR);
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    P.process([[inp]], [[L, R]], p);
    if (b > total * 0.45) out.push(...L);
    t += n;
  }
  return Float32Array.from(out);
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

function dominant(a) {
  let best = 0;
  let bestLag = 1;
  for (let lag = Math.floor(SR / 1200); lag < Math.floor(SR / 60); lag++) {
    let c = 0;
    for (let i = 0; i + lag < a.length; i += 3) c += a[i] * a[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  return SR / bestLag;
}

const cases = [
  { name: 'normal (pitch 0)', p: { pitch: 0 } },
  { name: 'cewek (+7 st)', p: { pitch: 7 } },
  { name: 'cowok (-4 st)', p: { pitch: -4 } },
  { name: 'bayi (+11 st)', p: { pitch: 11 } },
  { name: 'monster (-9 st)', p: { pitch: -9, drive: 0.5, vibrato: 0.18 } },
  { name: 'robot', p: { ringFreq: 88, ringMix: 0.95, crush: 0.32, drive: 0.18 } },
  { name: 'hantu (gema)', p: { pitch: -3, echoMix: 0.5, echoTime: 0.36, echoFb: 0.58 } },
];

let fails = 0;
for (const c of cases) {
  const y = run(c.p, 220, 1.2);
  const r = rms(y);
  let nan = 0;
  for (const v of y) if (!Number.isFinite(v)) nan++;
  const f = dominant(y);
  const expect = 220 * Math.pow(2, (c.p.pitch || 0) / 12);
  const pitched = c.p.pitch !== undefined && c.p.pitch !== 0;
  const freqOk = !pitched || Math.abs(f - expect) / expect < 0.08;
  const ok = nan === 0 && r > 0.01 && r < 1.4 && freqOk;
  if (!ok) fails++;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(16)} rms=${r.toFixed(3)} nan=${nan} ` +
    `f≈${f.toFixed(0)}Hz (harap ${expect.toFixed(0)})`
  );
}

const silence = run({ pitch: 7, ringFreq: 88, ringMix: 0.9 }, 0, 0.5);
const silentOk = rms(silence) < 1e-4;
if (!silentOk) fails++;
console.log(`${silentOk ? 'OK  ' : 'FAIL'} sunyi            rms=${rms(silence).toExponential(2)}`);

console.log(fails === 0 ? '\nSEMUA DSP TEST LOLOS' : `\n${fails} TEST GAGAL`);
process.exit(fails === 0 ? 0 : 1);
