// Dedikált Web Worker a MediaPipe Hands LITE (modelComplexity: 0) kézkövetéshez
// Külön CPU/GPU szálon fut, 0 főszál-terheléssel és felesleges képmásolás nélkül.

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
      // Globális indirect eval: ES Module Workerben is működik (importScripts() hiba nélkül)
      (0, eval)(code);
    });

  scriptCache.set(src, p);
  return p;
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
        if (typeof OffscreenCanvas !== 'undefined') {
          const canvas = new OffscreenCanvas(192, 144);
          canvas.style = {};
          canvas.addEventListener = () => {};
          return canvas;
        }
        return { width: 192, height: 144, style: {}, addEventListener: () => {} };
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

    // Felesleges protobuf és WebGL képrenderelő kimenetek tiltása:
    // drasztikusan csökkenti a GPU->RAM textúra másolást és a GC terhelést
    if (hands.h?.h?.listeners?.[0]?.outs) {
      delete hands.h.h.listeners[0].outs.image;
      delete hands.h.h.listeners[0].outs.multiHandWorldLandmarks;
      delete hands.h.h.listeners[0].outs.multiHandedness;
    }

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0, // LITE modell (~2.6x gyorsabb mobilon)
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
    // Memóriaszivárgás elkerülése: ImageBitmap azonnali felszabadítása
    if (frame && typeof frame.close === 'function') {
      frame.close();
    }
  }
};
