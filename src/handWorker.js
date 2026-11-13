// Dedikált Web Worker a MediaPipe Kézkövetéshez (külön CPU magon fut, 0 főszál-akadás)

// 1. Minimális DOM / OffscreenCanvas polyfill MediaPipe Worker kompatibilitáshoz
if (typeof self !== 'undefined') {
  self.window = self;
}
if (typeof document === 'undefined') {
  globalThis.document = {
    createElement: (tagName) => {
      if (tagName === 'canvas' && typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(256, 192);
      }
      return {};
    },
    head: { appendChild: () => {} }
  };
}

let handLandmarker = null;
let lastTimestamp = 0;

function hasWebGL2Support() {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false;
    const c = new OffscreenCanvas(16, 16);
    return !!c.getContext('webgl2');
  } catch (e) {
    return false;
  }
}

async function initHandLandmarker() {
  try {
    const visionModule = await import(
      /* @vite-ignore */
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
    );
    const { FilesetResolver, HandLandmarker } = visionModule;

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    const modelPath =
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    const createOptions = (delegate) => ({
      baseOptions: {
        modelAssetPath: modelPath,
        delegate
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    if (hasWebGL2Support()) {
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, createOptions('GPU'));
      } catch (gpuErr) {
        handLandmarker = await HandLandmarker.createFromOptions(vision, createOptions('CPU'));
      }
    } else {
      handLandmarker = await HandLandmarker.createFromOptions(vision, createOptions('CPU'));
    }

    self.postMessage({ type: 'READY' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err?.message || 'Worker init failed' });
  }
}

initHandLandmarker();

self.onmessage = (event) => {
  const data = event.data;
  if (!data || data.type !== 'FRAME') return;

  const { frame, timestamp } = data;
  const tStart = performance.now();

  try {
    if (!handLandmarker || !frame) {
      self.postMessage({ type: 'RESULT', detected: false, duration: 0 });
      return;
    }

    // Szigorúan monoton növekvő időbélyeg (ms) a VIDEO módhoz
    const safeTs = Math.max(lastTimestamp + 1, Math.floor(timestamp || tStart));
    lastTimestamp = safeTs;

    const results = handLandmarker.detectForVideo(frame, safeTs);
    const duration = performance.now() - tStart;

    if (!results || !results.landmarks || results.landmarks.length === 0) {
      self.postMessage({ type: 'RESULT', detected: false, duration });
      return;
    }

    const landmarks = results.landmarks[0];
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
  } catch (err) {
    self.postMessage({ type: 'RESULT', detected: false, duration: performance.now() - tStart });
  } finally {
    // Memóriaszivárgás elkerülése: ImageBitmap azonnali felszabadítása
    if (frame && typeof frame.close === 'function') {
      frame.close();
    }
  }
};

