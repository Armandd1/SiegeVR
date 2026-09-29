import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { PhysicsWorld } from './physics.js';
import { CastleBuilder } from './castle.js';
import { Slingshot } from './slingshot.js';
import { ParticleSystem, SoundEffects } from './effects.js';
import { HandTracker } from './handTracking.js';

class WebXRApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.hintIcon = document.getElementById('hint-icon');
    this.hintText = document.getElementById('hint-text');
    this.scoreDisplay = document.getElementById('score-display');
    this.castleTypeBadge = document.getElementById('castle-type-badge');
    this.arStepper = document.getElementById('ar-stepper');
    this.step1 = document.getElementById('step-1');
    this.step2 = document.getElementById('step-2');
    this.step3 = document.getElementById('step-3');
    this.touchAimHelper = document.getElementById('touch-aim-helper');
    this.soundIcon = document.getElementById('sound-icon');
    this.helpModal = document.getElementById('help-modal');

    // Vezérlési mód elemek
    this.controlMode = 'TOUCH'; // 'TOUCH' | 'PHONE_MOTION' | 'HAND_TRACKING'
    this.currentModeIcon = document.getElementById('current-mode-icon');
    this.currentModeLabel = document.getElementById('current-mode-label');
    this.modeModal = document.getElementById('mode-modal');
    this.btnPhonePull = document.getElementById('btn-phone-pull');
    this.phoneMotionContainer = document.getElementById('phone-motion-container');
    this.handPipContainer = document.getElementById('hand-pip-container');
    this.handWebcam = document.getElementById('hand-webcam');
    this.handPipCanvas = document.getElementById('hand-pip-canvas');

    this.isPhonePulling = false;
    this.phoneAnchorCamPos = new THREE.Vector3();
    this.tempUpVector = new THREE.Vector3();
    this.tempCamDelta = new THREE.Vector3();

    this.score = 0;

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Állapotgép: 'DESKTOP_BATTLE' (ha nincs AR) | AR esetén: 'WAITING_AR' -> 'PLACE_CASTLE' -> 'PLACE_SLINGSHOT' -> 'BATTLE'
    this.isXRActive = false;
    this.stage = 'DESKTOP_BATTLE';
    this.castleWorldPos = new THREE.Vector3(0, 0, -0.38);
    this.slingshotWorldPos = new THREE.Vector3(0, 0, 0.38);

    this.init();
  }

  setHint(icon, text) {
    if (this.hintIcon) this.hintIcon.innerText = icon;
    if (this.hintText) this.hintText.innerText = text;
  }

  setControlMode(mode) {
    this.controlMode = mode;
    if (this.slingshot) {
      this.slingshot.setControlMode(mode);
    }

    // Fejléc gomb feliratának és ikonjának frissítése
    if (this.currentModeIcon && this.currentModeLabel) {
      if (mode === 'TOUCH') {
        this.currentModeIcon.innerText = '👆';
        this.currentModeLabel.innerText = 'Érintés';
      } else if (mode === 'PHONE_MOTION') {
        this.currentModeIcon.innerText = '📱';
        this.currentModeLabel.innerText = 'Telefon';
      } else if (mode === 'HAND_TRACKING') {
        this.currentModeIcon.innerText = '🖐️';
        this.currentModeLabel.innerText = 'Kéz';
      }
    }

    // Modális kártyák aktív állapotának frissítése
    const cards = document.querySelectorAll('.mode-card');
    cards.forEach(c => {
      c.classList.toggle('active', c.dataset.mode === mode);
    });

    // Mód-specifikus gombok és előnézetek
    if (this.phoneMotionContainer) {
      this.phoneMotionContainer.classList.toggle('hidden', mode !== 'PHONE_MOTION');
    }

    if (mode === 'HAND_TRACKING') {
      if (this.handPipContainer) this.handPipContainer.classList.remove('hidden');
      this.handTracker.start();
    } else {
      if (this.handPipContainer) this.handPipContainer.classList.add('hidden');
      this.handTracker.stop();
    }

    // Tájékoztató üzenet a játékosnak
    if (mode === 'TOUCH') {
      this.setHint('👆', 'Érintőképernyős célzás aktív: Húzd hátra a golyót az ujjaddal!');
    } else if (mode === 'PHONE_MOTION') {
      this.setHint('📱', 'Telefonmozgás aktív: Tartsd nyomva a gombot, és lépj hátra a szobában!');
    } else if (mode === 'HAND_TRACKING') {
      this.setHint('🖐️', 'Kézkövetés aktív: Csippents a mutató- és hüvelykujjaddal a levegőben!');
    }
  }

  updateStepper(step) {
    if (this.step1) this.step1.classList.toggle('active', step === 1);
    if (this.step2) this.step2.classList.toggle('active', step === 2);
    if (this.step3) this.step3.classList.toggle('active', step === 3);
  }

  updateCastleBadge() {
    if (this.castleTypeBadge && this.castle) {
      this.castleTypeBadge.innerText = this.castle.getLayoutTitle();
    }
  }

  init() {
    // 1. Háttér, Színtér és Kamera (jobb rálátás a nagyobb vármérethez)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0, 0.46, 0.88);
    this.camera.lookAt(0, 0.12, 0);

    // 2. WebGLRenderer WebXR támogatással és sima árnyékokkal
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    // 3. WebXR AR Gomb
    const arBtn = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'hands'],
      domOverlay: { root: document.getElementById('ui-overlay') }
    });
    document.body.appendChild(arBtn);

    // 4. Megvilágítás és kristálytiszta árnyékok
    this.setupLighting();

    // 5. Célzó karika (Reticle) AR felületkereséshez (nagyobb átmérő a kényelmesebb asztali pozicionáláshoz)
    const reticleGeo = new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    this.reticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // 6. Árnyékfelfogó talaj AR módhoz
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.4 })
    );
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.position.y = -0.001;
    this.scene.add(this.shadowPlane);

    // 7. Virtuális Asztali Környezet (Asztali / Előnézeti Módhoz)
    this.setupDesktopEnvironment();

    // 8. Fő játékmotor rendszerek inicializálása
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
      (impactPt) => {
        this.effects.createImpact(impactPt, 22);
        this.sounds.playImpact();
      },
      () => this.sounds.playTension(),
      (powerPercent, targetName, wasCanceled) => {
        if (wasCanceled) {
          this.setHint('🏹', 'Lövés visszavonva. Húzd hátra a golyót a célzáshoz!');
        } else {
          const targetTxt = targetName ? `🎯 Cél: ${targetName}` : '🎯 Célzás';
          this.setHint('🏹', `${targetTxt} (${powerPercent}% erő) — Engedd el a kilövéshez!`);
        }
      }
    );
    this.slingshot.setCastle(this.castle);

    // Kézkövető rendszer inicializálása
    this.handTracker = new HandTracker(
      (pos) => {
        if (this.controlMode !== 'HAND_TRACKING') return;
        this.slingshot.trajectoryLine.visible = true;
        this.slingshot.hitMarkerGroup.visible = true;
        this.sounds.playTension();
        this.setHint('🖐️', 'Kéz megfogva: Húzd hátra a kezed a levegőben a feszítéshez!');
      },
      (delta) => {
        if (this.controlMode !== 'HAND_TRACKING') return;
        const pullZ = Math.max(0.01, Math.min(0.25, (delta.z || 0) * 0.45 + (delta.y || 0) * 0.25));
        const pullX = Math.max(-0.16, Math.min(0.16, (delta.x || 0) * 0.35));
        const pullY = Math.max(-0.10, Math.min(0.10, -(delta.y || 0) * 0.25));

        this.slingshot.aimBall.position.set(
          this.slingshot.restLocalPos.x + pullX,
          this.slingshot.restLocalPos.y + pullY,
          this.slingshot.restLocalPos.z + pullZ
        );
        this.slingshot.update3DBands();
        this.slingshot.updateTrajectory(pullX, pullY, pullZ);
      },
      (wasFired) => {
        if (this.controlMode !== 'HAND_TRACKING') return;
        this.slingshot.trajectoryLine.visible = false;
        this.slingshot.hitMarkerGroup.visible = false;

        const localPull = this.slingshot.aimBall.position.clone().sub(this.slingshot.restLocalPos);
        if (wasFired && localPull.z > 0.035) {
          this.slingshot.launch(localPull);
        }

        this.slingshot.aimBall.position.copy(this.slingshot.restLocalPos);
        this.slingshot.update3DBands();
      }
    );
    this.handTracker.initDOM(this.handWebcam, this.handPipCanvas);

    // 9. WebXR Controller érintésekhez
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.scene.add(this.controller);

    // 10. UI események
    this.initUI();

    // 11. Alapértelmezett asztali felépítés (így azonnal játszható AR nélkül is!)
    this.setupDesktopGame();

    // 12. Render loop
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.render.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  setupLighting() {
    // Kellemes természetes környezeti fény
    const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 0.85);
    this.scene.add(hemiLight);

    // Irányított napfény precíz árnyékkamerával
    this.dirLight = new THREE.DirectionalLight(0xfffaed, 2.0);
    this.dirLight.position.set(1.5, 3.5, 2.0);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.2;
    this.dirLight.shadow.camera.far = 8.0;

    // Pontos fókusz a játéktérre (megszünteti a pixeles, homályos árnyékokat)
    const d = 1.3;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.015;

    this.scene.add(this.dirLight);
  }

  setupDesktopEnvironment() {
    this.desktopGroup = new THREE.Group();

    // Stílusos virtuális fa asztallap a 3D asztali élményhez (nagyobb felület)
    const tableGeo = new THREE.BoxGeometry(2.0, 0.04, 1.6);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x2e1b10,
      roughness: 0.6,
      metalness: 0.1
    });
    const tableMesh = new THREE.Mesh(tableGeo, tableMat);
    tableMesh.position.set(0, -0.02, 0);
    tableMesh.receiveShadow = true;
    this.desktopGroup.add(tableMesh);

    // Finom rács a játéktéren
    const grid = new THREE.GridHelper(1.6, 16, 0x6366f1, 0x334155);
    grid.position.y = 0.001;
    this.desktopGroup.add(grid);

    this.scene.add(this.desktopGroup);
  }

  setupDesktopGame() {
    // Felépítjük a várat a virtuális asztalon
    this.castle.buildCastleAt(this.castleWorldPos);
    this.slingshot.placeAt(this.slingshotWorldPos, this.castleWorldPos);
    this.updateCastleBadge();

    if (this.dirLight) {
      this.dirLight.target.position.copy(this.castleWorldPos);
      this.dirLight.target.updateMatrixWorld();
    }

    this.stage = 'DESKTOP_BATTLE';
    if (this.arStepper) this.arStepper.classList.add('hidden');
    this.setHint('🏹', 'Húzd hátra a csúzli golyóját az egérrel vagy érintéssel a célzáshoz!');
  }

  onSelect() {
    // 1. LÉPÉS AR-BEN: VÁR LEHELYEZÉSE
    if (this.stage === 'PLACE_CASTLE' && this.reticle.visible) {
      this.castleWorldPos.setFromMatrixPosition(this.reticle.matrix);

      this.shadowPlane.position.copy(this.castleWorldPos);
      this.shadowPlane.visible = true;

      // Vár felépítése az érzékelt ponton
      this.castle.buildCastleAt(this.castleWorldPos);
      this.updateCastleBadge();
      this.sounds.playImpact();

      if (this.dirLight) {
        this.dirLight.target.position.copy(this.castleWorldPos);
        this.dirLight.target.updateMatrixWorld();
      }

      this.stage = 'PLACE_SLINGSHOT';
      this.updateStepper(2);
      this.setHint('🎯', '2. Lépés: Lépj hátra 1-2 lépést, és KOPPINTS a CSÚZLI lerakásához!');
      return;
    }

    // 2. LÉPÉS AR-BEN: CSÚZLI LEHELYEZÉSE
    if (this.stage === 'PLACE_SLINGSHOT' && this.reticle.visible) {
      const slingshotPos = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);

      this.slingshot.placeAt(slingshotPos, this.castleWorldPos);
      this.sounds.playImpact();

      this.reticle.visible = false;
      this.stage = 'BATTLE';
      this.updateStepper(3);
      this.setHint('🏹', '3. Lépés: Húzd hátra a golyót az ujjaddal a képernyőn a lövéshez!');
      if (this.touchAimHelper) this.touchAimHelper.classList.remove('hidden');
    }
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnCycle = document.getElementById('btn-cycle-castle');
    const btnReposition = document.getElementById('btn-reposition');
    const btnSound = document.getElementById('btn-sound');
    const btnHelp = document.getElementById('btn-help');
    const btnCloseHelp = document.getElementById('btn-close-help');
    const btnDismissHelp = document.getElementById('btn-dismiss-help');

    // Első felhasználói interakcióra feloldjuk az audió kontextust (iOS / mobil böngésző védelem)
    const unlockAudio = () => {
      this.sounds.init();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    // Vár újraépítése
    btnReset?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      this.castle.buildCastleAt(this.castleWorldPos);
      this.score = 0;
      this.scoreDisplay.innerText = this.score;
      this.sounds.playImpact();
      this.effects.clear();
      this.setHint('🔄', 'A vár újraépült! Célzásra kész.');
    });

    // Vár típusának váltása (Királyi Erőd -> Piramis -> Tornyok -> Citadella)
    btnCycle?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      this.castle.cycleNextLayout(this.castleWorldPos);
      this.updateCastleBadge();
      this.score = 0;
      this.scoreDisplay.innerText = this.score;
      this.sounds.playImpact();
      this.effects.clear();
      this.setHint('🎲', `Új vártípus felépítve: ${this.castle.getLayoutTitle()}!`);
    });

    // Újrapozicionálás
    btnReposition?.addEventListener('click', () => {
      this.slingshot.clearAllProjectiles();
      if (this.isXRActive) {
        this.stage = 'PLACE_CASTLE';
        this.updateStepper(1);
        this.castle.clear();
        this.slingshot.group.visible = false;
        this.shadowPlane.visible = false;
        this.reticle.visible = true;
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.setHint('🔍', '1. Lépés: Pásztázd az asztalt, és KOPPINTS az új helyre!');
      } else {
        this.setupDesktopGame();
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.sounds.playImpact();
        this.effects.clear();
      }
    });

    // Hang némítás kapcsoló
    btnSound?.addEventListener('click', () => {
      const isMuted = this.sounds.toggleMute();
      if (this.soundIcon) {
        this.soundIcon.innerText = isMuted ? '🔇' : '🔊';
      }
    });

    // Súgó modális ablak kezelése
    const openHelp = () => {
      if (this.helpModal) this.helpModal.classList.remove('hidden');
    };
    const closeHelp = () => {
      if (this.helpModal) this.helpModal.classList.add('hidden');
    };

    btnHelp?.addEventListener('click', openHelp);
    btnCloseHelp?.addEventListener('click', closeHelp);
    btnDismissHelp?.addEventListener('click', closeHelp);
    this.helpModal?.addEventListener('click', (e) => {
      if (e.target === this.helpModal) closeHelp();
    });

    // Módválasztó modális ablak kezelése
    const btnModeSelect = document.getElementById('btn-mode-select');
    const btnCloseMode = document.getElementById('btn-close-mode');
    const openModeModal = () => {
      if (this.modeModal) this.modeModal.classList.remove('hidden');
    };
    const closeModeModal = () => {
      if (this.modeModal) this.modeModal.classList.add('hidden');
    };

    btnModeSelect?.addEventListener('click', openModeModal);
    btnCloseMode?.addEventListener('click', closeModeModal);
    this.modeModal?.addEventListener('click', (e) => {
      if (e.target === this.modeModal) closeModeModal();
    });

    const modeCards = document.querySelectorAll('.mode-card');
    modeCards.forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        if (mode) {
          this.setControlMode(mode);
          closeModeModal();
        }
      });
    });

    // 📱 Telefonmozgás (Phone Pullback) gomb eseményei
    const startPhoneGrab = (e) => {
      if (this.controlMode !== 'PHONE_MOTION') return;
      e.preventDefault();
      this.isPhonePulling = true;
      this.phoneAnchorCamPos.copy(this.camera.position);
      this.slingshot.trajectoryLine.visible = true;
      this.slingshot.hitMarkerGroup.visible = true;
      this.btnPhonePull?.classList.add('grabbing');
      this.sounds.playTension();
      this.setHint('📱', 'Tartsd nyomva, és lépj hátra a telefonnal a célzáshoz!');
    };

    const endPhoneGrab = (e) => {
      if (this.controlMode !== 'PHONE_MOTION' || !this.isPhonePulling) return;
      this.isPhonePulling = false;
      this.btnPhonePull?.classList.remove('grabbing');
      this.slingshot.trajectoryLine.visible = false;
      this.slingshot.hitMarkerGroup.visible = false;

      const localPull = this.slingshot.aimBall.position.clone().sub(this.slingshot.restLocalPos);
      if (localPull.z > 0.032) {
        this.slingshot.launch(localPull);
      } else {
        this.setHint('🏹', 'Lépj hátrébb a telefonnal a kilövéshez!');
      }

      this.slingshot.aimBall.position.copy(this.slingshot.restLocalPos);
      this.slingshot.update3DBands();
    };

    this.btnPhonePull?.addEventListener('mousedown', startPhoneGrab);
    window.addEventListener('mouseup', endPhoneGrab);
    this.btnPhonePull?.addEventListener('touchstart', startPhoneGrab, { passive: false });
    window.addEventListener('touchend', endPhoneGrab);

    // Célzássegéd elrejtése az első érintésre
    const hideTouchAim = () => {
      if (this.touchAimHelper) this.touchAimHelper.classList.add('hidden');
    };
    window.addEventListener('touchstart', hideTouchAim, { passive: true });
    window.addEventListener('mousedown', hideTouchAim);
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

    if (frame) {
      const session = this.renderer.xr.getSession();
      const referenceSpace = this.renderer.xr.getReferenceSpace();

      if (!this.isXRActive) {
        this.isXRActive = true;
        document.body.classList.add('xr-active');
        // AR módban elrejtjük a virtuális fa asztalt, mert a valós asztalra vetítünk
        this.desktopGroup.visible = false;
        if (this.arStepper) this.arStepper.classList.remove('hidden');
        this.updateStepper(1);
      }

      if (!this.hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((refSpace) => {
          session.requestHitTestSource({ space: refSpace }).then((source) => {
            this.hitTestSource = source;
          });
        });

        session.addEventListener('end', () => {
          this.hitTestSourceRequested = false;
          this.hitTestSource = null;
          this.isXRActive = false;
          document.body.classList.remove('xr-active');
          if (this.arStepper) this.arStepper.classList.add('hidden');
          this.desktopGroup.visible = true;
          this.setupDesktopGame();
        });

        this.hitTestSourceRequested = true;
        this.stage = 'PLACE_CASTLE';
        this.updateStepper(1);
      }

      // Felületkeresés (Hit-Testing)
      if (this.hitTestSource && (this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT')) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);

          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);

          if (this.stage === 'PLACE_CASTLE') {
            this.setHint('🏰', 'Asztal érzékelve! KOPPINTS a VÁR lerakásához!');
          } else if (this.stage === 'PLACE_SLINGSHOT') {
            this.setHint('🎯', 'Lépj kicsit hátrébb és KOPPINTS a CSÚZLI lerakásához!');
          }
        } else {
          this.reticle.visible = false;
          this.setHint('🔍', 'Pásztázd a telefonnal az asztal felületét...');
        }
      }

      // WebXR Hand Tracking frissítése
      if (this.controlMode === 'HAND_TRACKING') {
        this.handTracker.updateXRHand(frame, referenceSpace);
      }
    }

    // 📱 Telefonmozgás (Phone Pullback) hátrahúzás szimulációja
    if (this.controlMode === 'PHONE_MOTION' && this.isPhonePulling && this.slingshot.dirToCastle) {
      const deltaCam = this.tempCamDelta.copy(this.camera.position).sub(this.phoneAnchorCamPos);

      // A csúzlitól a vár felé mutató vektor ellentéte a hátrahúzás
      const pullZ = Math.max(0.01, Math.min(0.25, -deltaCam.dot(this.slingshot.dirToCastle) * 0.85));
      const pullX = Math.max(-0.16, Math.min(0.16, deltaCam.dot(this.slingshot.dirRight) * 0.85));
      const pullY = Math.max(-0.10, Math.min(0.10, deltaCam.y * 0.65));

      this.slingshot.aimBall.position.set(
        this.slingshot.restLocalPos.x + pullX,
        this.slingshot.restLocalPos.y + pullY,
        this.slingshot.restLocalPos.z + pullZ
      );
      this.slingshot.update3DBands();
      this.slingshot.updateTrajectory(pullX, pullY, pullZ);
    }

    // Fizikai világ és részecskék léptetése mindkét játékmódban
    if (this.stage === 'BATTLE' || this.stage === 'DESKTOP_BATTLE') {
      this.physics.step(dt);
      this.effects.update(dt);
      this.slingshot.cleanOldProjectiles();
      this.updateScore();
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateScore() {
    let movedBlocks = 0;

    for (const block of this.castle.blocks) {
      if (!block.userData.initialPos) continue;

      // 1. Kő elmozdulása a kezdeti beépített helyéhez képest (több mint 3 cm)
      const dist = block.position.distanceTo(block.userData.initialPos);
      
      // 2. Felborulás vizsgálata (ha a kő elbillent vagy az oldalára borult - nulla memóriafoglalással)
      const upY = this.tempUpVector.set(0, 1, 0).applyQuaternion(block.quaternion).y;

      if (dist > 0.03 || upY < 0.72) {
        movedBlocks++;
      }
    }

    const newScore = movedBlocks * 50;
    if (newScore > this.score) {
      this.score = newScore;
      this.scoreDisplay.innerText = this.score;

      // Dinamikus animáció a pontszám kijelzőn
      this.scoreDisplay.classList.remove('score-bump');
      void this.scoreDisplay.offsetWidth; // force reflow
      this.scoreDisplay.classList.add('score-bump');

      this.sounds.playScore();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new WebXRApp();
});
