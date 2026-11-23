/* ============================================================
   VAGEL — test UI tanpa browser (jsdom)
   Jalankan:  npm i jsdom && node tests/ui.test.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
const errors = [];
window.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e.error)));

/* ---------- stub API browser ---------- */
const param = () => ({ value: 0, setTargetAtTime(v) { this.value = v; } });

function nodeStub() {
  return {
    connect() { return this; },
    gain: param(), frequency: param(), Q: param(), type: 'allpass',
    threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    fftSize: 1024, smoothingTimeConstant: 0.5,
    getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(40 * Math.sin(i / 8)); },
    getFloatTimeDomainData(a) { a.fill(0.01); },
  };
}

const PARAMS = ['pitch', 'ringFreq', 'ringMix', 'drive', 'echoMix', 'echoTime',
  'echoFb', 'vibrato', 'crush', 'gain', 'grain'];

class AudioWorkletNodeStub {
  constructor(ctx, name, opts) {
    this.name = name;
    this.opts = opts;
    this.port = { close() {} };
    this.parameters = new Map(PARAMS.map((n) => [n, param()]));
    AudioWorkletNodeStub.last = this;
  }
  connect() { return this; }
}

class AudioContextStub {
  constructor() {
    this.sampleRate = 48000;
    this.state = 'running';
    this.currentTime = 0;
    this.baseLatency = 0.012;
    this.outputLatency = 0.02;
    this.destination = { connect() {} };
    this.audioWorklet = { addModule: async (u) => { AudioContextStub.moduleUrl = u; } };
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createMediaStreamSource() { return nodeStub(); }
  createGain() { return nodeStub(); }
  createAnalyser() { return nodeStub(); }
  createBiquadFilter() { return nodeStub(); }
  createDynamicsCompressor() { return nodeStub(); }
  createMediaStreamDestination() { return { stream: { id: 'rec' } }; }
}

window.AudioContext = AudioContextStub;
window.webkitAudioContext = AudioContextStub;
window.AudioWorkletNode = AudioWorkletNodeStub;
window.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };

class MediaRecorderStub {
  static isTypeSupported() { return true; }
  constructor(stream, opts) {
    this.stream = stream; this.opts = opts; this.state = 'inactive';
    MediaRecorderStub.last = this;
  }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
}
window.MediaRecorder = MediaRecorderStub;

window.URL.createObjectURL = () => 'blob:fake';
window.URL.revokeObjectURL = () => {};
window.HTMLMediaElement.prototype.pause = function () {};

const ctx2d = {
  setTransform() {}, clearRect() {}, beginPath() {}, fill() {}, rect() {}, roundRect() {},
  createLinearGradient: () => ({ addColorStop() {} }),
  fillStyle: null,
};
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;

/* ---------- jalankan app ---------- */
window.eval(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));

const { document } = window;
const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('OK   ' + name);
  else { console.log('FAIL ' + name + ' ' + extra); fails++; }
}

(async () => {
  check('judul app', document.title.includes('VAGEL'));

  const chips = document.querySelectorAll('#chips .chip');
  const side = document.querySelectorAll('#presetListSidebar .p-item');
  check('10 chip preset', chips.length === 10, `dapat ${chips.length}`);
  check('10 item sidebar', side.length === 10, `dapat ${side.length}`);
  check('preset awal Normal', chips[0].classList.contains('active'));
  check('label room terisi', /ROOM \d\d/.test($('#roomLabel').textContent), $('#roomLabel').textContent);
  check('switch monitor nyala', $('#monitorSw').dataset.on === '1');

  $('#openSidebar').click();
  check('sidebar terbuka', $('#sidebar').classList.contains('open') && $('#scrim').classList.contains('on'));
  $('#scrim').click();
  check('sidebar tertutup', !$('#sidebar').classList.contains('open'));

  const robotChip = [...chips].find((c) => c.dataset.id === 'robot');
  robotChip.click();
  check('efek jadi Robot', $('#effectName').textContent.includes('Robot'), $('#effectName').textContent);
  check('slider robot = 95', $('#ring').value === '95', $('#ring').value);
  check('emoji orb jadi robot', $('#orbGlyph').textContent === '🤖', $('#orbGlyph').textContent);

  const pitch = $('#pitch');
  pitch.value = '5';
  pitch.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('mode custom muncul', $('#effectName').textContent.includes('custom'), $('#effectName').textContent);
  check('label pitch = 5', $('#pitchVal').textContent === '5');

  $('#mainBtn').click();
  await wait(80);
  check('worklet dimuat', AudioContextStub.moduleUrl === 'js/worklet.js', String(AudioContextStub.moduleUrl));
  check('node vagel-voice dibuat', AudioWorkletNodeStub.last?.name === 'vagel-voice');
  check('output 2 channel', JSON.stringify(AudioWorkletNodeStub.last.opts.outputChannelCount) === '[2]');
  check('badge LIVE', $('#liveBadge').querySelector('span').textContent === 'LIVE');
  check('tombol SELESAI', $('.main-lbl').textContent === 'SELESAI');
  check('sample rate tampil', $('#srInfo').textContent.includes('48'), $('#srInfo').textContent);
  check('latency tampil', $('#latInfo').textContent.includes('ms'), $('#latInfo').textContent);
  check('status aktif', $('#stInfo').textContent === 'aktif');
  check('pitch sampai ke DSP', AudioWorkletNodeStub.last.parameters.get('pitch').value === 5,
    String(AudioWorkletNodeStub.last.parameters.get('pitch').value));

  $('#muteBtn').click();
  check('mute nyala', $('#muteBtn').classList.contains('on'));
  $('#muteBtn').click();
  check('mute mati', !$('#muteBtn').classList.contains('on'));

  $('#recBtn').click();
  check('rekaman mulai', MediaRecorderStub.last?.state === 'recording');
  // jsdom tidak punya encoder audio — suapkan satu potongan data palsu
  MediaRecorderStub.last.ondataavailable({ data: new window.Blob(['v', 'a', 'g', 'e', 'l'], { type: 'audio/webm' }) });
  $('#recBtn').click();
  await wait(40);
  check('rekaman selesai & file siap', $('#saveRec').download.startsWith('vagel-'), $('#saveRec').download);
  $('#closeSheet').click();

  const hantu = [...chips].find((c) => c.dataset.id === 'hantu');
  hantu.click();
  check('ganti preset saat live', AudioWorkletNodeStub.last.parameters.get('echoMix').value === 0.5,
    String(AudioWorkletNodeStub.last.parameters.get('echoMix').value));

  $('#mainBtn').click();
  await wait(40);
  check('badge balik SIAP', $('#liveBadge').querySelector('span').textContent === 'SIAP');
  check('tombol balik MULAI', $('.main-lbl').textContent === 'MULAI');
  check('timer reset', $('#timer').textContent === '00:00');

  check('tanpa error runtime', errors.length === 0, errors.join(' | '));
  console.log(fails === 0 ? '\nSEMUA UI TEST LOLOS' : `\n${fails} TEST GAGAL`);
  process.exit(fails === 0 ? 0 : 1);
})();
