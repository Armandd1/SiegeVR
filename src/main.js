import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { CastleBuilder } from './castle.js';
import { Slingshot } from './slingshot.js';
import { ParticleSystem, SoundEffects, SurfaceScanner } from './effects.js';
import { HandTracker } from './handTracking.js';

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
    this.btnStartPhone = document.getElementById('btn-start-phone');
    this.btnStartHand = document.getElementById('btn-start-hand');
    this.menuHighscoreVal = document.getElementById('menu-highscore-val');
    this.insecureWarning = document.getElementById('insecure-context-warning');

    // Játékállapot és vezérlés
    this.isInGame = false;
    this.controlMode = 'PHONE_MOTION'; // 'PHONE_MOTION' | 'HAND_TRACKING'
    this.btnPhonePull = document.getElementById('btn-phone-pull');
    this.phoneMotionContainer = document.getElementById('phone-motion-container');
    this.handWebcam = document.getElementById('hand-webcam');
    this.handStatusBadge = document.getElementById('hand-status-badge');
    this.handStatusLabel = document.getElementById('hand-status-label');
    this.btnAutoSlingshot = document.getElementById('btn-auto-slingshot');
    this.scanningOverlay = document.getElementById('scanning-overlay');
    this.scanStatusText = document.getElementById('scan-status-text');

    this.isPhonePulling = false;
    this.phoneAnchorCamPos = new THREE.Vector3();
    this.tempUpVector = new THREE.Vector3();
    this.tempCamDelta = new THREE.Vector3();

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

    // 2. WebGLRenderer WebXR támogatással és árnyékokkal (1.75 DPR cap a lag kizárására)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    // 3. Megvilágítás és árnyékok
    this.setupLighting();

    // 4. Területfeltérképező és animált felületi szkenner (SurfaceScanner)
    this.scanner = new SurfaceScanner(this.scene);

    // 5. Árnyékfelfogó talaj AR módhoz (kompakt asztali méret: 1.6 x 1.6 m)
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.4 })
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

    // 7. Kézkövető rendszer (A szelfi kamera kizárólag a háttérben fut, sosem jelenik meg a kijelzőn!)
    this.handTracker = new HandTracker(
      () => {
        if (!this.isInGame || this.controlMode !== 'HAND_TRACKING') return;
        this.isHandAiming = true;
        this.targetHandPull.set(0, 0, 0);
        this.currentHandPull.set(0, 0, 0);
        this.slingshot.beginAim();
        this.setHint('🖐️', 'Kéz megfogva: Húzd hátra a kezed a levegőben a feszítéshez!');
      },
      (delta) => {
        if (!this.isInGame || this.controlMode !== 'HAND_TRACKING') return;
        const pullZ = (delta.z || 0) * 0.45 + (delta.y || 0) * 0.25;
        const pullX = (delta.x || 0) * 0.35;
        const pullY = -(delta.y || 0) * 0.25;
        this.targetHandPull.set(pullX, pullY, pullZ);
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
            this.handStatusLabel.innerText = status.handDetected
              ? (status.isPinching ? '✊ Csippentve' : '🖐️ Kéz követve')
              : '🔍 Keresés...';
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

    // 11. Render loop
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.render.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 0.85);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffaed, 2.0);
    this.dirLight.position.set(1.5, 3.5, 2.0);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 0.2;
    this.dirLight.shadow.camera.far = 8.0;

    const d = 1.1;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.015;

    this.scene.add(this.dirLight);
  }

  // 🚀 Játék indítása a kiválasztott móddal közvetlenül a Főoldalról
  async launchGame(mode) {
    this.sounds.init();
    this.requestWakeLock();
    this.controlMode = mode;
    this.slingshot.setControlMode(mode);
    this.isInGame = true;

    // Főoldal elrejtése, játék HUD megjelenítése
    if (this.mainMenu) this.mainMenu.classList.add('hidden');
    if (this.uiOverlay) this.uiOverlay.classList.remove('hidden');

    if (mode === 'PHONE_MOTION') {
      if (this.renderer) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      if (this.phoneMotionContainer) this.phoneMotionContainer.classList.remove('hidden');
      if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');
      this.handTracker.stop();
      this.setHint('📱', 'Telefonmozgás: Tartsd nyomva a HÚZÁS gombot, és lépj hátra a szobában!');
    } else if (mode === 'HAND_TRACKING') {
      if (this.renderer) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.4));
      if (this.phoneMotionContainer) this.phoneMotionContainer.classList.add('hidden');
      this.handTracker.start();
      this.setHint('🖐️', 'Kézkövetés: Csippents a levegőben a golyó megfogásához!');
    }

    // Kamera és AR indítása
    await this.startAR();
  }

  // 🚪 Vissza a főoldalra: bezár minden kamerát, WebXR-t és leállítja a játékmódot
  returnToMainMenu() {
    this.isInGame = false;
    this.releaseWakeLock();

    // 1. WebXR munkamenet leállítása
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

    // 5. HUD és vezérlőszervek elrejtése
    if (this.uiOverlay) this.uiOverlay.classList.add('hidden');
    if (this.phoneMotionContainer) this.phoneMotionContainer.classList.add('hidden');
    if (this.scanningOverlay) this.scanningOverlay.classList.add('hidden');
    if (this.arStepper) this.arStepper.classList.add('hidden');
    if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');

    // 6. Főoldal megjelenítése friss rekorddal
    if (this.mainMenu) {
      this.mainMenu.classList.remove('hidden');
    }
    if (this.menuHighscoreVal) {
      this.menuHighscoreVal.innerText = this.highScore;
    }
  }

  // 📷 AR / Kamera Indítása: Elsődlegesen natív WebXR, másodlagosan automatikus WebRTC kamera passthrough
  async startAR() {
    let sessionStarted = false;

    // 1. Megpróbáljuk elindítani a natív WebXR 'immersive-ar' munkamenetet
    if (navigator.xr && navigator.xr.isSessionSupported) {
      try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (supported) {
          let session = null;
          try {
            session = await navigator.xr.requestSession('immersive-ar', {
              optionalFeatures: ['hit-test', 'dom-overlay', 'hands'],
              domOverlay: { root: document.getElementById('ui-overlay') }
            });
          } catch (overlayErr) {
            console.warn('dom-overlay elutasítva, újrapróbálás anélkül:', overlayErr);
            session = await navigator.xr.requestSession('immersive-ar', {
              optionalFeatures: ['hit-test', 'hands']
            });
          }

          if (session) {
            await this.renderer.xr.setSession(session);
            sessionStarted = true;
          }
        }
      } catch (xrErr) {
        console.warn('WebXR AR sikertelen, fallback kamerára váltás:', xrErr);
      }
    }

    // 2. Ha a telefon vagy a böngésző nem támogatja a natív WebXR-t, a valódi hátlapi kamerát nyitjuk meg
    if (!sessionStarted) {
      try {
        await this.startFallbackCamera();
        sessionStarted = true;
      } catch (camErr) {
        console.error('Kamera megnyitási hiba:', camErr);
        alert('Nem sikerült megnyitni a kamerát. Ellenőrizd a kamera-engedélyeket és használd a HTTPS kapcsolatot!');
        this.returnToMainMenu();
        return;
      }
    }

    if (this.arStepper) this.arStepper.classList.remove('hidden');
    this.startPlacement(1);
  }

  // 📹 WebRTC Háttér Kamera Passthrough (ha a natív WebXR nem érhető el a telefonon)
  async startFallbackCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('A böngésző nem támogatja a kamerát');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    this.fallbackCameraStream = stream;

    let video = document.getElementById('ar-camera-feed');
    if (!video) {
      video = document.createElement('video');
      video.id = 'ar-camera-feed';
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.muted = true;
      document.body.prepend(video);
    }

    video.srcObject = stream;
    await video.play();
    this.fallbackVideo = video;
    this.isFallbackAR = true;
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
        this.fallbackVideo.remove();
      } catch (e) {}
      this.fallbackVideo = null;
    }

    this.isFallbackAR = false;
  }

  // Interaktív lehelyezési folyamat indítása
  startPlacement(step) {
    if (step === 1) {
      this.stage = 'PLACE_CASTLE';
      this.updateStepper(1);
      this.castle.clear();
      this.slingshot.group.visible = false;
      this.slingshot.hideGhost();
      this.shadowPlane.visible = false;
      this.scanner.show();
      if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.add('hidden');

      if (this.scanningOverlay) this.scanningOverlay.classList.remove('hidden');
      if (this.scanStatusText) {
        this.scanStatusText.innerText = '📡 1. Lépés: Pásztázd a terepet a VÁR lerakásához!';
        this.scanStatusText.parentElement?.classList.remove('locked');
      }

      const initialPos = this.scanner.getPosition();
      const yaw = Math.atan2(this.camera.position.x - initialPos.x, this.camera.position.z - initialPos.z);
      this.castle.showGhost(initialPos, null, yaw);
      this.setHint('🏰', '1. Lépés: KOPPINTS a kívánt helyre a VÁR felépítéséhez!');
    } else if (step === 2) {
      this.stage = 'PLACE_SLINGSHOT';
      this.updateStepper(2);
      this.castle.hideGhost();
      this.scanner.show();
      if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.remove('hidden');

      if (this.scanningOverlay) this.scanningOverlay.classList.remove('hidden');
      if (this.scanStatusText) {
        this.scanStatusText.innerText = '🎯 2. Lépés: Pásztázd a terepet a CSÚZLI lerakásához!';
        this.scanStatusText.parentElement?.classList.remove('locked');
      }

      const initialPos = this.scanner.getPosition();
      const isValid = initialPos.distanceTo(this.castleWorldPos) >= 0.11;
      this.slingshot.showGhost(initialPos, this.castleWorldPos);
      this.slingshot.updateGhost(initialPos, this.castleWorldPos, isValid);
      this.setHint('🎯', '2. Lépés: KOPPINTS a CSÚZLI helyére, vagy nyomd meg az Auto csúzli gombot!');
    }
  }

  confirmCastlePlacement(pos) {
    this.castleWorldPos.copy(pos);
    this.shadowPlane.position.copy(this.castleWorldPos);
    this.shadowPlane.visible = true;
    this.effects.groundY = pos.y;

    const yaw = Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
    this.castle.buildCastleAt(this.castleWorldPos, null, yaw);
    this.effects.createPlacementBurst(this.castleWorldPos, 22);
    this.sounds.playBuild();

    if (this.dirLight) {
      this.dirLight.target.position.copy(this.castleWorldPos);
      this.dirLight.target.updateMatrixWorld();
    }

    this.startPlacement(2);
  }

  confirmSlingshotPlacement(pos) {
    if (pos.distanceTo(this.castleWorldPos) < 0.11) {
      this.setHint('⚠️', 'Túl közel van a várhoz! Helyezd el távolabb a csúzlit.');
      this.sounds.triggerHaptic(20);
      return;
    }

    this.slingshotWorldPos.copy(pos);
    this.slingshot.placeAt(pos, this.castleWorldPos);
    this.slingshot.generousGrab = true;
    this.effects.createPlacementBurst(pos, 16);
    this.sounds.playBuild();

    this.scanner.stop();
    this.slingshot.hideGhost();
    if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.add('hidden');
    if (this.scanningOverlay) this.scanningOverlay.classList.add('hidden');

    this.stage = 'BATTLE';
    this.updateStepper(3);
    this.setHint('🏹', 'Harcra kész! Húzd hátra a golyót a célzáshoz.');
  }

  autoPlaceSlingshot() {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.castleWorldPos).setY(0).normalize();
    if (dir.lengthSq() < 0.01) {
      dir.set(0, 0, 1);
    }
    const autoPos = this.castleWorldPos.clone().addScaledVector(dir, 0.32);
    autoPos.y = this.castleWorldPos.y;

    this.confirmSlingshotPlacement(autoPos);
  }

  onSelect() {
    if (!this.isInGame) return;

    if (this.stage === 'PLACE_CASTLE') {
      const pos = (this.scanner.hasPose || this.scanner.active)
        ? this.scanner.getPosition()
        : this.camera.position.clone().add(new THREE.Vector3(0, -0.15, -0.55).applyQuaternion(this.camera.quaternion));
      this.confirmCastlePlacement(pos);
      return;
    }

    if (this.stage === 'PLACE_SLINGSHOT') {
      const pos = (this.scanner.hasPose || this.scanner.active)
        ? this.scanner.getPosition()
        : this.castleWorldPos.clone().add(new THREE.Vector3(0, 0, 0.32));
      this.confirmSlingshotPlacement(pos);
    }
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnCycle = document.getElementById('btn-cycle-castle');
    const btnReposition = document.getElementById('btn-reposition');

    // 🏠 Főoldali Indító Gombok (Telefon & Kéz)
    this.btnStartPhone?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchGame('PHONE_MOTION');
    });

    this.btnStartHand?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchGame('HAND_TRACKING');
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
      this.setHint('🔄', 'A vár újraépült! Célzásra kész.');
    });

    // Vár típusának váltása
    btnCycle?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      if (this.stage === 'PLACE_CASTLE') {
        const layouts = ['fortress', 'pyramid', 'twin_towers', 'citadel'];
        const currIdx = layouts.indexOf(this.castle.currentLayout || 'fortress');
        this.castle.currentLayout = layouts[(currIdx + 1) % layouts.length];
        const initialPos = this.scanner.getPosition();
        const yaw = Math.atan2(this.camera.position.x - initialPos.x, this.camera.position.z - initialPos.z);
        this.castle.showGhost(initialPos, this.castle.currentLayout, yaw);
        this.sounds.playBuild();
      } else {
        this.castle.cycleNextLayout(this.castleWorldPos);
        this.score = 0;
        this.updateScoreDisplay();
        this.sounds.playBuild();
        this.effects.clear();
        this.setHint('🎲', `Új vártípus: ${this.castle.getLayoutTitle()}!`);
      }
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
      this.setHint('📱', 'Tartsd nyomva, és lépj hátra a telefonnal a célzáshoz!');
    };

    const endPhoneGrab = (e) => {
      if (!this.isInGame || this.controlMode !== 'PHONE_MOTION' || !this.isPhonePulling) return;
      this.isPhonePulling = false;
      this.btnPhonePull?.classList.remove('grabbing');
      const launched = this.slingshot.endAim(true);
      if (!launched) {
        this.setHint('🏹', 'Lépj hátrébb a telefonnal a kilövéshez!');
      }
    };

    this.btnPhonePull?.addEventListener('mousedown', startPhoneGrab);
    window.addEventListener('mouseup', endPhoneGrab);
    this.btnPhonePull?.addEventListener('touchstart', startPhoneGrab, { passive: false });
    window.addEventListener('touchend', endPhoneGrab);

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

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Amikor a főoldalon vagyunk, nem terheljük a gépet
    if (!this.isInGame) {
      this.renderer.render(this.scene, this.camera);
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

      if (!this.hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((refSpace) => {
          session.requestHitTestSource({ space: refSpace }).then((source) => {
            this.hitTestSource = source;
          });
        });

        session.addEventListener('end', () => {
          this.returnToMainMenu();
        });

        this.hitTestSourceRequested = true;
      }

      // WebXR AR Felületkeresés (Hit-Testing)
      if (this.hitTestSource && (this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT')) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);
          if (pose && pose.transform) {
            const m = pose.transform.matrix;
            const upY = m[5];
            const isHorizontal = upY > 0.4 || Math.abs(m[10]) > 0.4;

            this.scanner.setPose(m, isHorizontal);
            const scanPos = this.scanner.getPosition();

            if (this.scanStatusText) {
              this.scanStatusText.parentElement?.classList.toggle('locked', isHorizontal);
            }

            if (this.stage === 'PLACE_CASTLE') {
              const yaw = Math.atan2(this.camera.position.x - scanPos.x, this.camera.position.z - scanPos.z);
              this.castle.updateGhostPosition(scanPos, yaw);
              this.setHint('🏰', isHorizontal ? 'Asztal érzékelve! KOPPINTS a VÁR lerakásához!' : '⚠️ Irányítsd vízszintes felületre!');
              if (this.scanStatusText) {
                this.scanStatusText.innerText = isHorizontal ? '✨ Felület rögzítve! KOPPINTS a VÁR lerakásához.' : '⚠️ Vízszintes felület szükséges!';
              }
            } else if (this.stage === 'PLACE_SLINGSHOT') {
              const isValid = scanPos.distanceTo(this.castleWorldPos) >= 0.11;
              this.slingshot.updateGhost(scanPos, this.castleWorldPos, isValid);
              if (!isValid) {
                this.setHint('⚠️', 'Túl közel a várhoz! Lépj hátrébb az asztal mellett.');
                if (this.scanStatusText) this.scanStatusText.innerText = '⚠️ Túl közel a várhoz! Helyezd el távolabb.';
              } else {
                this.setHint('🎯', isHorizontal ? 'KOPPINTS a CSÚZLI lerakásához, vagy használd az Auto gombot!' : '⚠️ Irányítsd vízszintes felületre!');
                if (this.scanStatusText) {
                  this.scanStatusText.innerText = isHorizontal ? '✨ Pozíció ideális! KOPPINTS vagy használd az Auto gombot.' : '⚠️ Vízszintes felület szükséges!';
                }
              }
            }
          }
        } else {
          this.scanner.hide();
          this.setHint('🔍', 'Pásztázd a telefonnal az asztal felületét...');
          if (this.scanStatusText) {
            this.scanStatusText.parentElement?.classList.remove('locked');
            this.scanStatusText.innerText = '📡 Terep pásztázása folyamatban... Mozgasd a telefont!';
          }
        }
      }

      // WebXR Hand Tracking frissítése
      if (this.controlMode === 'HAND_TRACKING') {
        this.handTracker.updateXRHand(frame, referenceSpace);
      }
    } else if (this.isFallbackAR) {
      // Fallback kamera módban frissítjük az alap pozíciókat
      if (this.stage === 'PLACE_CASTLE' && this.castle.ghostGroup) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const ghostPos = this.camera.position.clone().addScaledVector(dir, 0.48);
        ghostPos.y = -0.12;
        this.castle.updateGhostPosition(ghostPos, 0);
      } else if (this.stage === 'PLACE_SLINGSHOT' && this.slingshot.ghostGroup) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const ghostPos = this.camera.position.clone().addScaledVector(dir, 0.24);
        ghostPos.y = -0.12;
        this.slingshot.updateGhost(ghostPos, this.castleWorldPos, true);
      }
    }

    // Pásztázó és felületi animáció frissítése
    this.scanner.update(dt);
    this.slingshot.update(dt);

    // 📱 Telefonmozgás (Phone Pullback) hátrahúzás szimulációja
    if (this.controlMode === 'PHONE_MOTION' && this.isPhonePulling && this.slingshot.dirToCastle) {
      const deltaCam = this.tempCamDelta.copy(this.camera.position).sub(this.phoneAnchorCamPos);

      const pullZ = -deltaCam.dot(this.slingshot.dirToCastle) * 0.85;
      const pullX = deltaCam.dot(this.slingshot.dirRight) * 0.85;
      const pullY = deltaCam.y * 0.65;

      this.slingshot.setPull(pullX, pullY, pullZ);
    }

    // 🖐️ Kézkövetés finom, akadozásmentes 60 FPS húzás-interpoláció (Lerp)
    if (this.controlMode === 'HAND_TRACKING' && this.isHandAiming) {
      const lerpFactor = Math.min(1, dt * 22);
      this.currentHandPull.lerp(this.targetHandPull, lerpFactor);
      this.slingshot.setPull(this.currentHandPull.x, this.currentHandPull.y, this.currentHandPull.z);
    }

    // Fizikai világ és részecskék léptetése
    if (this.stage === 'BATTLE') {
      this.physics.step(dt);
      this.effects.update(dt);
      this.slingshot.cleanOldProjectiles();
      if (++this.scoreThrottle % 4 === 0) {
        this.updateScore();
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

      if (dist > 0.03 || upY < 0.72) {
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
