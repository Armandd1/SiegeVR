// Hand Tracking Rendszer: WebXR Natív Kézkövetés + MediaPipe Hands Webkamera Integráció
export class HandTracker {
  constructor(onPinchStart, onPinchMove, onPinchEnd) {
    this.onPinchStart = onPinchStart;
    this.onPinchMove = onPinchMove;
    this.onPinchEnd = onPinchEnd;

    this.isActive = false;
    this.isPinching = false;
    this.pinchAnchor = { x: 0, y: 0, z: 0 };

    this.videoElement = null;
    this.pipCanvas = null;
    this.pipCtx = null;
    this.cameraUtils = null;
    this.mediaPipeHands = null;

    this.xrHand = null;
  }

  initDOM(videoEl, canvasEl) {
    this.videoElement = videoEl;
    this.pipCanvas = canvasEl;
    if (this.pipCanvas) {
      this.pipCtx = this.pipCanvas.getContext('2d');
    }
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;

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

    if (this.cameraUtils) {
      try {
        this.cameraUtils.stop();
      } catch (e) {}
      this.cameraUtils = null;
    }

    if (this.videoElement && this.videoElement.srcObject) {
      try {
        const tracks = this.videoElement.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      } catch (e) {}
      this.videoElement.srcObject = null;
    }

    if (this.pipCanvas && this.pipCtx) {
      this.pipCtx.clearRect(0, 0, this.pipCanvas.width, this.pipCanvas.height);
    }
  }

  async initMediaPipe() {
    this.mediaPipeHands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    this.mediaPipeHands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.65
    });

    this.mediaPipeHands.onResults(this.onMediaPipeResults.bind(this));

    if (window.Camera && this.videoElement) {
      this.cameraUtils = new window.Camera(this.videoElement, {
        onFrame: async () => {
          if (this.isActive && this.mediaPipeHands) {
            await this.mediaPipeHands.send({ image: this.videoElement });
          }
        },
        width: 320,
        height: 240
      });
      await this.cameraUtils.start();
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && this.videoElement) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 320, height: 240 }
        });
        this.videoElement.srcObject = stream;
        await this.videoElement.play();

        const processFrame = async () => {
          if (!this.isActive) return;
          try {
            if (this.videoElement.readyState >= 2 && this.mediaPipeHands) {
              await this.mediaPipeHands.send({ image: this.videoElement });
            }
          } catch (e) {}

          if ('requestVideoFrameCallback' in this.videoElement) {
            this.videoElement.requestVideoFrameCallback(processFrame);
          } else {
            requestAnimationFrame(processFrame);
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

    // PIP kis előnézeti vászon kirajzolása
    if (this.pipCanvas && this.pipCtx) {
      this.pipCanvas.width = 160;
      this.pipCanvas.height = 120;
      this.pipCtx.save();
      this.pipCtx.clearRect(0, 0, this.pipCanvas.width, this.pipCanvas.height);

      // Tükrözött kamerakép
      this.pipCtx.translate(this.pipCanvas.width, 0);
      this.pipCtx.scale(-1, 1);
      this.pipCtx.drawImage(results.image, 0, 0, this.pipCanvas.width, this.pipCanvas.height);

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        this.drawSkeleton(landmarks);
      }
      this.pipCtx.restore();
    }

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      if (this.isPinching) {
        this.isPinching = false;
        if (this.onPinchEnd) this.onPinchEnd(false);
      }
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    const thumb = landmarks[4];  // Hüvelykujj hegye
    const index = landmarks[8];  // Mutatóujj hegye

    // Csippentési távolság számítása (3D Euklideszi távolság)
    const dx = thumb.x - index.x;
    const dy = thumb.y - index.y;
    const dz = (thumb.z - index.z) || 0;
    const pinchDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const pinchMid = {
      x: (thumb.x + index.x) / 2,
      y: (thumb.y + index.y) / 2,
      z: (thumb.z + index.z) / 2
    };

    const PINCH_THRESHOLD = 0.085;

    // Csippentés állapota
    if (pinchDist < PINCH_THRESHOLD) {
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchAnchor = { ...pinchMid };
        if (this.onPinchStart) this.onPinchStart(pinchMid);
      } else {
        // Mozgatás az eredeti rögzítési ponthoz képest
        // Tükrözött koordináták: ha a kéz jobbra mozog, x csökken
        const deltaX = (this.pinchAnchor.x - pinchMid.x) * 2.2;
        const deltaY = (pinchMid.y - this.pinchAnchor.y) * 2.2; // lefelé húzás
        const deltaZ = (pinchMid.z - this.pinchAnchor.z) * 3.0; // hátrahúzás mélységben

        if (this.onPinchMove) {
          this.onPinchMove({ x: deltaX, y: deltaY, z: deltaZ });
        }
      }
    } else {
      if (this.isPinching) {
        this.isPinching = false;
        if (this.onPinchEnd) this.onPinchEnd(true);
      }
    }
  }

  drawSkeleton(landmarks) {
    const ctx = this.pipCtx;
    const w = this.pipCanvas.width;
    const h = this.pipCanvas.height;

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.fillStyle = this.isPinching ? '#ef4444' : '#22c55e';

    // Csippentő ujjvégek kiemelése
    [4, 8].forEach(idx => {
      const pt = landmarks[idx];
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, this.isPinching ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    });
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

            const XR_PINCH_DIST = 0.035; // 3.5 cm

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
