import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { CastleBuilder } from './castle.js';
import { Slingshot } from './slingshot.js';
import { ParticleSystem, SoundEffects, SurfaceScanner } from './effects.js';
import { HandTracker } from './handTracking.js';
import jsQR from 'jsqr';

class WebXRApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.hintIcon = document.getElementById('hint-icon');
    this.hintText = document.getElementById('hint-text');
    this.scoreDisplay = document.getElementById('score-display');
    this.btnBack = document.getElementById('btn-back');
    this.arStepper = document.getElementById('ar-stepper');
    this.step1 = document.getElementById('step-1');
    this.step2 = document.getElementById('step-2');
    this.step3 = document.getElementById('step-3');

    // 🏠 Főoldal / Főmenü Elemek
    this.mainMenu = document.getElementById('main-menu');
    this.uiOverlay = document.getElementById('ui-overlay');
    this.btnStartTouch = document.getElementById('btn-start-touch');
    this.btnStartPhone = document.getElementById('btn-start-phone');
    this.btnStartHand = document.getElementById('btn-start-hand');
    this.btnStartRemoteHand = document.getElementById('btn-start-remote-hand');

    // 📷 Telefonos QR Kód Beolvasó Elemek
    this.qrScannerModal = document.getElementById('qr-scanner-modal');
    this.qrScannerVideo = document.getElementById('qr-scanner-video');
    this.qrScannerCanvas = document.getElementById('qr-scanner-canvas');
    this.qrScannerStatus = document.getElementById('qr-scanner-status');
    this.btnCloseScanner = document.getElementById('btn-close-scanner');
    this.btnConnectManual = document.getElementById('btn-connect-manual');
    this.inputRemoteCode = document.getElementById('input-remote-code');
    this.qrScannerStream = null;
    this.qrScanningActive = false;

    this.remotePeer = null;
    this.remoteConn = null;
    this.menuHighscoreVal = document.getElementById('menu-highscore-val');
    this.insecureWarning = document.getElementById('insecure-context-warning');
    this.toggleTrajectory = document.getElementById('toggle-trajectory');
    this.touchAimSurface = document.getElementById('touch-aim-surface');
    this.handOverlay = document.getElementById('hand-aim-overlay');

    // Játékállapot és vezérlés
    this.isInGame = false;
    this.controlMode = 'TOUCH'; // 'TOUCH' | 'PHONE_MOTION' | 'HAND_TRACKING'
    this.btnPhonePull = document.getElementById('btn-phone-pull');
    this.phoneMotionContainer = document.getElementById('phone-motion-container');
    this.handWebcam = document.getElementById('hand-webcam');
    this.handStatusBadge = document.getElementById('hand-status-badge');
    this.handStatusLabel = document.getElementById('hand-status-label');
    this.btnAutoSlingshot = document.getElementById('btn-auto-slingshot');
    this.btnPlaceConfirm = document.getElementById('btn-place-confirm');
    this.btnReset = document.getElementById('btn-reset');
    this.btnCycle = document.getElementById('btn-cycle-castle');
    this.btnReposition = document.getElementById('btn-reposition');

    // Szkenner HUD elemek és állapot (DOM-thrashing védelemmel)
    this.scanningOverlay = document.getElementById('scanning-overlay');
    this.scanCard = document.getElementById('scan-card');
    this.scanStepBadge = document.getElementById('scan-step-badge');
    this.scanPercentEl = document.getElementById('scan-percent');
    this.scanStatusTitle = document.getElementById('scan-status-title');
    this.scanStatusSub = document.getElementById('scan-status-sub');
    this.scanProgressFill = document.getElementById('scan-progress-fill');

    this.scanProgress = 0;
    this.isSurfaceLocked = false;
    this._lastScanPos = new THREE.Vector3();
    this._hasLastScanPos = false;
    this._lastHudState = { step: '', pct: -1, title: '', sub: '', mode: '' };

    this.isPhonePulling = false;
    this.phoneAnchorCamPos = new THREE.Vector3();
    this.tempUpVector = new THREE.Vector3();
    this.tempCamDelta = new THREE.Vector3();
    this._scanPos = new THREE.Vector3();
    this._tempVecA = new THREE.Vector3();
    this._tempVecB = new THREE.Vector3();
    this._tempDir = new THREE.Vector3();

    // 🖐️ Kézkövetés 60 FPS simító interpolációs vektorok
    this.isHandAiming = false;
    this.targetHandPull = new THREE.Vector3();
    this.currentHandPull = new THREE.Vector3();

    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('siege.highscore') || '0', 10);
    this.scoreThrottle = 0;

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // WebAR és Fallback Kamera Állapot
    this.isXRActive = false;
    this.isFallbackAR = false;
    this.fallbackCameraStream = null;
    this.fallbackVideo = null;
    this.stage = 'PLACE_CASTLE'; // 'PLACE_CASTLE' -> 'PLACE_SLINGSHOT' -> 'BATTLE'
    this.castleWorldPos = new THREE.Vector3(0, 0, -0.20);
    this.slingshotWorldPos = new THREE.Vector3(0, 0, 0.20);
    this.wakeLock = null;

    // WebXR képesség előzetes felmérése betöltéskor (hogy kattintáskor azonnal, szinkronban indulhasson a WebXR)
    this.isXRSupported = false;
    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
        this.isXRSupported = supported;
        console.log('WebXR immersive-ar támogatott:', supported);
      }).catch(() => {
        this.isXRSupported = false;
      });
    }

    this.init();
  }

  setHint(icon, text) {
    if (this.hintIcon) this.hintIcon.innerText = icon;
    if (this.hintText) this.hintText.innerText = text;
  }

  updateScoreDisplay(bump = false) {
    if (!this.scoreDisplay) return;
    this.scoreDisplay.innerText = this.score;
    if (bump) {
      this.scoreDisplay.classList.remove('score-bump');
      void this.scoreDisplay.offsetWidth; // force reflow
      this.scoreDisplay.classList.add('score-bump');
    }
  }

  updateStepper(step) {
    if (this.step1) this.step1.classList.toggle('active', step === 1);
    if (this.step2) this.step2.classList.toggle('active', step === 2);
    if (this.step3) this.step3.classList.toggle('active', step === 3);
  }

  init() {
    // 1. Háttér, Színtér és Kamera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0, 0.40, 0.78);
    this.camera.lookAt(0, 0.10, 0);

    // 2. WebGLRenderer WebXR támogatással és optimalizált árnyékokkal
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio <= 1.5,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x000000, 0); // Teljesen átlátszó WebGL háttér a valós kamera passthrough-hoz!
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.container.appendChild(this.renderer.domElement);

    // 3. Megvilágítás és árnyékok
    this.setupLighting();

    // 4. Területfeltérképező és animált felületi szkenner (SurfaceScanner)
    this.scanner = new SurfaceScanner(this.scene);

    // 5. Árnyékfelfogó talaj AR módhoz (megnövelt méret: 2.2 x 2.2 m a nagyobb várhoz)
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.position.y = -0.001;
    this.shadowPlane.visible = false;
    this.scene.add(this.shadowPlane);

    // 6. Fő rendszerek inicializálása
    this.physics = new PhysicsWorld();
    this.effects = new ParticleSystem(this.scene);
    this.sounds = new SoundEffects();
    this.castle = new CastleBuilder(this.scene, this.physics);

    // Amikor a szkenner rögzíti a felületet, azonnal megszólal a sci-fi ping és haptika
    this.scanner.onLock = () => {
      this.sounds.playScanPing();
    };

    this.slingshot = new Slingshot(
      this.scene,
      this.physics,
      this.camera,
      this.renderer.domElement,
      () => this.sounds.playShoot(),
      (impactPt, isCastleHit) => {
        this.effects.createImpact(impactPt, 22);
        this.sounds.playImpact();
      },
      () => this.sounds.playTension(),
      null
    );
    this.slingshot.setCastle(this.castle);
    this.slingshot.setEffects(this.effects);

    // Röppálya beállítás betöltése a localStorage-ból
    const savedTraj = localStorage.getItem('siege.trajectory');
    const showTraj = savedTraj !== null ? (savedTraj === 'true') : true;
    if (this.toggleTrajectory) {
      this.toggleTrajectory.checked = showTraj;
    }
    this.slingshot.setShowTrajectory(showTraj);

    // 7. Kézkövető rendszer (A szelfi kamera kizárólag a háttérben fut, sosem jelenik meg a kijelzőn!)
    this.handTracker = new HandTracker(
      () => {
        if (!this.isInGame || this.controlMode !== 'HAND_TRACKING') return;
        this.isHandAiming = true;
        this.targetHandPull.set(0, 0, 0);
        this.currentHandPull.set(0, 0, 0);
        this.slingshot.beginAim();
      },
      (delta) => {
        if (!this.isInGame || this.controlMode !== 'HAND_TRACKING') return;
        const pullZ = (delta.z || 0) * 0.56 + (delta.y || 0) * 0.34;
        const pullX = (delta.x || 0) * 0.38;
        const pullY = -(delta.y || 0) * 0.28;
        this.targetHandPull.set(pullX, pullY, pullZ);
        // A 3D röppályát csak az AI mintavételek (~9-10 FPS) pillanatában frissítjük
        this.slingshot.updateTrajectory(
          THREE.MathUtils.clamp(pullX, -0.10, 0.10),
          THREE.MathUtils.clamp(pullY, -0.08, 0.08),
          THREE.MathUtils.clamp(pullZ, 0.004, 0.15)
        );
      },
      (wasFired) => {
        if (!this.isInGame || this.controlMode !== 'HAND_TRACKING') return;
        this.isHandAiming = false;
        this.slingshot.endAim(wasFired);
      },
      (status) => {
        if (this.handStatusBadge && this.handStatusLabel) {
          if (this.isInGame && this.controlMode === 'HAND_TRACKING' && status.active) {
            this.handStatusBadge.classList.remove('hidden');
            const nextText = status.handDetected
              ? (status.isPinching ? '✊ Csippentve' : '🖐️ Kéz követve')
              : '🔍 Keresés...';
            if (this._lastHandBadgeText !== nextText) {
              this.handStatusLabel.innerText = nextText;
              this._lastHandBadgeText = nextText;
            }
          } else {
            this.handStatusBadge.classList.add('hidden');
          }
        }
      }
    );
    this.handTracker.initDOM(this.handWebcam);

    // 8. WebXR Controller érintésekhez
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.controller.addEventListener('selectstart', () => {
      if (this.isInGame && this.stage === 'BATTLE' && this.controlMode === 'TOUCH') {
        this.slingshot.beginAim();
      }
    });
    this.controller.addEventListener('selectend', () => {
      if (this.isInGame && this.stage === 'BATTLE' && this.controlMode === 'TOUCH') {
        this.slingshot.endAim(true);
      }
    });
    this.scene.add(this.controller);

    // 9. UI és Kezelőszervek inicializálása
    this.initUI();
    this.updateScoreDisplay();

    // 10. Főoldali Rekord és HTTPS ellenőrzés
    if (this.menuHighscoreVal) {
      this.menuHighscoreVal.innerText = this.highScore;
    }
    if (!window.isSecureContext && this.insecureWarning) {
      this.insecureWarning.classList.remove('hidden');
    }

    // 🔗 Automatikus QR-kódos csatlakozás a Laptop Kontrollerhez (ha az URL-ben van ?remote=XXXX)
    this.checkAutoRemoteConnect();

    // 11. Render loop
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.render.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  requestShadowUpdate() {
    if (this.renderer && this.renderer.shadowMap) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 0.9);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffaed, 1.9);
    this.dirLight.position.set(1.2, 2.8, 1.6);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 512;
    this.dirLight.shadow.mapSize.height = 512;
    this.dirLight.shadow.camera.near = 0.2;
    this.dirLight.shadow.camera.far = 5.0;

    const d = 0.75;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.015;

    this.scene.add(this.dirLight);
  }

  // 🚀 Játék indítása a kiválasztott móddal közvetlenül a Főoldalról
  launchGame(mode) {
    this.sounds.init();
    this.requestWakeLock();
    this.controlMode = mode;
    this.slingshot.setControlMode(mode);
    this.isInGame = true;

    // Főoldal elrejtése, játék HUD megjelenítése és transzparens kamera háttér aktiválása
    document.body.classList.add('in-game');
    document.documentElement.classList.add('in-game');
    if (this.mainMenu) this.mainMenu.classList.add('hidden');
    if (this.uiOverlay) this.uiOverlay.classList.remove('hidden');

    if (mode === 'TOUCH') {
      if (this.renderer) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      if (this.phoneMotionContainer) this.phoneMotionContainer.classList.add('hidden');
      if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');
      if (this.handOverlay) this.handOverlay.classList.add('hidden');
      this.handTracker.stop();
    } else if (mode === 'PHONE_MOTION') {
      if (this.renderer) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      if (this.phoneMotionContainer) this.phoneMotionContainer.classList.remove('hidden');
      if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');
      if (this.handOverlay) this.handOverlay.classList.add('hidden');
      this.handTracker.stop();
    } else if (mode === 'HAND_TRACKING') {
      // A szkennelés és lerakás alatt 0% AI fut; csak a Harc (BATTLE) fázisban indul el!
      if (this.renderer && (!this.renderer.xr || !this.renderer.xr.isPresenting)) {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      }
      if (this.phoneMotionContainer) this.phoneMotionContainer.classList.add('hidden');
      if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');
      if (this.handOverlay) this.handOverlay.classList.add('hidden');
      this.handTracker.stop();
      this.handTracker.ensureScriptsLoaded().catch(() => {});
    } else if (mode === 'REMOTE_HAND') {
      // 💻 Laptop Kéz Kontroller mód: 0% telefonos AI és 0 szelfi kamera! Maximális 60 FPS
      if (this.renderer) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      if (this.phoneMotionContainer) this.phoneMotionContainer.classList.add('hidden');
      if (this.handStatusBadge) this.handStatusBadge.classList.remove('hidden');
      if (this.handStatusLabel) this.handStatusLabel.innerText = '💻 Laptop kapcsolt';
      if (this.handOverlay) this.handOverlay.classList.add('hidden');
      this.handTracker.stop();
    }

    // Kamera és AR indítása KÖZVETLENÜL a kattintási felhasználói gesztusból (szinkronban)
    this.startAR();
  }

  // 🚪 Vissza a főoldalra: bezár minden kamerát, WebXR-t és leállítja a játékmódot
  returnToMainMenu() {
    this.isInGame = false;
    this.releaseWakeLock();
    document.body.classList.remove('in-game', 'xr-active');
    document.documentElement.classList.remove('in-game', 'xr-active');

    // 1. WebXR munkamenet leállítása és pixelarány visszaállítása
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    }
    if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) {
      const session = this.renderer.xr.getSession();
      if (session) {
        session.end().catch(() => {});
      }
    }
    this.isXRActive = false;
    this.hitTestSourceRequested = false;
    this.hitTestSource = null;
    document.body.classList.remove('xr-active');

    // 2. Kézkövető kamera és AI leállítása (garantált szelfi kamera kikapcsolás)
    if (this.handTracker) {
      this.handTracker.stop();
    }
    if (this.remoteConn) {
      try { this.remoteConn.close(); } catch (e) {}
      this.remoteConn = null;
    }
    this.isHandAiming = false;
    if (this.slingshot) this.slingshot.endAim(false);

    // 3. Fallback környezeti kamera leállítása (összes sáv azonnali felszabadítása)
    this.stopFallbackCamera();

    // 4. Játékelemek, csúzli és vár elrejtése/törlése
    if (this.slingshot) {
      this.slingshot.clearAllProjectiles();
      this.slingshot.hideGhost();
      this.slingshot.group.visible = false;
    }
    if (this.castle) {
      this.castle.hideGhost();
      this.castle.clear();
    }
    if (this.scanner) {
      this.scanner.stop();
      this.scanner.hide();
    }
    if (this.effects) {
      this.effects.clear();
    }
    if (this.shadowPlane) {
      this.shadowPlane.visible = false;
    }

    this.isPhonePulling = false;
    this.score = 0;
    this.updateScoreDisplay();
    this.closeQRScanner();

    // 5. HUD és vezérlőszervek elrejtése
    if (this.uiOverlay) this.uiOverlay.classList.add('hidden');
    if (this.phoneMotionContainer) this.phoneMotionContainer.classList.add('hidden');
    if (this.scanningOverlay) this.scanningOverlay.classList.add('hidden');
    if (this.arStepper) this.arStepper.classList.add('hidden');
    if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');
    if (this.handOverlay) this.handOverlay.classList.add('hidden');
    if (this.touchAimSurface) this.touchAimSurface.classList.add('hidden');
    if (this.btnPlaceConfirm) this.btnPlaceConfirm.classList.add('hidden');
    this.scanProgress = 0;
    this.isSurfaceLocked = false;
    this._lastHudState = { step: '', pct: -1, title: '', sub: '', mode: '' };

    // 6. Szkennelés alapállapotba állítása és főoldal megjelenítése friss rekorddal
    if (this.slingshot) this.slingshot.hasFiredOnce = false;
    if (this.mainMenu) {
      this.mainMenu.classList.remove('hidden');
    }
    if (this.menuHighscoreVal) {
      this.menuHighscoreVal.innerText = this.highScore;
    }
  }

  // 📷 AR / Kamera Indítása: Elsődlegesen natív WebXR szinkron gesztusból, másodlagosan WebRTC fallback
  startAR() {
    // 1. Megpróbáljuk elindítani a natív WebXR 'immersive-ar' munkamenetet közvetlenül a felhasználói kattintásból
    if (navigator.xr) {
      const sessionInit = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'hands'],
        domOverlay: { root: document.getElementById('ui-overlay') }
      };

      try {
        this.renderer.xr.setReferenceSpaceType('local');
        navigator.xr.requestSession('immersive-ar', sessionInit)
          .then(async (session) => {
            session.addEventListener('end', () => {
              this.returnToMainMenu();
            });
            await this.renderer.xr.setSession(session);
            if (this.arStepper) this.arStepper.classList.remove('hidden');
            this.startPlacement(1);
          })
          .catch((xrErr) => {
            console.warn('WebXR AR sikertelen (vagy dom-overlay elutasítva), újrapróbálás vagy fallback kamera:', xrErr);
            navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['hands'] })
              .then(async (session) => {
                session.addEventListener('end', () => {
                  this.returnToMainMenu();
                });
                await this.renderer.xr.setSession(session);
                if (this.arStepper) this.arStepper.classList.remove('hidden');
                this.startPlacement(1);
              })
              .catch(() => {
                this.startFallbackCamera();
              });
          });
        return;
      } catch (e) {
        console.warn('WebXR szinkron kivétel, fallback kamerára váltás:', e);
      }
    }

    // 2. Ha nem támogatott a WebXR, fallback környezeti kamerát indítunk
    this.startFallbackCamera();
  }

  // 📹 WebRTC Háttér Kamera Passthrough (ha a natív WebXR nem érhető el a telefonon)
  async startFallbackCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('A böngésző nem támogatja a kamerát vagy nem HTTPS kapcsolatot használsz.');
      this.returnToMainMenu();
      return;
    }

    try {
      const isHandMode = this.controlMode === 'HAND_TRACKING';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: isHandMode ? 640 : 960 },
          height: { ideal: isHandMode ? 480 : 540 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      });

      this.fallbackCameraStream = stream;

      let video = document.getElementById('ar-camera-feed');
      if (!video) {
        video = document.createElement('video');
        video.id = 'ar-camera-feed';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.playsInline = true;
        video.muted = true;
        video.setAttribute('muted', '');
        video.autoplay = true;
        document.body.prepend(video);
      }

      video.classList.remove('hidden');
      video.srcObject = stream;
      await video.play().catch(err => console.warn('Kameravideó play figyelmeztetés:', err));
      this.fallbackVideo = video;
      this.isFallbackAR = true;

      if (this.arStepper) this.arStepper.classList.remove('hidden');
      this.startPlacement(1);
    } catch (camErr) {
      console.error('Kamera megnyitási hiba:', camErr);
      alert('Nem sikerült megnyitni a kamerát. Kérjük, engedélyezd a kamerahasználatot a böngészőben!');
      this.returnToMainMenu();
    }
  }

  // 📹 Fallback kamera teljes leállítása
  stopFallbackCamera() {
    if (this.fallbackCameraStream) {
      try {
        this.fallbackCameraStream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      this.fallbackCameraStream = null;
    }

    if (this.fallbackVideo) {
      try {
        this.fallbackVideo.pause();
        this.fallbackVideo.srcObject = null;
        this.fallbackVideo.classList.add('hidden');
      } catch (e) {}
      this.fallbackVideo = null;
    }

    this.isFallbackAR = false;
  }

  // DOM-thrashing mentes Terepszkenner HUD frissítés
  updateScanHUD(stepLabel, pct, title, sub, cardMode = 'scanning') {
    const s = this._lastHudState;
    const roundedPct = Math.round(Math.max(0, Math.min(100, pct)));

    if (this.scanStepBadge && s.step !== stepLabel) {
      this.scanStepBadge.innerText = stepLabel;
      s.step = stepLabel;
    }
    if (this.scanPercentEl && s.pct !== roundedPct) {
      this.scanPercentEl.innerText = `${roundedPct}%`;
      if (this.scanProgressFill) {
        this.scanProgressFill.style.width = `${roundedPct}%`;
      }
      s.pct = roundedPct;
    }
    if (this.scanStatusTitle && s.title !== title) {
      this.scanStatusTitle.innerText = title;
      s.title = title;
    }
    if (this.scanStatusSub && s.sub !== sub) {
      this.scanStatusSub.innerText = sub;
      s.sub = sub;
    }
    if (this.scanCard && s.mode !== cardMode) {
      this.scanCard.classList.toggle('locked', cardMode === 'locked');
      this.scanCard.classList.toggle('warning', cardMode === 'warning');
      s.mode = cardMode;
    }
  }

  updateFooterButtons(stage) {
    const isCastle = stage === 'PLACE_CASTLE';
    const isSlingshot = stage === 'PLACE_SLINGSHOT';
    const isBattle = stage === 'BATTLE';

    if (this.btnPlaceConfirm) {
      // Mindig látható a lerakás gomb szkennelés közben (sosem tiltjuk le feleslegesen)
      this.btnPlaceConfirm.classList.toggle('hidden', isBattle);
      const labelEl = this.btnPlaceConfirm.querySelector('.btn-text');
      const iconEl = this.btnPlaceConfirm.querySelector('.btn-icon');
      if (isCastle) {
        if (iconEl) iconEl.innerText = '🏰';
        if (labelEl) labelEl.innerText = 'Vár lerakása';
      } else if (isSlingshot) {
        if (iconEl) iconEl.innerText = '🎯';
        if (labelEl) labelEl.innerText = 'Csúzli lerakása';
      }
    }
    if (this.btnReset) this.btnReset.classList.toggle('hidden', !isBattle);
    if (this.btnCycle) this.btnCycle.classList.toggle('hidden', isSlingshot);
    if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.toggle('hidden', !isSlingshot);
    if (this.btnReposition) this.btnReposition.classList.toggle('hidden', isCastle);
  }

  // Interaktív lehelyezési folyamat indítása
  startPlacement(step) {
    if (this.touchAimSurface) this.touchAimSurface.classList.add('hidden');
    // Szkennelés és lerakás közben a kézkövetés AI teljesen szünetel (0% terhelés)
    if (this.handTracker) this.handTracker.stop();
    this.isHandAiming = false;
    if (this.handOverlay) this.handOverlay.classList.add('hidden');
    if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');

    if (step === 1) {
      this.stage = 'PLACE_CASTLE';
      this.scanProgress = 0;
      this.isSurfaceLocked = false;
      this._hasLastScanPos = false;
      this.scanner.setProgress(0);
      this.scanner.updateTether(null, null, false);
      this.updateStepper(1);
      if (this.arStepper) this.arStepper.classList.remove('hidden');

      this.castle.clear();
      this.slingshot.group.visible = false;
      this.slingshot.hideGhost();
      this.shadowPlane.visible = false;
      this.scanner.show();

      if (this.scanningOverlay) this.scanningOverlay.classList.remove('hidden');
      this.updateScanHUD(
        '1/2 · VÁR HELYE',
        0,
        'Irányítsd a kamerát egy vízszintes asztalra vagy padlóra!',
        'Mozgasd lassan a telefont a felület felett a beméréshez...',
        'scanning'
      );

      this.castle.hideGhost();
      this.updateFooterButtons('PLACE_CASTLE');
      this.requestShadowUpdate();
    } else if (step === 2) {
      this.stage = 'PLACE_SLINGSHOT';
      this.scanProgress = 1;
      this.isSurfaceLocked = true;
      this.scanner.setProgress(1);
      this.updateStepper(2);
      if (this.arStepper) this.arStepper.classList.remove('hidden');

      this.castle.hideGhost();
      this.scanner.show();

      if (this.scanningOverlay) this.scanningOverlay.classList.remove('hidden');
      const initialPos = this.scanner.getPosition(this._scanPos);
      const distCm = Math.round(initialPos.distanceTo(this.castleWorldPos) * 100);
      const isValid = distCm >= 18;
      this.slingshot.showGhost(initialPos, this.castleWorldPos);
      this.slingshot.updateGhost(initialPos, this.castleWorldPos, isValid);
      this.scanner.updateTether(this.castleWorldPos, initialPos, true, isValid);

      this.updateScanHUD(
        '2/2 · CSÚZLI HELYE',
        100,
        isValid ? `Csúzli helye ideális (${distCm} cm)` : `Túl közel a várhoz (${distCm} cm — min. 18 cm kell)`,
        isValid ? 'Koppints a lerakáshoz vagy nyomd meg az Auto csúzlit!' : 'Célozz távolabb a vártól (ideális: 35–50 cm)!',
        isValid ? 'locked' : 'warning'
      );
      this.updateFooterButtons('PLACE_SLINGSHOT');
      this.requestShadowUpdate();
    }
  }

  confirmCastlePlacement(pos) {
    this.castleWorldPos.copy(pos);
    this.shadowPlane.position.copy(this.castleWorldPos);
    this.shadowPlane.visible = true;
    this.effects.groundY = pos.y;

    const yaw = Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
    this.castle.buildCastleAt(this.castleWorldPos, null, yaw);
    this.effects.createPlacementBurst(this.castleWorldPos, 16);
    this.sounds.playBuild();

    if (this.dirLight) {
      this.dirLight.target.position.copy(this.castleWorldPos);
      this.dirLight.target.updateMatrixWorld();
    }

    this.requestShadowUpdate();
    this.startPlacement(2);
  }

  confirmSlingshotPlacement(pos) {
    const distCm = Math.round(pos.distanceTo(this.castleWorldPos) * 100);
    if (distCm < 18) {
      this.updateScanHUD(
        '2/2 · CSÚZLI HELYE',
        100,
        `Túl közel a várhoz (${distCm} cm — min. 18 cm kell)`,
        'Húzd távolabb a célzót, vagy használd az Auto csúzli gombot!',
        'warning'
      );
      this.sounds.triggerHaptic(20);
      return;
    }

    this.slingshotWorldPos.copy(pos);
    this.slingshot.placeAt(pos, this.castleWorldPos);
    this.slingshot.generousGrab = true;
    this.effects.createPlacementBurst(pos, 14);
    this.sounds.playBuild();

    this.scanner.stop();
    this.slingshot.hideGhost();
    if (this.scanningOverlay) this.scanningOverlay.classList.add('hidden');
    if (this.arStepper) this.arStepper.classList.add('hidden');

    // Csata közben leállítjuk a 60 FPS-es ARCore hit-test sugárkövetést (felszabadítva a kamera ISP-t és CPU-t)
    if (this.hitTestSource) {
      try { this.hitTestSource.cancel(); } catch (e) {}
      this.hitTestSource = null;
      this.hitTestSourceRequested = false;
    }

    this.stage = 'BATTLE';
    this.updateStepper(3);
    this.updateFooterButtons('BATTLE');
    this.requestShadowUpdate();

    if (this.controlMode === 'TOUCH' && this.touchAimSurface) {
      this.touchAimSurface.classList.remove('hidden');
    } else if (this.controlMode === 'HAND_TRACKING') {
      this.handTracker.start();
    }
  }

  autoPlaceSlingshot() {
    const dir = this._tempDir.subVectors(this.camera.position, this.castleWorldPos).setY(0).normalize();
    if (dir.lengthSq() < 0.01) {
      dir.set(0, 0, 1);
    }
    const autoPos = this._tempVecA.copy(this.castleWorldPos).addScaledVector(dir, 0.44);
    autoPos.y = this.castleWorldPos.y;

    this.confirmSlingshotPlacement(autoPos);
  }

  onSelect() {
    if (!this.isInGame) return;

    if (this.stage === 'PLACE_CASTLE') {
      const pos = (this.scanner.hasPose || this.scanner.active)
        ? this.scanner.getPosition(this._scanPos)
        : this._tempVecA.copy(this.camera.position).add(this._tempVecB.set(0, -0.18, -0.55).applyQuaternion(this.camera.quaternion));
      this.confirmCastlePlacement(pos);
      return;
    }

    if (this.stage === 'PLACE_SLINGSHOT') {
      const pos = (this.scanner.hasPose || this.scanner.active)
        ? this.scanner.getPosition(this._scanPos)
        : this._tempVecA.copy(this.castleWorldPos).add(this._tempVecB.set(0, 0, 0.44));
      this.confirmSlingshotPlacement(pos);
    }
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnCycle = document.getElementById('btn-cycle-castle');
    const btnReposition = document.getElementById('btn-reposition');

    // 🏠 Főoldali Indító Gombok (Érintés, Telefon & Kéz)
    this.btnStartTouch?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchGame('TOUCH');
    });

    this.btnStartPhone?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchGame('PHONE_MOTION');
    });

    this.btnStartHand?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchGame('HAND_TRACKING');
    });

    // 💻 4. MÓD: Laptop Távoli Kézkövetés QR Beolvasóval
    this.btnStartRemoteHand?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openQRScanner();
    });

    this.btnCloseScanner?.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeQRScanner();
    });

    this.btnConnectManual?.addEventListener('click', (e) => {
      e.preventDefault();
      const code = this.inputRemoteCode?.value?.trim();
      if (!code || code.length < 4) {
        if (this.qrScannerStatus) this.qrScannerStatus.innerText = '⚠️ Írd be a 4 jegyű kódot!';
        return;
      }
      this.closeQRScanner();
      this.connectToLaptopController(code);
    });

    this.inputRemoteCode?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.btnConnectManual?.click();
      }
    });

    // 🚀 Gyors indító gomb az AR élmény azonnali elindításához (megfelel a WebXR User Gesture szabálynak)
    document.getElementById('btn-start-remote-game')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeQRScanner();
      this.launchGame('REMOTE_HAND');
    });

    // ⚙️ Főoldali Röppálya vonalazás ki/bekapcsolása
    this.toggleTrajectory?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      try {
        localStorage.setItem('siege.trajectory', String(enabled));
      } catch (err) {}
      this.slingshot.setShowTrajectory(enabled);
      this.sounds.playBuild();
    });

    // ⬅️ Vissza a főoldalra gomb (bezár minden kamerát és játékmódot)
    this.btnBack?.addEventListener('click', (e) => {
      e.preventDefault();
      this.returnToMainMenu();
    });

    // Vár újraépítése
    btnReset?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      this.castle.rebuild();
      this.score = 0;
      this.updateScoreDisplay();
      this.sounds.playBuild();
      this.effects.clear();
      this.requestShadowUpdate();
    });

    // Vár típusának váltása
    btnCycle?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      if (this.stage === 'PLACE_CASTLE') {
        const layouts = ['fortress', 'pyramid', 'twin_towers', 'citadel'];
        const currIdx = layouts.indexOf(this.castle.currentLayout || 'fortress');
        this.castle.currentLayout = layouts[(currIdx + 1) % layouts.length];
        const initialPos = this.scanner.getPosition(this._scanPos);
        const yaw = Math.atan2(this.camera.position.x - initialPos.x, this.camera.position.z - initialPos.z);
        if (this.isSurfaceLocked) {
          this.castle.showGhost(initialPos, this.castle.currentLayout, yaw);
        }
        this.sounds.playBuild();
      } else {
        this.castle.cycleNextLayout(this.castleWorldPos);
        this.score = 0;
        this.updateScoreDisplay();
        this.sounds.playBuild();
        this.effects.clear();
        this.requestShadowUpdate();
      }
    });

    // Közvetlen lerakás gomb (Alternatíva a képernyőre koppintás helyett)
    this.btnPlaceConfirm?.addEventListener('click', (e) => {
      e.preventDefault();
      this.onSelect();
    });

    // Újrapozicionálás
    btnReposition?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      this.score = 0;
      this.updateScoreDisplay();
      this.effects.clear();
      this.startPlacement(1);
    });

    // Auto csúzli lehelyezés gomb
    this.btnAutoSlingshot?.addEventListener('click', () => {
      this.autoPlaceSlingshot();
    });

    // 📱 Telefonmozgás hüvelykujj FAB eseményei
    const startPhoneGrab = (e) => {
      if (!this.isInGame || this.controlMode !== 'PHONE_MOTION') return;
      e.preventDefault();
      this.isPhonePulling = true;
      this.phoneAnchorCamPos.copy(this.camera.position);
      this.slingshot.beginAim();
      this.btnPhonePull?.classList.add('grabbing');
      this.sounds.playTension();
    };

    const endPhoneGrab = (e) => {
      if (!this.isInGame || this.controlMode !== 'PHONE_MOTION' || !this.isPhonePulling) return;
      this.isPhonePulling = false;
      this.btnPhonePull?.classList.remove('grabbing');
      this.slingshot.endAim(true);
    };

    this.btnPhonePull?.addEventListener('mousedown', startPhoneGrab);
    window.addEventListener('mouseup', endPhoneGrab);
    this.btnPhonePull?.addEventListener('touchstart', startPhoneGrab, { passive: false });
    window.addEventListener('touchend', endPhoneGrab);

    // 👆 Érintéses célzó felület
    this.initTouchAimSurface();

    // Képernyőkoppintás a vár és csúzli lehelyezéséhez
    const onPlacementPointerDown = (e) => {
      if (!this.isInGame) return;
      if (e.target && (e.target.closest('#ui-overlay button') || e.target.closest('#phone-motion-container') || e.target.closest('#main-menu'))) return;

      if ((this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT')) {
        this.onSelect();
      }
    };
    window.addEventListener('pointerdown', onPlacementPointerDown);
  }

  // 📷 Telefonos QR Kód Beolvasó megnyitása a hátlapi kamerával
  async openQRScanner() {
    if (this.qrScannerModal) this.qrScannerModal.classList.remove('hidden');
    if (this.qrScannerStatus) this.qrScannerStatus.innerText = 'Irányítsd a kamerát a laptop képernyőjére!';
    if (this.inputRemoteCode) this.inputRemoteCode.value = '';
    const targetBox = document.querySelector('.qr-target-box');
    if (targetBox) targetBox.classList.remove('success');

    this.qrScanningActive = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (this.qrScannerStatus) this.qrScannerStatus.innerText = '⚠️ A böngésző nem engedi a kamerát. Írd be a kódot!';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      this.qrScannerStream = stream;
      if (this.qrScannerVideo) {
        this.qrScannerVideo.srcObject = stream;
        await this.qrScannerVideo.play().catch(e => console.warn('QR video play:', e));
      }

      this.startQRScanLoop();
    } catch (err) {
      console.warn('QR kamera megnyitási hiba:', err);
      if (this.qrScannerStatus) {
        this.qrScannerStatus.innerText = '⚠️ Kamera nem elérhető. Írd be a 4 jegyű kódot alul!';
      }
    }
  }

  // 📷 QR Kód Beolvasó bezárása és kamera felszabadítása
  closeQRScanner() {
    this.qrScanningActive = false;
    if (this.qrScannerStream) {
      try {
        this.qrScannerStream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      this.qrScannerStream = null;
    }
    if (this.qrScannerVideo) {
      try {
        this.qrScannerVideo.pause();
        this.qrScannerVideo.srcObject = null;
      } catch (e) {}
    }
    if (this.qrScannerModal) {
      this.qrScannerModal.classList.add('hidden');
    }
  }

  // 🔄 Valós idejű QR-kód felismerési hurok (BarcodeDetector + jsQR fallback)
  startQRScanLoop() {
    const video = this.qrScannerVideo;
    const canvas = this.qrScannerCanvas || document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let barcodeDetector = null;
    if ('BarcodeDetector' in window) {
      try {
        barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {}
    }

    const scanFrame = async () => {
      if (!this.qrScanningActive || !video || video.readyState < 2) {
        if (this.qrScanningActive) requestAnimationFrame(scanFrame);
        return;
      }

      let detectedCode = null;

      // 1. Gyors hardveres natív BarcodeDetector
      if (barcodeDetector) {
        try {
          const results = await barcodeDetector.detect(video);
          if (results && results.length > 0 && results[0].rawValue) {
            detectedCode = results[0].rawValue;
          }
        } catch (e) {}
      }

      // 2. jsQR könyvtár fallback
      if (!detectedCode) {
        try {
          const w = 320;
          const h = 240;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const qr = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
          });
          if (qr && qr.data) {
            detectedCode = qr.data;
          }
        } catch (e) {}
      }

      if (detectedCode) {
        let code = null;
        try {
          const url = new URL(detectedCode);
          code = url.searchParams.get('remote');
        } catch (e) {}
        if (!code) {
          const match = detectedCode.match(/\b\d{4}\b/);
          if (match) code = match[0];
        }

        if (code) {
          this.qrScanningActive = false;
          if (navigator.vibrate) navigator.vibrate([40, 50, 40]);
          if (this.qrScannerStatus) {
            this.qrScannerStatus.innerHTML = `✅ Beolvasva: <strong style="color:#fbbf24">${code}</strong>! Csatlakozás...`;
          }
          const targetBox = document.querySelector('.qr-target-box');
          if (targetBox) targetBox.classList.add('success');

          setTimeout(() => {
            this.closeQRScanner();
            this.connectToLaptopController(code);
          }, 350);
          return;
        }
      }

      if (this.qrScanningActive) {
        requestAnimationFrame(scanFrame);
      }
    };

    requestAnimationFrame(scanFrame);
  }

  // 🔗 Automatikus QR kódos csatlakozás (?remote=XXXX)
  checkAutoRemoteConnect() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const remoteCode = urlParams.get('remote');
      if (remoteCode && remoteCode.length === 4) {
        console.log('Automatikus QR kódos csatlakozás észlelve:', remoteCode);
        this.connectToLaptopController(remoteCode);
      }
    } catch (e) {}
  }

  // 💻 P2P WebRTC Csatlakozás a Laptop Kéz Kontrollerhez
  connectToLaptopController(code) {
    if (typeof window.Peer === 'undefined') {
      alert('⏳ Hálózati modul betöltése, próbáld újra pár másodperc múlva!');
      return;
    }

    try {
      if (this.remotePeer) {
        try { this.remotePeer.destroy(); } catch (e) {}
      }

      this.remotePeer = new window.Peer({ debug: 1 });

      this.remotePeer.on('open', () => {
        const targetId = `siege-laptop-${code}`;
        console.log('Telefon Peer kész, csatlakozás a laptophoz:', targetId);
        const conn = this.remotePeer.connect(targetId, { reliable: false }); // Unreliable: ultra-alacsony késleltetésű UDP WebRTC csatorna!

        conn.on('open', () => {
          console.log('P2P WebRTC kapcsolat létrejött a laptoppal!');
          this.remoteConn = conn;
          if (this.qrScannerStatus) {
            this.qrScannerStatus.innerHTML = '🟢 <strong style="color:#4ade80;">Laptop csatlakoztatva!</strong><br>Nyomd meg az indítás gombot:';
          }
          const startBtn = document.getElementById('btn-start-remote-game');
          const manualRow = document.querySelector('.qr-manual-row');
          if (manualRow) manualRow.classList.add('hidden');
          if (startBtn && !this.isInGame) {
            startBtn.classList.remove('hidden');
          } else {
            this.closeQRScanner();
            this.launchGame('REMOTE_HAND');
          }
        });

        conn.on('data', (data) => {
          this.handleRemoteHandData(data);
        });

        conn.on('close', () => {
          console.log('Laptop kapcsolat megszakadt');
          if (this.handStatusLabel) this.handStatusLabel.innerText = '🔴 Laptop lekapcsolódott';
        });

        conn.on('error', (err) => {
          console.warn('Kapcsolódási hiba a laptoppal:', err);
          alert('Nem található laptop ezzel a kóddal. Nyitva van a laptopon a kontroller?');
        });
      });

      this.remotePeer.on('error', (err) => {
        console.warn('Telefon Peer hiba:', err);
        alert('Hálózati hiba a laptophoz csatlakozáskor.');
      });
    } catch (e) {
      console.error('Váratlan hiba:', e);
    }
  }

  // A laptopról érkező 60 FPS kéz-delta adatok feldolgozása (ZÉRÓ telefonos AI-terhelés!)
  handleRemoteHandData(data) {
    if (!this.isInGame || this.controlMode !== 'REMOTE_HAND') return;

    // Ping visszaküldése a laptopnak (késleltetés-méréshez)
    if (data.type === 'PING') {
      if (this.remoteConn && this.remoteConn.open) {
        this.remoteConn.send({ type: 'PONG', t: data.t });
      }
      return;
    }

    if (data.type === 'PINCH_START') {
      this.slingshot.beginAim();
      if (this.handStatusLabel) this.handStatusLabel.innerText = '✊ Csippentve (Laptop)';
      if (navigator.vibrate) navigator.vibrate(25);
    } else if (data.type === 'PINCH_MOVE') {
      const delta = data.delta || {};
      const pullX = delta.x || 0;
      const pullY = delta.y || 0;
      const pullZ = delta.z || 0.005;

      this.slingshot.setPull(pullX, pullY, pullZ);
    } else if (data.type === 'PINCH_END') {
      this.slingshot.endAim(data.fire !== false);
      if (this.handStatusLabel) this.handStatusLabel.innerText = '🖐️ Kéz (Laptop)';
      if (data.fire && navigator.vibrate) navigator.vibrate([30, 40, 50]);
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Amikor a főoldalon vagyunk, ne rendereljük a 3D színteret (0% GPU/CPU terhelés)
    if (!this.isInGame) {
      return;
    }

    if (frame) {
      const session = this.renderer.xr.getSession();
      const referenceSpace = this.renderer.xr.getReferenceSpace();

      if (!this.isXRActive) {
        this.isXRActive = true;
        document.body.classList.add('xr-active');
        if (this.arStepper) this.arStepper.classList.remove('hidden');
        this.startPlacement(1);
      }

      if (!this.hitTestSourceRequested && (this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT')) {
        session.requestReferenceSpace('viewer').then((refSpace) => {
          session.requestHitTestSource({ space: refSpace }).then((source) => {
            this.hitTestSource = source;
          });
        });

        this.hitTestSourceRequested = true;
      }

      // WebXR AR Felületkeresés (Hit-Testing) irányított folyamatjelzővel
      if (this.hitTestSource && (this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT')) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);
          if (pose && pose.transform) {
            const m = pose.transform.matrix;
            const upY = m[5];
            const isHorizontal = upY > 0.25 || Math.abs(m[10]) > 0.25;

            this.scanner.setPose(m, isHorizontal);
            const scanPos = this.scanner.getPosition(this._scanPos);

            if (this.stage === 'PLACE_CASTLE') {
              if (this.scanProgress < 1) {
                this.scanProgress = Math.min(1, this.scanProgress + dt * 1.5);
                this.scanner.setProgress(this.scanProgress);
              }

              const pct = Math.round(this.scanProgress * 100);
              if (this.scanProgress >= 0.5 || this.isSurfaceLocked) {
                if (!this.isSurfaceLocked) {
                  this.isSurfaceLocked = true;
                  this.scanner.triggerLockAnimation();
                  this.updateFooterButtons('PLACE_CASTLE');
                }
                const yaw = Math.atan2(this.camera.position.x - scanPos.x, this.camera.position.z - scanPos.z);
                this.castle.showGhost(scanPos, null, yaw);
                this.updateScanHUD(
                  '1/2 · VÁR HELYE',
                  100,
                  '✅ Asztal bemérve — Kész a lerakásra!',
                  'Koppints a képernyőre vagy a „Vár lerakása” gombra!',
                  'locked'
                );
              } else {
                this.castle.hideGhost();
                this.updateScanHUD(
                  '1/2 · VÁR HELYE',
                  pct,
                  `📡 Felület bemérése folyamatban... (${pct}%)`,
                  'Tartsd a kamerát az asztal felé a felépítéshez!',
                  'scanning'
                );
              }
            } else if (this.stage === 'PLACE_SLINGSHOT') {
              const distCm = Math.round(scanPos.distanceTo(this.castleWorldPos) * 100);
              const isValid = distCm >= 18;
              this.slingshot.updateGhost(scanPos, this.castleWorldPos, isValid);
              this.scanner.updateTether(this.castleWorldPos, scanPos, true, isValid);

              if (!isValid) {
                this.updateScanHUD(
                  '2/2 · CSÚZLI HELYE',
                  100,
                  `⚠️ Túl közel a várhoz (${distCm} cm — min. 18 cm kell)`,
                  'Célozz távolabb a vártól (ideális: 35–50 cm), vagy bökj az Auto csúzlira!',
                  'warning'
                );
              } else {
                this.updateScanHUD(
                  '2/2 · CSÚZLI HELYE',
                  100,
                  `✅ Csúzli helye ideális (${distCm} cm)`,
                  'Koppints a lerakáshoz, vagy használd az „Auto csúzli” gombot!',
                  'locked'
                );
              }
            }
          }
        } else if (this.scanner.isPoseExpired(800)) {
          if (this.stage === 'PLACE_CASTLE') {
            this.updateScanHUD(
              '1/2 · VÁR HELYE',
              Math.round(this.scanProgress * 100),
              'Irányítsd a kamerát az asztal felé...',
              'Mozgasd lassan a telefont a felület felett!',
              'scanning'
            );
          } else {
            this.scanner.updateTether(null, null, false);
            this.updateScanHUD(
              '2/2 · CSÚZLI HELYE',
              100,
              'Célozz az asztalra a csúzli lerakásához...',
              'Irányítsd a kamerát a vár előtti szabad területre, vagy bökj az Auto csúzlira!',
              'scanning'
            );
          }
        }
      }

      // WebXR Hand Tracking frissítése
      if (this.controlMode === 'HAND_TRACKING') {
        this.handTracker.updateXRHand(frame, referenceSpace);
      }
    } else if (this.isFallbackAR) {
      // Fallback kamera módban automatikus stabil szkennelés és elhelyezés
      if (this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT') {
        const dir = this._tempDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const dist = (this.stage === 'PLACE_CASTLE') ? 0.60 : 0.40;
        const ghostPos = this._tempVecA.copy(this.camera.position).addScaledVector(dir, dist);
        ghostPos.y = -0.18;
        this.scanner.setPositionDirect(ghostPos);

        if (this.stage === 'PLACE_CASTLE') {
          if (this.scanProgress < 1) {
            this.scanProgress = Math.min(1, this.scanProgress + dt * 1.5);
            this.scanner.setProgress(this.scanProgress);
          }
          if (this.scanProgress >= 0.4 || this.isSurfaceLocked) {
            if (!this.isSurfaceLocked) {
              this.isSurfaceLocked = true;
              this.scanner.triggerLockAnimation();
              this.updateFooterButtons('PLACE_CASTLE');
            }
            const yaw = Math.atan2(this.camera.position.x - ghostPos.x, this.camera.position.z - ghostPos.z);
            this.castle.showGhost(ghostPos, null, yaw);
            this.updateScanHUD(
              '1/2 · VÁR HELYE',
              100,
              '✅ Asztal bemérve — Kész a lerakásra!',
              'Koppints a képernyőre vagy a „Vár lerakása” gombra!',
              'locked'
            );
          } else {
            const pct = Math.round(this.scanProgress * 100);
            this.updateScanHUD(
              '1/2 · VÁR HELYE',
              pct,
              `📡 Felület bemérése folyamatban... (${pct}%)`,
              'Irányítsd az asztal felé a telefont!',
              'scanning'
            );
          }
        } else if (this.stage === 'PLACE_SLINGSHOT') {
          const distCm = Math.round(ghostPos.distanceTo(this.castleWorldPos) * 100);
          const isValid = distCm >= 18;
          this.slingshot.updateGhost(ghostPos, this.castleWorldPos, isValid);
          this.scanner.updateTether(this.castleWorldPos, ghostPos, true, isValid);

          this.updateScanHUD(
            '2/2 · CSÚZLI HELYE',
            100,
            isValid ? `✅ Csúzli helye ideális (${distCm} cm)` : `⚠️ Túl közel a várhoz (${distCm} cm)`,
            isValid ? 'Koppints a lerakáshoz vagy nyomd meg az Auto csúzlit!' : 'Célozz távolabb a vártól!',
            isValid ? 'locked' : 'warning'
          );
        }
      }
    }

    // Pásztázó és felületi animáció frissítése
    this.scanner.update(dt);
    this.slingshot.update(dt);

    // 📱 Telefonmozgás (Phone Pullback) hátrahúzás szimulációja
    if (this.controlMode === 'PHONE_MOTION' && this.isPhonePulling && this.slingshot.dirToCastle) {
      const deltaCam = this.tempCamDelta.copy(this.camera.position).sub(this.phoneAnchorCamPos);

      const pullZ = -deltaCam.dot(this.slingshot.dirToCastle) * 0.58;
      const pullX = deltaCam.dot(this.slingshot.dirRight) * 0.50;
      const pullY = deltaCam.y * 0.42;

      this.slingshot.setPull(pullX, pullY, pullZ);
    }

    // 🖐️ Kézkövetés 60 FPS LERP (kizárólag a golyót és a gumiszalagot mozgatja, 0 GPU buffer-allokáció)
    if (this.controlMode === 'HAND_TRACKING' && this.isHandAiming) {
      const lerpFactor = Math.min(1, dt * 18);
      this.currentHandPull.lerp(this.targetHandPull, lerpFactor);
      this.slingshot.setPullFast(this.currentHandPull.x, this.currentHandPull.y, this.currentHandPull.z);
    }

    // Fizikai világ és részecskék léptetése
    if (this.stage === 'BATTLE') {
      const movedBodies = this.physics.step(dt);
      this.effects.update(dt);
      this.slingshot.cleanOldProjectiles();
      if (movedBodies > 0) {
        this.requestShadowUpdate();
        if (++this.scoreThrottle % 6 === 0) {
          this.updateScore();
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateScore() {
    let movedBlocks = 0;

    for (const block of this.castle.blocks) {
      if (!block.userData.initialPos) continue;

      const dist = block.position.distanceTo(block.userData.initialPos);
      const upY = this.tempUpVector.set(0, 1, 0).applyQuaternion(block.quaternion).y;

      if (dist > 0.045 || upY < 0.75) {
        movedBlocks++;
      }
    }

    const newScore = movedBlocks * 50;
    if (newScore > this.score) {
      this.score = newScore;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        try {
          localStorage.setItem('siege.highscore', String(this.highScore));
        } catch (e) {}
      }
      this.updateScoreDisplay(true);
      this.sounds.playScore();
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release().catch(() => {});
      } catch (e) {}
      this.wakeLock = null;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new WebXRApp();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.isInGame) {
      app.requestWakeLock();
    }
  });
});

// PWA Service Worker regisztráció
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('PWA ServiceWorker aktív:', reg.scope);
    }).catch((err) => {
      console.warn('PWA ServiceWorker figyelmeztetés:', err);
    });
  });
}
