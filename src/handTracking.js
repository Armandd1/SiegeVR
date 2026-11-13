// Hand Tracking Rendszer: Eseményvezérelt Web Worker AI + 60 FPS Interpolált AR Hologram Célzó
export class HandTracker {
  constructor(onPinchStart, onPinchMove, onPinchEnd, onStatusChange = null) {
    this.onPinchStart = onPinchStart;
    this.onPinchMove = onPinchMove;
    this.onPinchEnd = onPinchEnd;
    this.onStatusChange = onStatusChange;

    this.isActive = false;
    this.isPinching = false;
    this.handDetected = false;
    this.hasNativeXRHand = false;

    // Zero-allocation újrafelhasznált pozíció-objektumok
    this.pinchAnchor = { x: 0, y: 0, z: 0 };
    this.smoothedMid = { x: 0.5, y: 0.5, z: 0 };
    this.visualMid = { x: 0.5, y: 0.5 };
    this.rawMid = { x: 0.5, y: 0.5, z: 0 };
    this.tempDelta = { x: 0, y: 0, z: 0 };

    this.videoElement = null;
    this.externalVideo = null;
    this.externalStream = null;
    this.isRearCamera = false;
    this.cameraUtils = null;
    this.mediaPipeHands = null;
    this.stream = null;
    this.timerId = null;

    // Holografikus AR Célzókereszt DOM elemek és gyorsítótárazott állapotuk (0 DOM thrashing)
    this.handOverlay = null;
    this.handReticle = null;
    this.pinchMeter = null;
    this.reticleLabel = null;
    this._reticleVisible = false;
    this._lastStatusKey = '';
    this._lastLabelText = '';
    this._targetScale = 0.45;
    this._currentScale = 0.45;

    // Képernyőméret gyorsítótárazása
    this.winW = typeof window !== 'undefined' ? window.innerWidth : 360;
    this.winH = typeof window !== 'undefined' ? window.innerHeight : 640;
    this.onResize = () => {
      this.winW = window.innerWidth || 360;
      this.winH = window.innerHeight || 640;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize, { passive: true });
    }

    // Eseményvezérelt, alacsony frekvenciájú AI mintavételezés (~9–12 FPS háttérszálon, 60 FPS főszálú interpolációval)
    this.isProcessing = false;
    this.lastCompletionTime = 0;
    this.lastSendTime = 0;
    this.lastInferenceDuration = 28;
    this.pauseUntil = 0;
    this._scriptsPromise = null;

    // 128x96 célfelbontás a háttérszálú createImageBitmap hardveres átméretezéshez
    this.captureW = 128;
    this.captureH = 96;
    this._supportsResizeBitmap = true;

    // Web Worker alapú háttérszálú AI kézkövetés
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
      this._scriptsPromise = this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js').catch((err) => {
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
      this.videoElement.style.display = 'none';
    }

    this.handOverlay = document.getElementById('hand-aim-overlay');
    this.handReticle = document.getElementById('hand-reticle');
    this.pinchMeter = document.getElementById('hand-pinch-meter');
    this.reticleLabel = document.getElementById('hand-reticle-label');
  }

  setExternalStream(stream) {
    this.externalStream = stream;
  }

  setExternalVideo(videoEl, isRear = true) {
    this.externalVideo = videoEl;
    this.isRearCamera = isRear;
  }

  getActiveVideoSource() {
    if (this.externalVideo && this.externalVideo.readyState >= 2) {
      return this.externalVideo;
    }
    if (this.videoElement && this.videoElement.readyState >= 2) {
      return this.videoElement;
    }
    return null;
  }

  // Háttérszálú (off-main-thread) hardveres képlekicsinyítés 2D canvas drawImage blokkolás nélkül
  async captureDownscaledBitmap() {
    const source = this.getActiveVideoSource();
    if (!source) return null;

    if (this._supportsResizeBitmap) {
      try {
        return await createImageBitmap(source, {
          resizeWidth: this.captureW,
          resizeHeight: this.captureH,
          resizeQuality: 'pixelated'
        });
      } catch (e) {
        this._supportsResizeBitmap = false;
      }
    }
    return createImageBitmap(source);
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

    // Eseményvezérelt ütemezés: csak a következő esedékes időpontban ébresztjük fel a mintavételezőt
    this.scheduleNextTick();
  }

  emitStatusIfChanged(active, handDetected, isPinching) {
    if (!this.onStatusChange) return;
    const key = `${active ? 1 : 0}:${handDetected ? 1 : 0}:${isPinching ? 1 : 0}`;
    if (this._lastStatusKey === key) return;
    this._lastStatusKey = key;
    this.onStatusChange({ active, handDetected, isPinching });
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;
    this.pauseUntil = 0;
    this._lastStatusKey = '';
    this._reticleVisible = false;

    if (this.handOverlay) this.handOverlay.classList.remove('hidden');
    this.emitStatusIfChanged(true, false, false);

    if (this.useWorker) {
      const ok = await this.initWorker();
      if (!this.isActive) return;
      if (ok) {
        await this.startCameraStream();
        return;
      }
    }

    try {
      const loaded = await this.ensureScriptsLoaded();
      if (!this.isActive) return;
      if (loaded) {
        await this.initMediaPipe();
      }
    } catch (err) {
      console.warn('MediaPipe betöltési/indítási hiba:', err);
    }
  }

  stop() {
    this.isActive = false;
    this.isPinching = false;
    this.handDetected = false;
    this.hasNativeXRHand = false;

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.handOverlay) this.handOverlay.classList.add('hidden');
    if (this.handReticle) this.handReticle.classList.add('hidden');
    this._reticleVisible = false;
    this.emitStatusIfChanged(false, false, false);

    if (this.cameraUtils) {
      try { this.cameraUtils.stop(); } catch (e) {}
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
        if (this.videoElement.srcObject && this.videoElement.srcObject !== this.externalStream) {
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

    // 1. Ha már fut a fő AR kamera <video> elem, közvetlenül abból olvasunk (nincs második videó-dekóder!)
    if (this.externalVideo) {
      this.scheduleNextTick(16);
      return;
    }

    // 2. Ha külső MediaStream van megadva
    if (this.externalStream && this.videoElement) {
      this.isRearCamera = true;
      this.videoElement.srcObject = this.externalStream;
      await this.videoElement.play().catch(() => {});
      this.scheduleNextTick(16);
      return;
    }

    // 3. Dedikált kis felbontású szelfi kamera (160x120 @ 15fps - minimális ISP terhelés)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        this.isRearCamera = false;
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 160, max: 240 },
            height: { ideal: 120, max: 180 },
            frameRate: { ideal: 15, max: 20 }
          },
          audio: false
        });
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        this.scheduleNextTick(16);
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

      const listener = this.mediaPipeHands.h?.h?.listeners?.[0];
      if (listener && listener.outs) {
        listener.wants = ['multi_hand_landmarks', 'image_transformed'];
        listener.outs = {
          multiHandLandmarks: listener.outs.multiHandLandmarks
        };
      }

      this.mediaPipeHands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        useCpuInference: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.mediaPipeHands.onResults(this.onMediaPipeResults.bind(this));
    }

    await this.startCameraStream();
  }

  // Eseményvezérelt időzítő: 0% főszál-terhelés a két AI képkocka közötti ~85-115 ms-ban
  scheduleNextTick(overrideDelayMs = null) {
    if (!this.isActive || this.hasNativeXRHand) return;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    const now = performance.now();
    let delay = overrideDelayMs;
    if (delay === null) {
      if (now < this.pauseUntil) {
        delay = Math.max(80, this.pauseUntil - now);
      } else {
        const baseGap = this.isPinching ? 80 : 115;
        delay = Math.max(baseGap, this.lastInferenceDuration * 1.4);
      }
    }

    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.processSingleTick();
    }, delay);
  }

  async processSingleTick() {
    if (!this.isActive || this.hasNativeXRHand) return;

    const now = performance.now();
    if (document.hidden || now < this.pauseUntil) {
      this.scheduleNextTick(120);
      return;
    }

    if (this.isProcessing) {
      if (now - this.lastSendTime > 1200) {
        this.isProcessing = false;
      } else {
        this.scheduleNextTick(60);
        return;
      }
    }

    const source = this.getActiveVideoSource();
    if (!source) {
      this.scheduleNextTick(100);
      return;
    }

    if (this.useWorker && this.workerReady && this.worker) {
      this.isProcessing = true;
      this.lastSendTime = now;
      try {
        const bitmap = await this.captureDownscaledBitmap();
        if (!bitmap || !this.isActive || !this.worker) {
          if (bitmap && typeof bitmap.close === 'function') bitmap.close();
          this.isProcessing = false;
          this.scheduleNextTick(100);
        } else {
          this.worker.postMessage({ type: 'FRAME', frame: bitmap }, [bitmap]);
        }
      } catch (e) {
        this.isProcessing = false;
        this.scheduleNextTick(120);
      }
    } else if (this.mediaPipeHands) {
      this.isProcessing = true;
      this.lastSendTime = now;
      const tStart = performance.now();
      try {
        await this.mediaPipeHands.send({ image: source });
      } catch (e) {
      } finally {
        this.isProcessing = false;
        this.lastCompletionTime = performance.now();
        this.lastInferenceDuration = this.lastCompletionTime - tStart;
        this.scheduleNextTick();
      }
    }
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
      this.handDetected = false;
      if (this._reticleVisible && this.handReticle) {
        this.handReticle.classList.add('hidden');
        this._reticleVisible = false;
      }
      if (this.isPinching) {
        this.isPinching = false;
        if (this.handReticle) this.handReticle.classList.remove('pinching');
        if (this.onPinchEnd) this.onPinchEnd(false);
      }
      this.emitStatusIfChanged(true, false, false);
      return;
    }

    // Ha hátlapi kamerát használunk, az X koordináta nem tükrözött; szelfi kameránál tükrözött
    const normX = this.isRearCamera ? x : (1 - x);
    this.rawMid.x = normX;
    this.rawMid.y = y;
    this.rawMid.z = z;

    if (!this.handDetected) {
      this.handDetected = true;
      this.smoothedMid.x = normX;
      this.smoothedMid.y = y;
      this.smoothedMid.z = z;
      this.visualMid.x = normX;
      this.visualMid.y = y;
    } else {
      const speed = Math.hypot(this.rawMid.x - this.smoothedMid.x, this.rawMid.y - this.smoothedMid.y);
      const alpha = Math.min(0.85, Math.max(0.42, speed * 6.5));
      this.smoothedMid.x = this.smoothedMid.x * (1 - alpha) + this.rawMid.x * alpha;
      this.smoothedMid.y = this.smoothedMid.y * (1 - alpha) + this.rawMid.y * alpha;
      this.smoothedMid.z = this.smoothedMid.z * (1 - alpha) + this.rawMid.z * alpha;
    }

    const shouldPinch = this.isPinching ? pinchDist < 0.52 : pinchDist < 0.38;
    const pinchProgress = Math.max(0, Math.min(1, (0.65 - pinchDist) / 0.32));
    this._targetScale = 0.45 + pinchProgress * 0.55;

    if (!this._reticleVisible && this.handReticle) {
      this.handReticle.classList.remove('hidden');
      this._reticleVisible = true;
    }

    if (shouldPinch) {
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchAnchor.x = this.smoothedMid.x;
        this.pinchAnchor.y = this.smoothedMid.y;
        this.pinchAnchor.z = this.smoothedMid.z;

        if (this.handReticle) {
          this.handReticle.classList.add('pinching');
          if (this.reticleLabel && this._lastLabelText !== '✊ FESZÍTVE') {
            this.reticleLabel.innerText = '✊ FESZÍTVE';
            this._lastLabelText = '✊ FESZÍTVE';
          }
        }
        if (navigator.vibrate) navigator.vibrate(25);

        if (this.onPinchStart) this.onPinchStart(this.smoothedMid);
      } else {
        this.tempDelta.x = (this.smoothedMid.x - this.pinchAnchor.x) * 2.5;
        this.tempDelta.y = (this.smoothedMid.y - this.pinchAnchor.y) * 2.5;
        this.tempDelta.z = (this.pinchAnchor.z - this.smoothedMid.z) * 3.2;

        if (this.onPinchMove) {
          this.onPinchMove(this.tempDelta);
        }
      }
    } else if (this.isPinching) {
      this.isPinching = false;
      if (this.handReticle) {
        this.handReticle.classList.remove('pinching');
        if (this.reticleLabel && this._lastLabelText !== '🖐️ Kéz követve') {
          this.reticleLabel.innerText = '🖐️ Kéz követve';
          this._lastLabelText = '🖐️ Kéz követve';
        }
      }
      if (navigator.vibrate) navigator.vibrate(16);

      // Kilövés után 950 ms AI-szünet: a becsapódás és fizikai omlás alatt 0% AI terhelés
      this.pauseUntil = performance.now() + 950;

      if (this.onPinchEnd) this.onPinchEnd(true);
    }

    this.emitStatusIfChanged(true, true, this.isPinching);
  }

  // 60 FPS főszálú vizuális interpoláció (0 layout reflow, kizárólag GPU compositor transform)
  updateVisualReticle(dt) {
    if (!this.isActive || !this.handDetected || !this._reticleVisible || !this.handReticle) return;

    const lerpFactor = Math.min(1, dt * 20);
    this.visualMid.x += (this.smoothedMid.x - this.visualMid.x) * lerpFactor;
    this.visualMid.y += (this.smoothedMid.y - this.visualMid.y) * lerpFactor;
    this._currentScale += (this._targetScale - this._currentScale) * lerpFactor;

    const screenX = this.visualMid.x * this.winW;
    const screenY = this.visualMid.y * this.winH;

    this.handReticle.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0)`;
    if (this.pinchMeter) {
      this.pinchMeter.style.transform = `scale(${this._currentScale.toFixed(2)})`;
    }
  }

  // WebXR Natív Hand Tracking frissítés (amennyiben a hardver támogatja)
  updateXRHand(frame, referenceSpace) {
    if (!this.isActive || !frame || !frame.session) return;

    for (const inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        if (!this.hasNativeXRHand) {
          this.hasNativeXRHand = true;
          if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
          }
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

            const XR_PINCH_DIST = 0.042;

            if (dist < XR_PINCH_DIST) {
              if (!this.isPinching) {
                this.isPinching = true;
                this.pinchAnchor.x = this.rawMid.x;
                this.pinchAnchor.y = this.rawMid.y;
                this.pinchAnchor.z = this.rawMid.z;
                if (navigator.vibrate) navigator.vibrate(25);
                if (this.onPinchStart) this.onPinchStart(this.rawMid);
              } else {
                this.tempDelta.x = (this.rawMid.x - this.pinchAnchor.x);
                this.tempDelta.y = (this.rawMid.y - this.pinchAnchor.y);
                this.tempDelta.z = (this.rawMid.z - this.pinchAnchor.z);
                if (this.onPinchMove) this.onPinchMove(this.tempDelta);
              }
            } else if (this.isPinching) {
              this.isPinching = false;
              if (navigator.vibrate) navigator.vibrate(16);
              if (this.onPinchEnd) this.onPinchEnd(true);
            }
            break;
          }
        }
      }
    }
  }
}
