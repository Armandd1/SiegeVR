// Hand Tracking Rendszer: WebXR Natív Kézkövetés + MediaPipe Hands Valós Idejű AR Hologram Célzással
export class HandTracker {
  constructor(onPinchStart, onPinchMove, onPinchEnd, onStatusChange = null) {
    this.onPinchStart = onPinchStart;
    this.onPinchMove = onPinchMove;
    this.onPinchEnd = onPinchEnd;
    this.onStatusChange = onStatusChange;

    this.isActive = false;
    this.isPinching = false;
    this.hasNativeXRHand = false;

    // Zero-allocation újrafelhasznált pozíció-objektumok a Garbage Collection elkerülésére
    this.pinchAnchor = { x: 0, y: 0, z: 0 };
    this.smoothedMid = { x: 0.5, y: 0.5, z: 0 };
    this.rawMid = { x: 0.5, y: 0.5, z: 0 };
    this.tempDelta = { x: 0, y: 0, z: 0 };

    this.videoElement = null;
    this.cameraUtils = null;
    this.mediaPipeHands = null;
    this.stream = null;
    this.externalStream = null;
    this.animFrameId = null;

    // Holografikus AR Célzókereszt DOM elemek
    this.handOverlay = null;
    this.handReticle = null;
    this.pinchMeter = null;
    this.reticleLabel = null;

    // Képernyőméret gyorsítótárazása (elkerülve a szinkron layout reflow-t)
    this.winW = typeof window !== 'undefined' ? window.innerWidth : 360;
    this.winH = typeof window !== 'undefined' ? window.innerHeight : 640;
    this.onResize = () => {
      this.winW = window.innerWidth || 360;
      this.winH = window.innerHeight || 640;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize, { passive: true });
    }

    // Mobil-optimalizált adaptív AI mintavételezés (~10-14 FPS neurális háló, Three.js 60 FPS lerp mellett)
    this.isProcessing = false;
    this.lastCompletionTime = 0;
    this.lastSendTime = 0;
    this.lastInferenceDuration = 25; // Becsült következtetési idő (ms)
    this.minIdleGapMs = 68;
    this.pauseUntil = 0;
    this.videoCallbackId = null;
    this._scriptsPromise = null;

    // 192x144 lekicsinyítő előfeldolgozó canvas (33x kisebb adatátvitel a Workerbe)
    this.captureW = 192;
    this.captureH = 144;
    this.captureCanvas = null;
    this.captureCtx = null;

    // Web Worker alapú háttérszálú AI kézkövetés (zéró főszál-terhelés)
    this.worker = null;
    this.workerReady = false;
    this.workerFailed = false;
    this._workerInitPromise = null;
    this.useWorker = typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async ensureScriptsLoaded() {
    if (typeof window.Hands !== 'undefined') return true;
    if (!this._scriptsPromise) {
      this._scriptsPromise = Promise.all([
        this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js'),
        this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js').catch(() => {})
      ]).catch((err) => {
        this._scriptsPromise = null;
        throw err;
      });
    }
    await this._scriptsPromise;
    return typeof window.Hands !== 'undefined';
  }

  initDOM(videoEl) {
    this.videoElement = videoEl;
    if (this.videoElement) {
      this.videoElement.style.display = 'none'; // Szigorúan háttérben fut az AI-nak
    }

    this.handOverlay = document.getElementById('hand-aim-overlay');
    this.handReticle = document.getElementById('hand-reticle');
    this.pinchMeter = document.getElementById('hand-pinch-meter');
    this.reticleLabel = document.getElementById('hand-reticle-label');
  }

  setExternalStream(stream) {
    this.externalStream = stream;
  }

  async captureDownscaledBitmap() {
    if (!this.videoElement || this.videoElement.readyState < 2) return null;

    if (!this.captureCanvas) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.captureCanvas = new OffscreenCanvas(this.captureW, this.captureH);
      } else {
        this.captureCanvas = document.createElement('canvas');
        this.captureCanvas.width = this.captureW;
        this.captureCanvas.height = this.captureH;
      }
      this.captureCtx = this.captureCanvas.getContext('2d', { alpha: false, desynchronized: true });
    }

    if (!this.captureCtx) {
      return createImageBitmap(this.videoElement);
    }

    this.captureCtx.drawImage(this.videoElement, 0, 0, this.captureW, this.captureH);

    if (typeof this.captureCanvas.transferToImageBitmap === 'function') {
      return this.captureCanvas.transferToImageBitmap();
    }
    return createImageBitmap(this.captureCanvas);
  }

  initWorker() {
    if (this.workerReady && this.worker) return Promise.resolve(true);
    if (this.workerFailed) return Promise.resolve(false);
    if (this._workerInitPromise) return this._workerInitPromise;

    this._workerInitPromise = new Promise((resolve) => {
      try {
        this.worker = new Worker(new URL('./handWorker.js', import.meta.url), { type: 'module' });

        const onInitMessage = (event) => {
          const data = event.data;
          if (!data) return;

          if (data.type === 'READY') {
            this.workerReady = true;
            this.worker.removeEventListener('message', onInitMessage);
            this.worker.addEventListener('message', this.onWorkerMessage.bind(this));
            resolve(true);
          } else if (data.type === 'ERROR') {
            console.warn('HandWorker init hiba, főszálas fallbackre váltás:', data.message);
            this.workerFailed = true;
            this.useWorker = false;
            try { this.worker.terminate(); } catch (e) {}
            this.worker = null;
            resolve(false);
          }
        };

        this.worker.addEventListener('message', onInitMessage);
        this.worker.addEventListener('error', (err) => {
          console.warn('HandWorker futási hiba, fallbackre váltás:', err);
          this.workerFailed = true;
          this.useWorker = false;
          this.isProcessing = false;
          resolve(false);
        });
      } catch (err) {
        this.workerFailed = true;
        this.useWorker = false;
        resolve(false);
      }
    });

    return this._workerInitPromise;
  }

  onWorkerMessage(event) {
    const data = event.data;
    if (!data || data.type !== 'RESULT') return;

    this.isProcessing = false;
    this.lastCompletionTime = performance.now();
    if (typeof data.duration === 'number' && data.duration > 0) {
      this.lastInferenceDuration = data.duration;
    }

    if (!this.isActive) return;

    if (!data.detected) {
      this.processHandInput(false, 0, 0, 0, 99);
    } else {
      this.processHandInput(true, data.x, data.y, data.z, data.pinchDist);
    }
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;
    this.pauseUntil = 0;

    if (this.handOverlay) this.handOverlay.classList.remove('hidden');
    if (this.onStatusChange) this.onStatusChange({ active: true, handDetected: false, isPinching: false });

    // Elsődleges: külön CPU-magon futó Web Worker (zéró főszál-akadás)
    if (this.useWorker && this.videoElement) {
      const ok = await this.initWorker();
      if (!this.isActive) return;
      if (ok) {
        await this.startCameraStream();
        return;
      }
    }

    // Fallback: hagyományos főszálas MediaPipe, ha a Worker nem indítható
    try {
      const loaded = await this.ensureScriptsLoaded();
      if (!this.isActive) return;
      if (loaded && this.videoElement) {
        await this.initMediaPipe();
      }
    } catch (err) {
      console.warn('MediaPipe betöltési/indítási hiba:', err);
    }
  }

  stop() {
    this.isActive = false;
    this.isPinching = false;
    this.hasNativeXRHand = false;

    if (this.handOverlay) this.handOverlay.classList.add('hidden');
    if (this.handReticle) this.handReticle.classList.add('hidden');
    if (this.onStatusChange) this.onStatusChange({ active: false, handDetected: false, isPinching: false });

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.videoCallbackId && this.videoElement && 'cancelVideoFrameCallback' in this.videoElement) {
      this.videoElement.cancelVideoFrameCallback(this.videoCallbackId);
      this.videoCallbackId = null;
    }

    if (this.cameraUtils) {
      try {
        this.cameraUtils.stop();
      } catch (e) {}
      this.cameraUtils = null;
    }

    if (this.stream) {
      try {
        this.stream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      this.stream = null;
    }

    if (this.videoElement) {
      try {
        if (this.videoElement.srcObject) {
          const tracks = this.videoElement.srcObject.getTracks();
          tracks.forEach(track => track.stop());
        }
      } catch (e) {}
      this.videoElement.srcObject = null;
    }
  }

  async startCameraStream() {
    this.isProcessing = false;
    this.lastCompletionTime = 0;

    if (this.externalStream && this.videoElement) {
      this.videoElement.srcObject = this.externalStream;
      await this.videoElement.play().catch(() => {});
      this.startFrameLoop();
      return;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 240, max: 320 },
            height: { ideal: 180, max: 240 },
            frameRate: { ideal: 20, max: 24 }
          },
          audio: false
        });
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        this.startFrameLoop();
      } catch (err) {
        console.warn('Szelfi kamera indítási hiba:', err);
      }
    }
  }

  async initMediaPipe() {
    if (!this.mediaPipeHands) {
      this.mediaPipeHands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      if (this.mediaPipeHands.h?.h?.listeners?.[0]?.outs) {
        delete this.mediaPipeHands.h.h.listeners[0].outs.image;
        delete this.mediaPipeHands.h.h.listeners[0].outs.multiHandWorldLandmarks;
        delete this.mediaPipeHands.h.h.listeners[0].outs.multiHandedness;
      }

      // modelComplexity: 0 (Lite modell), optimális magabiztosság a stabil és ugrálásmentes követésért
      this.mediaPipeHands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.mediaPipeHands.onResults(this.onMediaPipeResults.bind(this));
    }

    this.isProcessing = false;
    this.lastCompletionTime = 0;

    // Ha van meglévő háttérkamera stream (pl. WebRTC AR mód), felhasználhatjuk
    if (this.externalStream && this.videoElement) {
      this.videoElement.srcObject = this.externalStream;
      await this.videoElement.play().catch(() => {});
      this.startFrameLoop();
      return;
    }

    // Kamera inicializálása: 240x180 @ 20fps - minimális memória- és buszterhelés gyenge telefonokon,
    // miközben a MediaPipe Lite tenzorához tökéletesen elegendő felbontás
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', // Szelfi kamera a játékos keze felé
            width: { ideal: 240, max: 320 },
            height: { ideal: 180, max: 240 },
            frameRate: { ideal: 20, max: 24 }
          },
          audio: false
        });
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        this.startFrameLoop();
      } catch (camErr) {
        console.warn('getUserMedia szelfi kamera hiba, CameraUtils fallback:', camErr);
        if (window.Camera && this.videoElement) {
          this.cameraUtils = new window.Camera(this.videoElement, {
            onFrame: async () => {
              if (!this.isActive || !this.mediaPipeHands || this.isProcessing || this.hasNativeXRHand || document.hidden) return;
              const now = performance.now();
              if (now < this.pauseUntil) return;
              const adaptiveGap = Math.max(this.minIdleGapMs, this.lastInferenceDuration * 1.35);
              if (now - this.lastCompletionTime < adaptiveGap) return;

              this.isProcessing = true;
              const tStart = performance.now();
              try {
                await this.mediaPipeHands.send({ image: this.videoElement });
              } catch (e) {
              } finally {
                this.isProcessing = false;
                this.lastCompletionTime = performance.now();
                this.lastInferenceDuration = this.lastCompletionTime - tStart;
              }
            },
            width: 240,
            height: 180
          });
          await this.cameraUtils.start();
        }
      }
    }
  }

  startFrameLoop() {
    const processFrame = async () => {
      if (!this.isActive) return;
      const now = performance.now();

      // Biztonsági timeout: elakadt képkocka esetén ne ragadjon be a feldolgozás
      if (this.isProcessing && now - this.lastSendTime > 1500) {
        this.isProcessing = false;
      }

      // Adaptív időzítés: 10–14 FPS AI követés + 60 FPS főszálú simító interpoláció
      const baseGap = this.isPinching ? 65 : 95;
      const adaptiveGap = Math.max(baseGap, this.lastInferenceDuration * 1.35);

      if (
        !this.isProcessing &&
        !this.hasNativeXRHand &&
        !document.hidden &&
        now >= this.pauseUntil &&
        (now - this.lastCompletionTime >= adaptiveGap) &&
        this.videoElement &&
        this.videoElement.readyState >= 2
      ) {
        if (this.useWorker && this.workerReady && this.worker) {
          this.isProcessing = true;
          this.lastSendTime = now;
          try {
            const bitmap = await this.captureDownscaledBitmap();
            if (!bitmap || !this.isActive || !this.worker) {
              if (bitmap && typeof bitmap.close === 'function') bitmap.close();
              this.isProcessing = false;
            } else {
              this.worker.postMessage({ type: 'FRAME', frame: bitmap, timestamp: now }, [bitmap]);
            }
          } catch (e) {
            this.isProcessing = false;
          }
        } else if (this.mediaPipeHands) {
          this.isProcessing = true;
          this.lastSendTime = now;
          const tStart = performance.now();
          try {
            await this.mediaPipeHands.send({ image: this.videoElement });
          } catch (e) {
          } finally {
            this.isProcessing = false;
            this.lastCompletionTime = performance.now();
            this.lastInferenceDuration = this.lastCompletionTime - tStart;
          }
        }
      }

      if (this.isActive) {
        if (this.videoElement && 'requestVideoFrameCallback' in this.videoElement) {
          this.videoCallbackId = this.videoElement.requestVideoFrameCallback(processFrame);
        } else {
          this.animFrameId = requestAnimationFrame(processFrame);
        }
      }
    };
    processFrame();
  }

  onMediaPipeResults(results) {
    if (!this.isActive) return;

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.processHandInput(false, 0, 0, 0, 99);
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

    this.processHandInput(
      true,
      (thumb.x + index.x) * 0.5,
      (thumb.y + index.y) * 0.5,
      (thumb.z + index.z) * 0.5,
      pinchDist
    );
  }

  processHandInput(detected, x, y, z, pinchDist) {
    if (!this.isActive) return;

    if (!detected) {
      if (this.handReticle) this.handReticle.classList.add('hidden');
      if (this.onStatusChange) this.onStatusChange({ active: true, handDetected: false, isPinching: false });
      if (this.isPinching) {
        this.isPinching = false;
        if (this.onPinchEnd) this.onPinchEnd(false);
      }
      return;
    }

    // Kézközéppont frissítése
    this.rawMid.x = x;
    this.rawMid.y = y;
    this.rawMid.z = z;

    // Adaptív simítás (One-Euro jellegű exponenciális szűrő):
    // Gyors mozgásnál azonnali reakció, lassú mozgásnál rezzenéstelen stabilitás
    const speed = Math.hypot(this.rawMid.x - this.smoothedMid.x, this.rawMid.y - this.smoothedMid.y);
    const alpha = Math.min(0.85, Math.max(0.40, speed * 6.5));

    this.smoothedMid.x = this.smoothedMid.x * (1 - alpha) + this.rawMid.x * alpha;
    this.smoothedMid.y = this.smoothedMid.y * (1 - alpha) + this.rawMid.y * alpha;
    this.smoothedMid.z = this.smoothedMid.z * (1 - alpha) + this.rawMid.z * alpha;

    // Csippentési hiszterézis: könnyű elindítani (0.38) és stabilan tartja (0.52)
    const shouldPinch = this.isPinching ? pinchDist < 0.52 : pinchDist < 0.38;

    // Kijelző képernyő-koordináták a holografikus célzóhoz (gyorsítótárazott ablakmérettel, elkerülve a DOM layout lekérdezést)
    const screenX = (1 - this.smoothedMid.x) * this.winW;
    const screenY = this.smoothedMid.y * this.winH;

    if (this.handReticle) {
      this.handReticle.classList.remove('hidden');
      // GPU Hardveresen gyorsított translate3d (0 DOM layout reflow / újrarajzolás)
      this.handReticle.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;

      if (this.pinchMeter) {
        const pinchProgress = Math.max(0, Math.min(1, (0.65 - pinchDist) / 0.32));
        this.pinchMeter.style.transform = `scale(${0.45 + pinchProgress * 0.55})`;
      }
    }

    if (shouldPinch) {
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchAnchor.x = this.smoothedMid.x;
        this.pinchAnchor.y = this.smoothedMid.y;
        this.pinchAnchor.z = this.smoothedMid.z;

        if (this.handReticle) {
          this.handReticle.classList.add('pinching');
          if (this.reticleLabel) this.reticleLabel.innerText = '✊ FESZÍTVE';
        }
        if (navigator.vibrate) navigator.vibrate(28);

        if (this.onPinchStart) this.onPinchStart(this.smoothedMid);
      } else {
        // Mozgatási vektor az eredeti rögzítési ponthoz képest
        this.tempDelta.x = (this.pinchAnchor.x - this.smoothedMid.x) * 2.5;
        this.tempDelta.y = (this.smoothedMid.y - this.pinchAnchor.y) * 2.5;
        this.tempDelta.z = (this.pinchAnchor.z - this.smoothedMid.z) * 3.2;

        if (this.onPinchMove) {
          this.onPinchMove(this.tempDelta);
        }
      }
    } else {
      if (this.isPinching) {
        this.isPinching = false;
        if (this.handReticle) {
          this.handReticle.classList.remove('pinching');
          if (this.reticleLabel) this.reticleLabel.innerText = '🖐️ Kéz követve';
        }
        if (navigator.vibrate) navigator.vibrate(18);

        // Kilövés után 900 ms AI-szünet: a becsapódás és fizikai omlás alatt 0% AI terhelés
        this.pauseUntil = performance.now() + 900;

        if (this.onPinchEnd) this.onPinchEnd(true);
      }
    }

    if (this.onStatusChange) {
      this.onStatusChange({
        active: true,
        handDetected: true,
        isPinching: this.isPinching,
        x: screenX,
        y: screenY
      });
    }
  }

  // WebXR Natív Hand Tracking frissítés (amennyiben a hardver támogatja)
  updateXRHand(frame, referenceSpace) {
    if (!this.isActive || !frame || !frame.session) return;

    for (const inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        if (!this.hasNativeXRHand) {
          this.hasNativeXRHand = true;
          if (this.cameraUtils) {
            try { this.cameraUtils.stop(); } catch (e) {}
          }
        }

        const indexTip = inputSource.hand.get('index-finger-tip');
        const thumbTip = inputSource.hand.get('thumb-tip');

        if (indexTip && thumbTip) {
          const indexPose = frame.getJointPose(indexTip, referenceSpace);
          const thumbPose = frame.getJointPose(thumbTip, referenceSpace);

          if (indexPose && thumbPose) {
            const p1 = indexPose.transform.position;
            const p2 = thumbPose.transform.position;

            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
            this.rawMid.x = (p1.x + p2.x) * 0.5;
            this.rawMid.y = (p1.y + p2.y) * 0.5;
            this.rawMid.z = (p1.z + p2.z) * 0.5;

            const XR_PINCH_DIST = 0.042; // 4.2 cm kényelmes csippentési zóna

            if (dist < XR_PINCH_DIST) {
              if (!this.isPinching) {
                this.isPinching = true;
                this.pinchAnchor.x = this.rawMid.x;
                this.pinchAnchor.y = this.rawMid.y;
                this.pinchAnchor.z = this.rawMid.z;
                if (navigator.vibrate) navigator.vibrate(28);
                if (this.onPinchStart) this.onPinchStart(this.rawMid);
              } else {
                this.tempDelta.x = (this.rawMid.x - this.pinchAnchor.x);
                this.tempDelta.y = (this.rawMid.y - this.pinchAnchor.y);
                this.tempDelta.z = (this.rawMid.z - this.pinchAnchor.z);
                if (this.onPinchMove) this.onPinchMove(this.tempDelta);
              }
            } else if (this.isPinching) {
              this.isPinching = false;
              if (navigator.vibrate) navigator.vibrate(18);
              if (this.onPinchEnd) this.onPinchEnd(true);
            }
            break;
          }
        }
      }
    }
  }
}
