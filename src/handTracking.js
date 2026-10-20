// Hand Tracking Rendszer: WebXR Natív Kézkövetés + MediaPipe Hands Láthatatlan Háttérfeldolgozás
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
    this.smoothedMid = { x: 0, y: 0, z: 0 };
    this.rawMid = { x: 0, y: 0, z: 0 };
    this.tempDelta = { x: 0, y: 0, z: 0 };

    this.videoElement = null;
    this.cameraUtils = null;
    this.mediaPipeHands = null;
    this.stream = null;
    this.animFrameId = null;

    // Intelligens terheléselosztó időzítő:
    // A MediaPipe AI lépések befejezése UTÁN garantált pihenőidőt (Idle Gap) adunk a CPU-nak,
    // így a Three.js 60 FPS renderelése és a fizika zavartalanul futhat.
    this.isProcessing = false;
    this.lastCompletionTime = 0;
    this.minIdleGapMs = 45; // ~15-18 FPS AI mintavételezés a 100%-os CPU túlterhelés és forrósodás ellen
  }

  initDOM(videoEl) {
    this.videoElement = videoEl;
    if (this.videoElement) {
      this.videoElement.style.display = 'none'; // Szigorúan háttérben fut, semmilyen képernyőtartalom nem jelenik meg!
    }
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;
    if (this.onStatusChange) this.onStatusChange({ active: true, handDetected: false, isPinching: false });

    // 1. Megvizsgáljuk, hogy elérhető-e a MediaPipe globálisan
    if (typeof window.Hands !== 'undefined' && this.videoElement) {
      try {
        await this.initMediaPipe();
      } catch (err) {
        console.warn('MediaPipe indítási hiba:', err);
      }
    }
  }

  stop() {
    this.isActive = false;
    this.isPinching = false;
    this.hasNativeXRHand = false;
    if (this.onStatusChange) this.onStatusChange({ active: false, handDetected: false, isPinching: false });

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

      // modelComplexity: 0 (Lite modell), 0.5 confidence a stabil követésért
      // (megelőzi a számításigényes teljes képernyős tenyér-újradetektálást)
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

    // Alacsonyabb kamerafelbontás (240x180): a MediaPipe belső bemeneti tenzora 224x224,
    // így a 240x180 több mint 75% memóriamásolást és kamera ISP sávszélességet takarít meg a telefonon!
    if (window.Camera && this.videoElement) {
      this.cameraUtils = new window.Camera(this.videoElement, {
        onFrame: async () => {
          if (!this.isActive || !this.mediaPipeHands || this.isProcessing || this.hasNativeXRHand) return;
          const now = performance.now();
          if (now - this.lastCompletionTime < this.minIdleGapMs) return;

          this.isProcessing = true;
          try {
            await this.mediaPipeHands.send({ image: this.videoElement });
          } catch (e) {
          } finally {
            this.isProcessing = false;
            this.lastCompletionTime = performance.now();
          }
        },
        width: 240,
        height: 180
      });
      await this.cameraUtils.start();
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 240, max: 320 },
            height: { ideal: 180, max: 240 },
            frameRate: { ideal: 20, max: 24 }
          }
        });
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();

        const processFrame = async () => {
          if (!this.isActive) return;
          const now = performance.now();
          if (!this.isProcessing && !this.hasNativeXRHand && (now - this.lastCompletionTime >= this.minIdleGapMs)) {
            this.isProcessing = true;
            try {
              if (this.videoElement.readyState >= 2 && this.mediaPipeHands) {
                await this.mediaPipeHands.send({ image: this.videoElement });
              }
            } catch (e) {
            } finally {
              this.isProcessing = false;
              this.lastCompletionTime = performance.now();
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

    // FONTOS: A felhasználói kérésnek megfelelően a szelfi kamera tartalma
    // SOHA nem jelenik meg a képernyőn! A videó kizárólag a háttérben fut az AI felismeréshez.
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      if (this.onStatusChange) this.onStatusChange({ active: true, handDetected: false, isPinching: false });
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

    this.rawMid.x = (thumb.x + index.x) * 0.5;
    this.rawMid.y = (thumb.y + index.y) * 0.5;
    this.rawMid.z = (thumb.z + index.z) * 0.5;

    // Aluláteresztő simítás (EMA) kézremegés ellen
    const alpha = 0.55;
    this.smoothedMid.x = this.smoothedMid.x * (1 - alpha) + this.rawMid.x * alpha;
    this.smoothedMid.y = this.smoothedMid.y * (1 - alpha) + this.rawMid.y * alpha;
    this.smoothedMid.z = this.smoothedMid.z * (1 - alpha) + this.rawMid.z * alpha;

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
        this.tempDelta.x = (this.pinchAnchor.x - this.smoothedMid.x) * 2.2;
        this.tempDelta.y = (this.smoothedMid.y - this.pinchAnchor.y) * 2.2;
        this.tempDelta.z = (this.pinchAnchor.z - this.smoothedMid.z) * 2.8;

        if (this.onPinchMove) {
          this.onPinchMove(this.tempDelta);
        }
      }
    } else {
      if (this.isPinching) {
        this.isPinching = false;
        if (this.onPinchEnd) this.onPinchEnd(true);
      }
    }

    if (this.onStatusChange) {
      this.onStatusChange({ active: true, handDetected: true, isPinching: this.isPinching });
    }
  }

  // WebXR Natív Hand Tracking frissítés minden render képkockában
  updateXRHand(frame, referenceSpace) {
    if (!this.isActive || !frame || !frame.session) return;

    for (const inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        if (!this.hasNativeXRHand) {
          this.hasNativeXRHand = true;
          // Ha natív WebXR kézkövetés elérhető, leállítjuk a felesleges webkamera AI-t
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

            const XR_PINCH_DIST = 0.038; // 3.8 cm

            if (dist < XR_PINCH_DIST) {
              if (!this.isPinching) {
                this.isPinching = true;
                this.pinchAnchor.x = this.rawMid.x;
                this.pinchAnchor.y = this.rawMid.y;
                this.pinchAnchor.z = this.rawMid.z;
                if (this.onPinchStart) this.onPinchStart(this.rawMid);
              } else {
                this.tempDelta.x = (this.rawMid.x - this.pinchAnchor.x);
                this.tempDelta.y = (this.rawMid.y - this.pinchAnchor.y);
                this.tempDelta.z = (this.rawMid.z - this.pinchAnchor.z);
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
