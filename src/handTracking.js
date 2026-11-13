// 1€ Filter (One Euro Filter) – Meta Quest / Vision Pro szintű adaptív kézremegés-szűrő (0 memóriafoglalással)
class OneEuroFilter1D {
  constructor(minCutoff = 1.15, beta = 0.045, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, tMs) {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = tMs;
      return x;
    }

    const dt = Math.max(0.004, Math.min(0.25, (tMs - this.tPrev) * 0.001));
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    this.dxPrev = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const filtered = this.xPrev + this.alpha(cutoff, dt) * (x - this.xPrev);
    this.xPrev = filtered;
    return filtered;
  }
}

// Hand Tracking Rendszer: Október 3-i 320x240 GPU-s MediaPipe + 1€ Filter + Auto-Hold csippentés-stabilizátor
export class HandTracker {
  constructor(onPinchStart, onPinchMove, onPinchEnd, onStatusChange = null) {
    this.onPinchStart = onPinchStart;
    this.onPinchMove = onPinchMove;
    this.onPinchEnd = onPinchEnd;
    this.onStatusChange = onStatusChange;

    this.isActive = false;
    this.isPinching = false;
    this.pinchAnchor = { x: 0, y: 0, z: 0 };
    this.smoothedMid = { x: 0, y: 0, z: 0 };
    this.tempDelta = { x: 0, y: 0, z: 0 };

    // 3D 1€ Filter példányok (X, Y, Z tengelyekre)
    this.filterX = new OneEuroFilter1D(1.15, 0.045, 1.0);
    this.filterY = new OneEuroFilter1D(1.15, 0.045, 1.0);
    this.filterZ = new OneEuroFilter1D(1.05, 0.040, 1.0);

    // Auto-Hold (Coyote-time) csippentés-megtartó időzítő (ms)
    this.pinchLostAt = 0;
    this.PINCH_HOLD_GRACE_MS = 165;

    this.videoElement = null;
    this.cameraUtils = null;
    this.mediaPipeHands = null;
    this.stream = null;
    this.animFrameId = null;

    this.isProcessing = false;
    this.lastProcessTime = 0;
    this._lastStatusKey = '';
    this._scriptsPromise = null;
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
    if (typeof window.Hands !== 'undefined' && typeof window.Camera !== 'undefined') return true;
    if (!this._scriptsPromise) {
      this._scriptsPromise = Promise.all([
        this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js'),
        this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js')
      ]).catch((err) => {
        this._scriptsPromise = null;
        throw err;
      });
    }
    await this._scriptsPromise;
    return typeof window.Hands !== 'undefined';
  }

  emitStatusIfChanged(active, handDetected, isPinching) {
    if (!this.onStatusChange) return;
    const key = `${active ? 1 : 0}:${handDetected ? 1 : 0}:${isPinching ? 1 : 0}`;
    if (this._lastStatusKey === key) return;
    this._lastStatusKey = key;
    this.onStatusChange({ active, handDetected, isPinching });
  }

  initDOM(videoEl) {
    this.videoElement = videoEl;
    if (this.videoElement) {
      this.videoElement.style.display = 'none';
    }
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;
    this.pinchLostAt = 0;
    this.filterX.reset();
    this.filterY.reset();
    this.filterZ.reset();
    this._lastStatusKey = '';
    this.emitStatusIfChanged(true, false, false);

    try {
      const loaded = await this.ensureScriptsLoaded();
      if (!this.isActive) return;
      if (loaded && this.videoElement) {
        await this.initMediaPipe();
      }
    } catch (err) {
      console.warn('MediaPipe indítási hiba:', err);
    }
  }

  stop() {
    this.isActive = false;
    this.isPinching = false;
    this.pinchLostAt = 0;
    this.filterX.reset();
    this.filterY.reset();
    this.filterZ.reset();
    this.emitStatusIfChanged(false, false, false);

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
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

  async initMediaPipe() {
    if (!this.mediaPipeHands) {
      this.mediaPipeHands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      this.mediaPipeHands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55
      });

      this.mediaPipeHands.onResults(this.onMediaPipeResults.bind(this));
    }

    this.isProcessing = false;
    this.lastProcessTime = 0;

    // Az október 3-i (932c432 / f42f9c5) natív 320x240-es kamerafelbontás és Camera Utils vezérlés
    if (window.Camera && this.videoElement) {
      this.cameraUtils = new window.Camera(this.videoElement, {
        onFrame: async () => {
          if (!this.isActive || !this.mediaPipeHands || this.isProcessing) return;
          const now = performance.now();
          if (now - this.lastProcessTime < 33) return;
          this.isProcessing = true;
          this.lastProcessTime = now;
          try {
            await this.mediaPipeHands.send({ image: this.videoElement });
          } catch (e) {
          } finally {
            this.isProcessing = false;
          }
        },
        width: 320,
        height: 240
      });
      await this.cameraUtils.start();
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 320, height: 240 }
        });
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();

        const processFrame = async () => {
          if (!this.isActive) return;
          const now = performance.now();
          if (!this.isProcessing && (now - this.lastProcessTime >= 33)) {
            this.isProcessing = true;
            this.lastProcessTime = now;
            try {
              if (this.videoElement.readyState >= 2 && this.mediaPipeHands) {
                await this.mediaPipeHands.send({ image: this.videoElement });
              }
            } catch (e) {
            } finally {
              this.isProcessing = false;
            }
          }

          if (this.isActive) {
            if ('requestVideoFrameCallback' in this.videoElement) {
              this.videoElement.requestVideoFrameCallback(processFrame);
            } else {
              this.animFrameId = requestAnimationFrame(processFrame);
            }
          }
        };
        processFrame();
      } catch (camErr) {
        console.warn('getUserMedia kamera fallback hiba:', camErr);
      }
    }
  }

  onMediaPipeResults(results) {
    if (!this.isActive) return;
    const now = performance.now();

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      // Auto-Hold (Coyote-time): ha csippentés közben 1-2 képkockára (<165 ms) kitakaródik a kéz, nem szakítjuk meg!
      if (this.isPinching) {
        if (this.pinchLostAt === 0) {
          this.pinchLostAt = now;
          return;
        }
        if (now - this.pinchLostAt < this.PINCH_HOLD_GRACE_MS) {
          return;
        }
        this.isPinching = false;
        this.pinchLostAt = 0;
        if (this.onPinchEnd) this.onPinchEnd(false);
      }
      this.filterX.reset();
      this.filterY.reset();
      this.filterZ.reset();
      this.emitStatusIfChanged(true, false, false);
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const thumb = landmarks[4];  // Hüvelykujj hegye
    const index = landmarks[8];  // Mutatóujj hegye

    // Kéz méretének skálázási alapja (csukló és középső ujj tő távolsága)
    const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.2;

    // Csippentési távolság számítása (3D Euklideszi távolság)
    const dx = thumb.x - index.x;
    const dy = thumb.y - index.y;
    const dz = (thumb.z - index.z) || 0;
    const pinchDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const rawMidX = (thumb.x + index.x) * 0.5;
    const rawMidY = (thumb.y + index.y) * 0.5;
    const rawMidZ = (thumb.z + index.z) * 0.5;

    // 1€ Filter: álló kéznél kiszűri a remegést, mozgó kéznél 0 ms késleltetéssel követ
    this.smoothedMid.x = this.filterX.filter(rawMidX, now);
    this.smoothedMid.y = this.filterY.filter(rawMidY, now);
    this.smoothedMid.z = this.filterZ.filter(rawMidZ, now);

    // Skála-független csippentési küszöb hiszterézissel (könnyen megfogható: 0.35, stabilan tartható: 0.46)
    const pinchRatio = pinchDist / handScale;
    const isCurrentlyPinched = this.isPinching ? pinchRatio < 0.46 : pinchRatio < 0.35;

    if (isCurrentlyPinched) {
      this.pinchLostAt = 0;
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchAnchor.x = this.smoothedMid.x;
        this.pinchAnchor.y = this.smoothedMid.y;
        this.pinchAnchor.z = this.smoothedMid.z;
        if (this.onPinchStart) this.onPinchStart(this.smoothedMid);
      } else {
        // Könnyített, rövidebb kézmozdulat: kis hátrahúzásra is gyorsan eléri a 100%-os erőt
        this.tempDelta.x = (this.pinchAnchor.x - this.smoothedMid.x) * 2.8;
        this.tempDelta.y = (this.smoothedMid.y - this.pinchAnchor.y) * 2.8;
        this.tempDelta.z = (this.pinchAnchor.z - this.smoothedMid.z) * 3.6;

        if (this.onPinchMove) {
          this.onPinchMove(this.tempDelta);
        }
      }
    } else if (this.isPinching) {
      // Ha csak enyhén nyílt szét (<0.54) 1-2 képkockára húzás közben, adunk egy rövid (110 ms) türelmi időt;
      // ha viszont határozottan kinyitotta az ujjait (>=0.54), azonnal kilő!
      if (pinchRatio < 0.54) {
        if (this.pinchLostAt === 0) {
          this.pinchLostAt = now;
        } else if (now - this.pinchLostAt >= 110) {
          this.isPinching = false;
          this.pinchLostAt = 0;
          if (this.onPinchEnd) this.onPinchEnd(true);
        }
      } else {
        this.isPinching = false;
        this.pinchLostAt = 0;
        if (this.onPinchEnd) this.onPinchEnd(true);
      }
    }

    this.emitStatusIfChanged(true, true, this.isPinching);
  }

  // WebXR Natív Hand Tracking frissítés minden render képkockában
  updateXRHand(frame, referenceSpace) {
    if (!this.isActive || !frame || !frame.session) return;

    for (const inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        const indexTip = inputSource.hand.get('index-finger-tip');
        const thumbTip = inputSource.hand.get('thumb-tip');

        if (indexTip && thumbTip) {
          const indexPose = frame.getJointPose(indexTip, referenceSpace);
          const thumbPose = frame.getJointPose(thumbTip, referenceSpace);

          if (indexPose && thumbPose) {
            const p1 = indexPose.transform.position;
            const p2 = thumbPose.transform.position;

            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
            const midX = (p1.x + p2.x) * 0.5;
            const midY = (p1.y + p2.y) * 0.5;
            const midZ = (p1.z + p2.z) * 0.5;

            const XR_PINCH_DIST = 0.040;

            if (dist < XR_PINCH_DIST) {
              if (!this.isPinching) {
                this.isPinching = true;
                this.pinchAnchor.x = midX;
                this.pinchAnchor.y = midY;
                this.pinchAnchor.z = midZ;
                if (this.onPinchStart) this.onPinchStart(this.pinchAnchor);
              } else {
                this.tempDelta.x = (midX - this.pinchAnchor.x) * 1.4;
                this.tempDelta.y = (midY - this.pinchAnchor.y) * 1.4;
                this.tempDelta.z = (midZ - this.pinchAnchor.z) * 1.6;
                if (this.onPinchMove) this.onPinchMove(this.tempDelta);
              }
            } else if (this.isPinching) {
              this.isPinching = false;
              if (this.onPinchEnd) this.onPinchEnd(true);
            }
            break;
          }
        }
      }
    }
  }
}
