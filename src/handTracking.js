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

    // Alacsony késleltetésű (~30-40 FPS) AI mintavételezés
    this.isProcessing = false;
    this.lastCompletionTime = 0;
    this.minIdleGapMs = 12; // 12ms szünet = sima, akadozásmentes követés
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

  async start() {
    if (this.isActive) return;
    this.isActive = true;

    if (this.handOverlay) this.handOverlay.classList.remove('hidden');
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

    if (this.handOverlay) this.handOverlay.classList.add('hidden');
    if (this.handReticle) this.handReticle.classList.add('hidden');
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

      // modelComplexity: 0 (Lite modell), optimális magabiztosság a stabil és ugrálásmentes követésért
      this.mediaPipeHands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55
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

    // Kamera inicializálása: 480x360 vagy 320x240 felbontás a pontos ujjhegy felismeréshez
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', // Szelfi kamera a játékos keze felé
            width: { ideal: 480, max: 640 },
            height: { ideal: 360, max: 480 },
            frameRate: { ideal: 30, max: 60 }
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
            width: 480,
            height: 360
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

      if (!this.isProcessing && !this.hasNativeXRHand && (now - this.lastCompletionTime >= this.minIdleGapMs)) {
        this.isProcessing = true;
        try {
          if (this.videoElement && this.videoElement.readyState >= 2 && this.mediaPipeHands) {
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
  }

  onMediaPipeResults(results) {
    if (!this.isActive) return;

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      if (this.handReticle) this.handReticle.classList.add('hidden');
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
    const middle = landmarks[12]; // Középső ujj hegye

    // Kéz méretének skálázási alapja (csukló és középső ujj töve közötti távolság)
    const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.22;

    // 2D Normalizált Euklideszi távolság a hüvelykujj és mutatóujj/középső ujj között
    const dIndex = Math.hypot(thumb.x - index.x, thumb.y - index.y) / handScale;
    const dMiddle = middle ? Math.hypot(thumb.x - middle.x, thumb.y - middle.y) / handScale : 99;
    const pinchDist = Math.min(dIndex, dMiddle);

    // Kézközéppont számítása (hüvelyk és mutató ujj felezőpontja)
    this.rawMid.x = (thumb.x + index.x) * 0.5;
    this.rawMid.y = (thumb.y + index.y) * 0.5;
    this.rawMid.z = (thumb.z + index.z) * 0.5;

    // Adaptív simítás (One-Euro jellegű exponenciális szűrő):
    // Gyors mozgásnál azonnali reakció, lassú mozgásnál rezzenéstelen stabilitás
    const speed = Math.hypot(this.rawMid.x - this.smoothedMid.x, this.rawMid.y - this.smoothedMid.y);
    const alpha = Math.min(0.85, Math.max(0.40, speed * 6.5));

    this.smoothedMid.x = this.smoothedMid.x * (1 - alpha) + this.rawMid.x * alpha;
    this.smoothedMid.y = this.smoothedMid.y * (1 - alpha) + this.rawMid.y * alpha;
    this.smoothedMid.z = this.smoothedMid.z * (1 - alpha) + this.rawMid.z * alpha;

    // Csippentési hiszterézis: könnyű elindítani (0.38) és stabilan tartja (0.52)
    const shouldPinch = this.isPinching ? pinchDist < 0.52 : pinchDist < 0.38;

    // Kijelző képernyő-koordináták a holografikus reticle megjelenítéséhez (szelfi tükörkép korrekció)
    const screenX = (1 - this.smoothedMid.x) * window.innerWidth;
    const screenY = this.smoothedMid.y * window.innerHeight;

    if (this.handReticle) {
      this.handReticle.classList.remove('hidden');
      this.handReticle.style.left = `${screenX}px`;
      this.handReticle.style.top = `${screenY}px`;

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
