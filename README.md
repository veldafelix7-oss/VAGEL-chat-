# VAGEL — Voice Lab

**Pengubah suara real time** ala telepon/room. Ngomong di mic → suaranya langsung berubah (cewek, cowok, robot, monster, alien, hantu, radio, stadion) dan terdengar langsung di speaker/headphone.

> **Tanpa API key. Tanpa server. Tanpa internet.**
> Semua pemrosesan suara (pitch shift, robot, gema, distorsi) jalan di HP kamu sendiri pakai Web Audio API + AudioWorklet.

---

## Isi repo

| File | Fungsi |
|---|---|
| `index.html` | Struktur UI (orb, sidebar, kontrol gaya telepon) |
| `styles.css` | Desain glassmorphism, mobile-first |
| `js/app.js` | Logika UI, audio graph, rekam, wake lock, PWA |
| `js/worklet.js` | **Mesin suara**: pitch shifter 4-grain, ring modulator, bitshift, echo, drive |
| `manifest.webmanifest` | Supaya bisa di-install jadi app di home screen |
| `sw.js` | Service worker → jalan offline |
| `icons/` | Ikon app (dibuat sendiri pakai ImageMagick) |
| `tests/ui.test.js` | Test UI/flow tanpa browser (jsdom) |
| `tests/dsp.test.js` | Test DSP: cek pitch benar-benar naik/turun |

---

## Cara pakai di HP (Tecno Spark 20C / Android apa pun)

1. Buka alamat Vercel-nya di **Chrome**.
2. Izinkan **mikrofon** saat diminta.
3. Tap tombol hijau **MULAI** → langsung ngomong.
4. Pilih efek di chip bawah atau di **sidebar (☰)**.
5. **Instal jadi aplikasi:** menu Chrome → *Tambahkan ke layar utama* / *Instal aplikasi*.
   Setelah itu buka dari ikon VAGEL — layar penuh, tanpa address bar, dan tetap jalan walau offline.

> ⚠️ **Pakai headphone.** Kalau pakai speaker HP, suara hasil efek masuk lagi ke mic → feedback (suara melengking). Ini bukan bug, tapi hukum fisika 🙂

---

## Efek yang tersedia

`Normal` · `Cewek` (+7 st) · `Cowok` (−4 st) · `Bayi` (+11 st) · `Monster` (−9 st + distorsi + getar) · `Robot` (ring mod 88 Hz + bitcrush) · `Alien` (ring mod 26 Hz + vibrato) · `Hantu` (gema panjang) · `Radio` (bandpass 300–3400 Hz + saturasi) · `Stadion` (gema ruangan)

Plus 6 slider manual di sidebar: Nada dasar, Robot, Gema, Distorsi, Getar, Volume.

---

## Butuh API key?

**Tidak.** Yang dipakai cuma API bawaan browser:

- `getUserMedia` → ambil mic
- `AudioWorklet` → DSP real time
- `MediaRecorder` → rekam hasil suara (opsional, buat disimpan/dibagikan)
- `WakeLock` → layar nggak mati saat ngobrol

Yang **baru butuh key / bayar** adalah kalau nanti mau:
- ubah suara jadi **suara orang lain** (voice cloning / RVC / ElevenLabs) → butuh model + key,
- ngobrol sama **AI** (speech-to-text → LLM → text-to-speech) → butuh key,
- **voice room multi-user** (teleponan beneran antar HP) → butuh signaling server + TURN (WebRTC).

Fitur sekarang: 1 HP, efek real time, 0 rupiah.

---

## Kalau mau jadi file `.apk`

Dua jalan, dua-duanya gratis:

**A. PWABuilder (paling cepat, tanpa Android Studio)**
1. Buka <https://www.pwabuilder.com>
2. Tempel URL Vercel app-nya → *Start* → pilih **Android**
3. Download → dapat `.apk` / `.aab`, tanda tangani, install.

**B. Android Studio (kontrol penuh)**
Buat project baru → `Empty Activity` → taruh `MainActivity.kt`:

```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(req: PermissionRequest) {
                req.grant(req.resources)   // izinkan mic
            }
        }
        web.loadUrl("https://ALAMAT-VERCEL-KAMU.vercel.app")
        setContentView(web)
    }
}
```

Jangan lupa di `AndroidManifest.xml`:
`<uses-permission android:name="android.permission.RECORD_AUDIO" />`
dan minta izin runtime sebelum `loadUrl`.

---

## Develop lokal

```bash
python3 -m http.server 8080      # lalu buka http://localhost:8080
npm i jsdom && npm test          # test UI
node tests/dsp.test.js           # test DSP (cek pitch 220 Hz → 330 Hz, dll)
```

Mic **hanya jalan di `https://` atau `localhost`** (aturan Chrome).

---

## Batasan jujur

- **Delay**: di Chrome Android total (mic → efek → speaker) kira-kira 100–250 ms. Terasa seperti echo kalau pakai speaker; pakai headphone biar nyaman. Ini batas platform, bukan batas kode.
- **Bukan virtual mic**: efek ini didengar di HP yang sama / untuk rekaman. Aplikasi lain (WA, Discord, game) belum bisa memakai suara hasil efek ini — Android belum mengizinkan app biasa membuat mikrofon virtual tanpa root.
- **Voice room antar HP** belum ada. Itu tahap berikutnya (WebRTC + Supabase Realtime untuk signaling).

---

VAGEL voice lab · dibuat untuk `veldafelix7-oss/VAGEL-chat-`
