// Hand Tracking Rendszer: az október eleji (932c432 / f42f9c5) gyors, közvetlen 320x240 GPU-s MediaPipe felépítés
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

      // Az október eleji (f42f9c5) beállítás: modelComplexity: 0 (GPU Lite modell), 0.6 confidence
      this.mediaPipeHands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
      });

      this.mediaPipeHands.onResults(this.onMediaPipeResults.bind(this));
    }

    this.isProcessing = false;
    this.lastProcessTime = 0;

    // Az október 3. / október 12. (932c432 / f42f9c5) natív 320x240-es kamerafelbontása és Camera Utils vezérlése
    if (window.Camera && this.videoElement) {
      this.cameraUtils = new window.Camera(this.videoElement, {
        onFrame: async () => {
          if (!this.isActive || !this.mediaPipeHands || this.isProcessing) return;
          const now = performance.now();
          if (now - this.lastProcessTime < 33) return; // Max 30 FPS feldolgozás a CPU/GPU kíméléséhez
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

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.emitStatusIfChanged(true, false, false);
      if (this.isPinching) {
        this.isPinching = false;
        if (this.onPinchEnd) this.onPinchEnd(false);
      }
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

    // Aluláteresztő simítás (EMA) kézremegés ellen
    const alpha = 0.55;
    this.smoothedMid.x = this.smoothedMid.x * (1 - alpha) + rawMidX * alpha;
    this.smoothedMid.y = this.smoothedMid.y * (1 - alpha) + rawMidY * alpha;
    this.smoothedMid.z = this.smoothedMid.z * (1 - alpha) + rawMidZ * alpha;

    // Skála-független csippentési küszöb hiszterézissel (be: 0.32 * kézméret, ki: 0.42 * kézméret)
    const pinchRatio = pinchDist / handScale;
    const shouldPinch = this.isPinching ? pinchRatio < 0.42 : pinchRatio < 0.32;

    if (shouldPinch) {
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchAnchor.x = this.smoothedMid.x;
        this.pinchAnchor.y = this.smoothedMid.y;
        this.pinchAnchor.z = this.smoothedMid.z;
        if (this.onPinchStart) this.onPinchStart(this.smoothedMid);
      } else {
        // Mozgatás az eredeti rögzítési ponthoz képest (invertált X a tükörkép miatt)
        const deltaX = (this.pinchAnchor.x - this.smoothedMid.x) * 2.2;
        const deltaY = (this.smoothedMid.y - this.pinchAnchor.y) * 2.2;
        const deltaZ = (this.pinchAnchor.z - this.smoothedMid.z) * 2.8;

        if (this.onPinchMove) {
          this.onPinchMove({ x: deltaX, y: deltaY, z: deltaZ });
        }
      }
    } else if (this.isPinching) {
      this.isPinching = false;
      if (this.onPinchEnd) this.onPinchEnd(true);
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
            const mid = {
              x: (p1.x + p2.x) / 2,
              y: (p1.y + p2.y) / 2,
              z: (p1.z + p2.z) / 2
            };

            const XR_PINCH_DIST = 0.038; // 3.8 cm

            if (dist < XR_PINCH_DIST) {
              if (!this.isPinching) {
                this.isPinching = true;
                this.pinchAnchor = { ...mid };
                if (this.onPinchStart) this.onPinchStart(mid);
              } else {
                const deltaX = (mid.x - this.pinchAnchor.x);
                const deltaY = (mid.y - this.pinchAnchor.y);
                const deltaZ = (mid.z - this.pinchAnchor.z);
                if (this.onPinchMove) this.onPinchMove({ x: deltaX, y: deltaY, z: deltaZ });
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
