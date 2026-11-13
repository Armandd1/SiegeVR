// Dedikált Web Worker a MediaPipe Hands LITE (modelComplexity: 0) kézkövetéshez
// XNNPACK CPU SIMD delegálással + WebGL framebuffer-újraallokáció védelemmel a 0 GPU-akadásért

if (typeof self !== 'undefined') {
  self.window = self;
}

const scriptCache = new Map();

function loadExternalScript(src) {
  if (!src) return Promise.reject(new Error('Üres script URL'));
  if (scriptCache.has(src)) return scriptCache.get(src);

  const p = fetch(src)
    .then((res) => {
      if (!res.ok) throw new Error(`Script letöltési hiba (${res.status}): ${src}`);
      return res.text();
    })
    .then((code) => {
      (0, eval)(code);
    });

  scriptCache.set(src, p);
  return p;
}

function createGuardedOffscreenCanvas(w, h) {
  if (typeof OffscreenCanvas === 'undefined') {
    return { width: w, height: h, style: {}, addEventListener: () => {} };
  }
  const canvas = new OffscreenCanvas(w, h);
  canvas.style = {};
  canvas.addEventListener = () => {};

  // A MediaPipe hands.js minden képkockán meghívja a canvas.width = w és canvas.height = h
  // értékadást, ami WebGL-ben minden képkockán újraallokálja a GPU framebuffert!
  // Ezzel a védelemmel az azonos méretre történő beállítás 0-költségű no-op lesz.
  try {
    const wDesc = Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'width');
    const hDesc = Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'height');
    if (wDesc?.get && wDesc?.set && hDesc?.get && hDesc?.set) {
      Object.defineProperty(canvas, 'width', {
        get() { return wDesc.get.call(this); },
        set(v) { if (v !== wDesc.get.call(this)) wDesc.set.call(this, v); },
        configurable: true
      });
      Object.defineProperty(canvas, 'height', {
        get() { return hDesc.get.call(this); },
        set(v) { if (v !== hDesc.get.call(this)) hDesc.set.call(this, v); },
        configurable: true
      });
    }
  } catch (e) {}

  return canvas;
}

if (typeof document === 'undefined') {
  const appendScriptElement = (el) => {
    if (el && el.src) {
      loadExternalScript(el.src)
        .then(() => {
          if (typeof el._onload === 'function') el._onload();
        })
        .catch((err) => {
          if (typeof el._onerror === 'function') el._onerror(err);
        });
    }
    return el;
  };

  globalThis.document = {
    createElement: (tagName) => {
      if (tagName === 'canvas') {
        return createGuardedOffscreenCanvas(128, 96);
      }
      if (tagName === 'script') {
        return {
          src: '',
          crossOrigin: '',
          _onload: null,
          _onerror: null,
          setAttribute(key, val) {
            this[key] = val;
          },
          addEventListener(type, cb) {
            if (type === 'load') this._onload = cb;
            else if (type === 'error') this._onerror = cb;
          }
        };
      }
      return { style: {}, addEventListener: () => {} };
    },
    body: { appendChild: appendScriptElement },
    head: { appendChild: appendScriptElement },
    addEventListener: () => {},
    exitPointerLock: () => {}
  };
}

let hands = null;
let currentTStart = 0;
let resultSentForFrame = false;

const MEDIAPIPE_HANDS_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/';

async function initHandsWorker() {
  try {
    await loadExternalScript(`${MEDIAPIPE_HANDS_BASE}hands.js`);
    if (typeof self.Hands !== 'function') {
      throw new Error('self.Hands nem töltődött be');
    }

    hands = new self.Hands({
      locateFile: (file) => `${MEDIAPIPE_HANDS_BASE}${file}`
    });

    // Csak a 2D/2.5D kéz-landmarkokat kérjük el a C++ gráftól (nincs worldLandmarks,
    // nincs handedness és nincs felesleges GPU->ImageBitmap visszaolvasás)
    const listener = hands.h?.h?.listeners?.[0];
    if (listener && listener.outs) {
      listener.wants = ['multi_hand_landmarks', 'image_transformed'];
      listener.outs = {
        multiHandLandmarks: listener.outs.multiHandLandmarks
      };
    }

    // useCpuInference: true -> A TFLite neurális háló a Worker külön CPU-magján (XNNPACK WASM SIMD)
    // fut, így 0%-ban terheli a telefon közös GPU-ját, ahol a Three.js 60 FPS-sel renderel!
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      useCpuInference: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    hands.onResults((results) => {
      const duration = performance.now() - currentTStart;
      resultSentForFrame = true;

      if (!results || !results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        self.postMessage({ type: 'RESULT', detected: false, duration });
        return;
      }

      const landmarks = results.multiHandLandmarks[0];
      const wrist = landmarks[0];
      const middleMcp = landmarks[9];
      const thumb = landmarks[4];
      const index = landmarks[8];
      const middle = landmarks[12];

      const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.22;
      const dIndex = Math.hypot(thumb.x - index.x, thumb.y - index.y) / handScale;
      const dMiddle = middle ? Math.hypot(thumb.x - middle.x, thumb.y - middle.y) / handScale : 99;
      const pinchDist = Math.min(dIndex, dMiddle);

      self.postMessage({
        type: 'RESULT',
        detected: true,
        x: (thumb.x + index.x) * 0.5,
        y: (thumb.y + index.y) * 0.5,
        z: (thumb.z + index.z) * 0.5,
        pinchDist,
        duration
      });
    });

    await hands.initialize();
    self.postMessage({ type: 'READY' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err?.message || 'HandWorker init failed' });
  }
}

initHandsWorker();

self.onmessage = async (event) => {
  const data = event.data;
  if (!data || data.type !== 'FRAME') return;

  const { frame } = data;
  currentTStart = performance.now();
  resultSentForFrame = false;

  try {
    if (!hands || !frame) {
      self.postMessage({ type: 'RESULT', detected: false, duration: 0 });
      resultSentForFrame = true;
      return;
    }

    await hands.send({ image: frame });

    if (!resultSentForFrame) {
      self.postMessage({ type: 'RESULT', detected: false, duration: performance.now() - currentTStart });
    }
  } catch (err) {
    if (!resultSentForFrame) {
      self.postMessage({ type: 'RESULT', detected: false, duration: performance.now() - currentTStart });
    }
  } finally {
    if (frame && typeof frame.close === 'function') {
      frame.close();
    }
  }
};
