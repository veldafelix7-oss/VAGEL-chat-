/* ============================================================
   VAGEL — voice lab  ·  app logic
   Tanpa API key. Tanpa server. Semua DSP ada di js/worklet.js
   ============================================================ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ── preset efek ──────────────────────────────────────────── */
const BASE = {
  pitch: 0, ringFreq: 0, ringMix: 0, drive: 0.04,
  echoMix: 0, echoTime: 0.18, echoFb: 0.28,
  vibrato: 0, crush: 0, gain: 0.9, grain: 0.055, tone: 'full',
};

const PRESETS = [
  { id: 'clean',   label: 'Normal',  emoji: '🎙️', desc: 'suara asli',     p: {} },
  { id: 'girl',    label: 'Cewek',   emoji: '👩', desc: 'nada tinggi',    p: { pitch: 7, grain: 0.045 } },
  { id: 'boy',     label: 'Cowok',   emoji: '🧔', desc: 'nada berat',     p: { pitch: -4, grain: 0.05 } },
  { id: 'bayi',    label: 'Bayi',    emoji: '👶', desc: 'nada paling high', p: { pitch: 11, grain: 0.04 } },
  { id: 'monster', label: 'Monster', emoji: '👹', desc: 'dalam + serak',  p: { pitch: -9, drive: 0.5, vibrato: 0.18, grain: 0.07 } },
  { id: 'robot',   label: 'Robot',   emoji: '🤖', desc: 'metalik',        p: { ringFreq: 88, ringMix: 0.95, crush: 0.32, drive: 0.18 } },
  { id: 'alien',   label: 'Alien',   emoji: '👽', desc: 'getar aneh',     p: { pitch: 4, ringFreq: 26, ringMix: 0.62, vibrato: 0.5 } },
  { id: 'hantu',   label: 'Hantu',   emoji: '👻', desc: 'gema panjang',   p: { pitch: -3, vibrato: 0.3, echoMix: 0.5, echoTime: 0.36, echoFb: 0.58, grain: 0.07 } },
  { id: 'radio',   label: 'Radio',   emoji: '📻', desc: 'suara HT/ponsel', p: { tone: 'phone', drive: 0.35, crush: 0.2 } },
  { id: 'stadion', label: 'Stadion', emoji: '📢', desc: 'gema ruangan',   p: { drive: 0.15, echoMix: 0.45, echoTime: 0.5, echoFb: 0.42 } },
];

const presetById = (id) => PRESETS.find((x) => x.id === id) || PRESETS[0];
const mergedPreset = (id) => ({ ...BASE, ...presetById(id).p });

/* ── elemen ───────────────────────────────────────────────── */
const el = {
  sidebar: $('#sidebar'),
  scrim: $('#scrim'),
  openSidebar: $('#openSidebar'),
  closeSidebar: $('#closeSidebar'),
  presetSide: $('#presetListSidebar'),
  chips: $('#chips'),
  orb: $('#orb'),
  orbGlyph: $('#orbGlyph'),
  effectName: $('#effectName'),
  timer: $('#timer'),
  wave: $('#wave'),
  hint: $('#hint'),
  liveBadge: $('#liveBadge'),
  mainBtn: $('#mainBtn'),
  muteBtn: $('#muteBtn'),
  recBtn: $('#recBtn'),
  roomLabel: $('#roomLabel'),
  recSheet: $('#recSheet'),
  closeSheet: $('#closeSheet'),
  recAudio: $('#recAudio'),
  saveRec: $('#saveRec'),
  shareRec: $('#shareRec'),
  toast: $('#toast'),
  srInfo: $('#srInfo'),
  latInfo: $('#latInfo'),
  stInfo: $('#stInfo'),
  installBtn: $('#installBtn'),
  resetBtn: $('#resetBtn'),
  monitorSw: $('#monitorSw'),
  nsSw: $('#nsSw'),
  wakeSw: $('#wakeSw'),
  sliders: {
    pitch: $('#pitch'), ring: $('#ring'), echo: $('#echo'),
    drive: $('#drive'), vib: $('#vib'), gain: $('#gain'),
  },
  vals: {
    pitch: $('#pitchVal'), ring: $('#ringVal'), echo: $('#echoVal'),
    drive: $('#driveVal'), vib: $('#vibVal'), gain: $('#gainVal'),
  },
};

/* ── state ────────────────────────────────────────────────── */
const saved = readStore();
const state = {
  presetId: saved.presetId || 'clean',
  custom: saved.custom || null,
  monitor: saved.monitor !== false,
  noiseSuppress: saved.noiseSuppress === true,
  keepAwake: saved.keepAwake !== false,
  running: false,
  muted: false,
  recording: false,
  startedAt: 0,
};

const engine = {
  ctx: null, stream: null, src: null, inGain: null, micAnalyser: null,
  hp: null, voice: null, tone: null, comp: null, outAnalyser: null,
  master: null, recDest: null, wakeLock: null, recorder: null,
  micBuf: null, outBuf: null, level: 0,
};

let rafId = 0;
let installEvent = null;
let recChunks = [];
let recUrl = null;

/* ── util ─────────────────────────────────────────────────── */
function readStore() {
  try { return JSON.parse(localStorage.getItem('vagel.v1') || '{}'); }
  catch { return {}; }
}
function writeStore() {
  try {
    localStorage.setItem('vagel.v1', JSON.stringify({
      presetId: state.presetId,
      custom: state.custom,
      monitor: state.monitor,
      noiseSuppress: state.noiseSuppress,
      keepAwake: state.keepAwake,
    }));
  } catch { /* mode private */ }
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('on'), ms);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (v) => Math.round(v * 100);

/* ── UI: preset list ──────────────────────────────────────── */
function buildPresetUI() {
  PRESETS.forEach((preset) => {
    // chip horizontal
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.id = preset.id;
    chip.innerHTML = `<span class="e">${preset.emoji}</span><span>${preset.label}</span>`;
    chip.addEventListener('click', () => selectPreset(preset.id));
    el.chips.appendChild(chip);

    // item sidebar
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'p-item';
    item.dataset.id = preset.id;
    item.innerHTML = `<span class="e">${preset.emoji}</span><span>${preset.label}</span>
                      <span class="p-desc">${preset.desc}</span>`;
    item.addEventListener('click', () => {
      selectPreset(preset.id);
      closeSidebar();
    });
    el.presetSide.appendChild(item);
  });
}

function markActivePreset(id) {
  $$('.chip', el.chips).forEach((c) => c.classList.toggle('active', c.dataset.id === id));
  $$('.p-item', el.presetSide).forEach((c) => c.classList.toggle('active', c.dataset.id === id));
  const preset = presetById(id);
  el.effectName.textContent = state.custom ? `${preset.label} · custom` : preset.label;
  el.orbGlyph.textContent = preset.emoji;
}

/* ── UI: sliders & switch ─────────────────────────────────── */
function syncSliders(params) {
  el.sliders.pitch.value = params.pitch;
  el.sliders.ring.value = pct(params.ringMix);
  el.sliders.echo.value = pct(params.echoMix);
  el.sliders.drive.value = pct(params.drive);
  el.sliders.vib.value = pct(params.vibrato);
  el.sliders.gain.value = Math.round((params.gain / 1.3) * 100);
  updateSliderLabels();
}

function updateSliderLabels() {
  el.vals.pitch.textContent = el.sliders.pitch.value;
  el.vals.ring.textContent = el.sliders.ring.value;
  el.vals.echo.textContent = el.sliders.echo.value;
  el.vals.drive.textContent = el.sliders.drive.value;
  el.vals.vib.textContent = el.sliders.vib.value;
  el.vals.gain.textContent = el.sliders.gain.value;
}

function setSwitch(node, on) {
  node.dataset.on = on ? '1' : '0';
}

/* ── audio engine ─────────────────────────────────────────── */
function micConstraints() {
  return {
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: state.noiseSuppress,
      autoGainControl: false,
    },
  };
}

function setParam(name, value, tc = 0.05) {
  if (!engine.voice || !engine.ctx) return;
  const p = engine.voice.parameters.get(name);
  if (p) p.setTargetAtTime(value, engine.ctx.currentTime, tc);
}

function applyParams(params, immediate = false) {
  if (!engine.voice) return;
  const tc = immediate ? 0.001 : 0.05;
  setParam('pitch', params.pitch, tc);
  setParam('ringFreq', params.ringFreq, tc);
  setParam('ringMix', params.ringMix, tc);
  setParam('drive', params.drive, tc);
  setParam('echoMix', params.echoMix, tc);
  setParam('echoTime', params.echoTime, tc);
  setParam('echoFb', params.echoFb, tc);
  setParam('vibrato', params.vibrato, tc);
  setParam('crush', params.crush, tc);
  setParam('gain', params.gain, tc);
  setParam('grain', params.grain, tc);

  if (engine.tone) {
    const t = engine.ctx.currentTime;
    if (params.tone === 'phone') {
      engine.tone.type = 'bandpass';
      engine.tone.frequency.setTargetAtTime(1450, t, 0.05);
      engine.tone.Q.setTargetAtTime(0.75, t, 0.05);
    } else {
      engine.tone.type = 'allpass';
      engine.tone.frequency.setTargetAtTime(1000, t, 0.05);
      engine.tone.Q.setTargetAtTime(0.7, t, 0.05);
    }
  }
}

function currentParams() {
  return state.custom ? { ...mergedPreset(state.presetId), ...state.custom } : mergedPreset(state.presetId);
}

async function startAudio() {
  if (state.running) return;
  el.mainBtn.classList.add('busy');
  el.stInfo.textContent = 'menyalakan…';

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser ini nggak dukung mic. Coba pakai Chrome.');
    }

    const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    const ctx = new AudioContext({ latencyHint: 'interactive' });

    await ctx.audioWorklet.addModule('js/worklet.js');
    if (ctx.state === 'suspended') await ctx.resume();

    const src = ctx.createMediaStreamSource(stream);
    const inGain = ctx.createGain();
    inGain.gain.value = 1;

    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    micAnalyser.smoothingTimeConstant = 0.6;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85;
    hp.Q.value = 0.7;

    const voice = new AudioWorkletNode(ctx, 'vagel-voice', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 1,
      channelCountMode: 'explicit',
    });

    const tone = ctx.createBiquadFilter();
    tone.type = 'allpass';
    tone.frequency.value = 1000;
    tone.Q.value = 0.7;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    const outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 1024;
    outAnalyser.smoothingTimeConstant = 0.5;

    const master = ctx.createGain();
    master.gain.value = state.monitor ? 1 : 0;

    const recDest = ctx.createMediaStreamDestination();

    src.connect(inGain);
    inGain.connect(micAnalyser);
    micAnalyser.connect(hp);
    hp.connect(voice);
    voice.connect(tone);
    tone.connect(comp);
    comp.connect(outAnalyser);
    outAnalyser.connect(master);
    master.connect(ctx.destination);
    master.connect(recDest);

    Object.assign(engine, {
      ctx, stream, src, inGain, micAnalyser, hp, voice, tone, comp,
      outAnalyser, master, recDest, level: 0,
    });

    engine.micBuf = new Uint8Array(micAnalyser.fftSize);
    engine.outBuf = new Uint8Array(outAnalyser.fftSize);

    applyParams(currentParams(), true);

    state.running = true;
    state.muted = false;
    state.startedAt = Date.now();

    el.mainBtn.classList.add('running');
    el.mainBtn.querySelector('.main-lbl').textContent = 'SELESAI';
    el.muteBtn.classList.remove('on');
    el.orb.classList.add('armed');
    el.liveBadge.classList.add('live');
    el.liveBadge.querySelector('span').textContent = 'LIVE';
    el.hint.textContent = 'Suara kamu sudah diubah. Pakai headphone biar nggak feedback ke mic.';
    el.stInfo.textContent = 'aktif';

    const sr = ctx.sampleRate;
    el.srInfo.textContent = `${(sr / 1000).toFixed(1)} kHz`;
    const lat = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    el.latInfo.textContent = lat > 0 ? `± ${Math.round(lat * 1000)} ms` : '—';

    if (state.keepAwake) requestWakeLock();
    startRenderLoop();
    if ('vibrate' in navigator) navigator.vibrate(18);
  } catch (err) {
    console.error(err);
    const name = err && err.name;
    let msg = 'Gagal menyalakan mic. Coba lagi.';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      msg = 'Izin mic ditolak. Buka ⚙️ di Chrome → Izin situs → Mikrofon → Izinkan.';
    } else if (name === 'NotFoundError') {
      msg = 'Mic nggak terdeteksi di HP ini.';
    } else if (name === 'NotReadableError') {
      msg = 'Mic sedang dipakai aplikasi lain (telpon/WA). Tutup dulu, lalu coba lagi.';
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      msg = 'Mic cuma bisa jalan di HTTPS. Buka lewat alamat https:// ya.';
    }
    toast(msg, 5200);
    el.stInfo.textContent = 'gagal';
    teardown();
  } finally {
    el.mainBtn.classList.remove('busy');
  }
}

function stopAudio() {
  if (state.recording) stopRecording(true);
  teardown();

  state.running = false;
  el.mainBtn.classList.remove('running');
  el.mainBtn.querySelector('.main-lbl').textContent = 'MULAI';
  el.orb.classList.remove('armed');
  el.orb.style.setProperty('--level', 0);
  el.liveBadge.classList.remove('live');
  el.liveBadge.querySelector('span').textContent = 'SIAP';
  el.hint.textContent = 'Tekan tombol hijau buat mulai. Pakai headphone biar suara nggak balik ke mic.';
  el.stInfo.textContent = 'idle';
  el.timer.textContent = '00:00';
  releaseWakeLock();
  cancelAnimationFrame(rafId);
  rafId = 0;
  clearWave();
}

function teardown() {
  try { engine.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { engine.voice?.port.close(); } catch {}
  try { engine.ctx?.close(); } catch {}
  Object.assign(engine, {
    ctx: null, stream: null, src: null, inGain: null, micAnalyser: null,
    hp: null, voice: null, tone: null, comp: null, outAnalyser: null,
    master: null, recDest: null,
  });
}

/* ── meter + waveform ─────────────────────────────────────── */
function startRenderLoop() {
  const canvas = el.wave;
  const ctx2d = canvas.getContext('2d');
  let last = 0;

  const draw = (now) => {
    rafId = requestAnimationFrame(draw);
    if (now - last < 33) return;          // ~30 fps (hemat baterai HP)
    last = now;

    if (!engine.micAnalyser || !engine.outAnalyser) return;

    // level → orb
    engine.micAnalyser.getByteTimeDomainData(engine.micBuf);
    let sum = 0;
    for (let i = 0; i < engine.micBuf.length; i++) {
      const v = (engine.micBuf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / engine.micBuf.length);
    const target = clamp(rms * 5.5, 0, 1);
    engine.level += (target - engine.level) * 0.35;
    el.orb.style.setProperty('--level', engine.level.toFixed(3));

    // waveform dari sinyal hasil efek
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);

    engine.outAnalyser.getByteTimeDomainData(engine.outBuf);

    const bars = Math.max(28, Math.floor(w / 6));
    const step = Math.floor(engine.outBuf.length / bars);
    const bw = w / bars;
    const mid = h / 2;

    const grad = ctx2d.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(139,92,246,0.95)');
    grad.addColorStop(0.5, 'rgba(129,140,248,0.95)');
    grad.addColorStop(1, 'rgba(34,211,238,0.95)');
    ctx2d.fillStyle = grad;

    for (let i = 0; i < bars; i++) {
      let peak = 0;
      for (let j = 0; j < step; j++) {
        const v = Math.abs((engine.outBuf[i * step + j] - 128) / 128);
        if (v > peak) peak = v;
      }
      const bh = Math.max(1.6, peak * h * 0.92);
      const x = i * bw + bw * 0.22;
      const bwid = bw * 0.56;
      const y = mid - bh / 2;
      const r = Math.min(bwid / 2, 2.5);
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(x, y, bwid, bh, r);
      else ctx2d.rect(x, y, bwid, bh);
      ctx2d.fill();
    }

    // waktu
    const secs = Math.floor((Date.now() - state.startedAt) / 1000);
    el.timer.textContent =
      `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  };

  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(draw);
}

function clearWave() {
  drawIdle();
}

function drawIdle() {
  const canvas = el.wave;
  const c = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const bars = Math.max(28, Math.floor(w / 6));
  const bw = w / bars;
  const mid = h / 2;
  c.fillStyle = 'rgba(255,255,255,0.13)';
  for (let i = 0; i < bars; i++) {
    const t = i / (bars - 1);
    const env = Math.sin(Math.PI * t);
    const bh = Math.max(2, env * h * 0.62 * (0.5 + 0.5 * Math.abs(Math.sin(i * 0.62))));
    const x = i * bw + bw * 0.22;
    const wd = bw * 0.56;
    const y = mid - bh / 2;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, wd, bh, Math.min(wd / 2, 2.5));
    else c.rect(x, y, wd, bh);
    c.fill();
  }
}

/* ── wake lock ────────────────────────────────────────────── */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      engine.wakeLock = await navigator.wakeLock.request('screen');
      engine.wakeLock.addEventListener('release', () => { engine.wakeLock = null; });
    }
  } catch { /* diabaikan */ }
}
function releaseWakeLock() {
  try { engine.wakeLock?.release(); } catch {}
  engine.wakeLock = null;
}

/* ── rekam ────────────────────────────────────────────────── */
function pickMime() {
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function startRecording() {
  if (!state.running || !engine.recDest) {
    toast('Mulai dulu suaranya, baru rekam.');
    return;
  }
  const mime = pickMime();
  if (!mime) {
    toast('HP ini nggak bisa merekam audio dari browser.');
    return;
  }
  try {
    recChunks = [];
    engine.recorder = new MediaRecorder(engine.recDest.stream, { mimeType: mime });
    engine.recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    engine.recorder.onstop = () => finishRecording(mime);
    engine.recorder.start(200);
    state.recording = true;
    el.recBtn.classList.add('on', 'recording');
    toast('Rekam… tekan tombol merah lagi buat stop.');
  } catch (err) {
    console.error(err);
    toast('Gagal mulai merekam.');
  }
}

function stopRecording(silent = false) {
  if (!engine.recorder || engine.recorder.state === 'inactive') return;
  engine.discardRecording = silent;
  try { engine.recorder.stop(); } catch {}
  state.recording = false;
  el.recBtn.classList.remove('on', 'recording');
}

function finishRecording(mime) {
  if (engine.discardRecording) {
    engine.discardRecording = false;
    engine.recorder = null;
    recChunks = [];
    return;
  }
  const blob = new Blob(recChunks, { type: mime });
  if (!blob.size) { toast('Rekaman kosong.'); return; }
  if (recUrl) URL.revokeObjectURL(recUrl);
  recUrl = URL.createObjectURL(blob);

  const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'm4a';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  el.recAudio.src = recUrl;
  el.saveRec.href = recUrl;
  el.saveRec.download = `vagel-${state.presetId}-${stamp}.${ext}`;
  el.recSheet.classList.add('open');
  el.recSheet.setAttribute('aria-hidden', 'false');
  engine.recorder = null;
}

/* ── sidebar ──────────────────────────────────────────────── */
function openSidebar() {
  el.sidebar.classList.add('open');
  el.sidebar.setAttribute('aria-hidden', 'false');
  el.scrim.classList.add('on');
}
function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.sidebar.setAttribute('aria-hidden', 'true');
  el.scrim.classList.remove('on');
}

/* ── pilih preset / ubah manual ───────────────────────────── */
function selectPreset(id) {
  state.presetId = id;
  state.custom = null;
  const params = mergedPreset(id);
  applyParams(params);
  syncSliders(params);
  markActivePreset(id);
  writeStore();
  if (state.running) toast(`Efek: ${presetById(id).label} ${presetById(id).emoji}`, 1500);
}

function onSliderInput() {
  updateSliderLabels();
  const base = mergedPreset(state.presetId);
  const patch = {
    pitch: Number(el.sliders.pitch.value),
    ringMix: Number(el.sliders.ring.value) / 100,
    echoMix: Number(el.sliders.echo.value) / 100,
    drive: Number(el.sliders.drive.value) / 100,
    vibrato: Number(el.sliders.vib.value) / 100,
    gain: (Number(el.sliders.gain.value) / 100) * 1.3,
  };
  // kalau robot dinaikkan tapi frekuensinya 0, kasih frekuensi default
  if (patch.ringMix > 0.02 && base.ringFreq < 1) patch.ringFreq = 88;

  state.custom = patch;
  const params = { ...base, ...patch };
  applyParams(params);
  el.effectName.textContent = `${presetById(state.presetId).label} · custom`;
  writeStore();
}

/* ── toggle monitor / mute ────────────────────────────────── */
function setMonitor(on) {
  state.monitor = on;
  setSwitch(el.monitorSw, on);
  if (engine.master && engine.ctx) {
    engine.master.gain.setTargetAtTime(on ? 1 : 0, engine.ctx.currentTime, 0.05);
  }
  writeStore();
}

function toggleMute() {
  if (!state.running) { toast('Mulai dulu suaranya.'); return; }
  state.muted = !state.muted;
  if (engine.inGain && engine.ctx) {
    engine.inGain.gain.setTargetAtTime(state.muted ? 0 : 1, engine.ctx.currentTime, 0.03);
  }
  el.muteBtn.classList.toggle('on', state.muted);
  el.hint.textContent = state.muted
    ? 'Mic dibisukan — orang lain nggak dengar apa-apa.'
    : 'Suara kamu sudah diubah. Pakai headphone biar nggak feedback ke mic.';
  if ('vibrate' in navigator) navigator.vibrate(12);
}

/* ── wiring ───────────────────────────────────────────────── */
function bindUI() {
  el.openSidebar.addEventListener('click', openSidebar);
  el.closeSidebar.addEventListener('click', closeSidebar);
  el.scrim.addEventListener('click', closeSidebar);

  el.mainBtn.addEventListener('click', () => {
    if (state.running) stopAudio();
    else startAudio();
  });

  el.muteBtn.addEventListener('click', toggleMute);

  el.recBtn.addEventListener('click', () => {
    if (state.recording) stopRecording();
    else startRecording();
  });

  el.closeSheet.addEventListener('click', () => {
    el.recSheet.classList.remove('open');
    el.recSheet.setAttribute('aria-hidden', 'true');
    el.recAudio.pause();
  });

  el.shareRec.addEventListener('click', async () => {
    try {
      const resp = await fetch(recUrl);
      const blob = await resp.blob();
      const file = new File([blob], el.saveRec.download, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'VAGEL voice' });
      } else {
        toast('HP ini belum dukung bagikan file. Pakai tombol Simpan.');
      }
    } catch { /* user batal */ }
  });

  Object.values(el.sliders).forEach((s) => {
    s.addEventListener('input', onSliderInput);
  });

  el.monitorSw.addEventListener('click', () => setMonitor(!state.monitor));

  el.nsSw.addEventListener('click', () => {
    state.noiseSuppress = !state.noiseSuppress;
    setSwitch(el.nsSw, state.noiseSuppress);
    writeStore();
    if (state.running) {
      toast('Mic dimuat ulang…');
      stopAudio();
      startAudio();
    }
  });

  el.wakeSw.addEventListener('click', () => {
    state.keepAwake = !state.keepAwake;
    setSwitch(el.wakeSw, state.keepAwake);
    if (state.keepAwake && state.running) requestWakeLock();
    if (!state.keepAwake) releaseWakeLock();
    writeStore();
  });

  el.resetBtn.addEventListener('click', () => {
    selectPreset('clean');
    toast('Semua efek direset.');
  });

  el.installBtn.addEventListener('click', async () => {
    if (!installEvent) {
      toast('Buka menu Chrome → "Tambahkan ke layar utama".');
      return;
    }
    installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') el.installBtn.hidden = true;
    installEvent = null;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.running) return;
    if (state.keepAwake) requestWakeLock();
    if (engine.ctx?.state === 'suspended') engine.ctx.resume();
  });

  window.addEventListener('pagehide', () => { if (state.running) stopAudio(); });
}

/* ── init ─────────────────────────────────────────────────── */
function init() {
  buildPresetUI();
  bindUI();

  setSwitch(el.monitorSw, state.monitor);
  setSwitch(el.nsSw, state.noiseSuppress);
  setSwitch(el.wakeSw, state.keepAwake);

  const params = currentParams();
  syncSliders(params);
  markActivePreset(state.presetId);

  if (typeof MediaRecorder === 'undefined') el.recBtn.hidden = true;

  if (!('audioWorklet' in (window.AudioContext ? AudioContext.prototype : {}))) {
    el.hint.textContent = 'Browser kamu belum dukung AudioWorklet. Pakai Chrome versi baru.';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    el.installBtn.hidden = false;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // label room kecil-kecilan biar berasa "room"
  const n = String(1 + Math.floor(Math.random() * 9)).padStart(2, '0');
  el.roomLabel.textContent = `ROOM ${n}`;

  requestAnimationFrame(drawIdle);
  window.addEventListener('resize', () => { if (!state.running) drawIdle(); });
  window.addEventListener('orientationchange', () => { if (!state.running) setTimeout(drawIdle, 250); });
}

init();
