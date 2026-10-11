import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
    this.castleTypeBadge = document.getElementById('castle-type-badge');
    this.arStepper = document.getElementById('ar-stepper');
    this.step1 = document.getElementById('step-1');
    this.step2 = document.getElementById('step-2');
    this.step3 = document.getElementById('step-3');
    this.soundIcon = document.getElementById('sound-icon');
    this.helpModal = document.getElementById('help-modal');

    // Vezérlési mód elemek
    this.controlMode = 'TOUCH'; // 'TOUCH' | 'PHONE_MOTION' | 'HAND_TRACKING'
    this.currentModeIcon = document.getElementById('current-mode-icon');
    this.currentModeLabel = document.getElementById('current-mode-label');
    this.modeModal = document.getElementById('mode-modal');
    this.btnPhonePull = document.getElementById('btn-phone-pull');
    this.phoneMotionContainer = document.getElementById('phone-motion-container');
    this.handWebcam = document.getElementById('hand-webcam');
    this.handStatusBadge = document.getElementById('hand-status-badge');
    this.handStatusLabel = document.getElementById('hand-status-label');
    this.btnAutoSlingshot = document.getElementById('btn-auto-slingshot');

    this.isPhonePulling = false;
    this.phoneAnchorCamPos = new THREE.Vector3();
    this.tempUpVector = new THREE.Vector3();
    this.tempCamDelta = new THREE.Vector3();

    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('siege.highscore') || '0', 10);

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Állapotgép: 'DESKTOP_BATTLE' | AR esetén: 'WAITING_AR' -> 'PLACE_CASTLE' -> 'PLACE_SLINGSHOT' -> 'BATTLE'
    this.isXRActive = false;
    this.stage = 'DESKTOP_BATTLE';
    this.castleWorldPos = new THREE.Vector3(0, 0, -0.38);
    this.slingshotWorldPos = new THREE.Vector3(0, 0, 0.38);

    this.desktopRaycaster = new THREE.Raycaster();
    this.desktopMouse = new THREE.Vector2();

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

    // Mód-specifikus kezelőszervek
    if (this.phoneMotionContainer) {
      this.phoneMotionContainer.classList.toggle('hidden', mode !== 'PHONE_MOTION');
    }

    if (mode === 'HAND_TRACKING') {
      this.handTracker.start();
    } else {
      if (this.handStatusBadge) this.handStatusBadge.classList.add('hidden');
      this.handTracker.stop();
    }

    // Tájékoztató üzenet
    if (mode === 'TOUCH') {
      this.setHint('👆', 'Érintőképernyős célzás: Húzd hátra a golyót az ujjaddal!');
    } else if (mode === 'PHONE_MOTION') {
      this.setHint('📱', 'Telefonmozgás: Tartsd nyomva a HÚZÁS gombot, és lépj hátra a szobában!');
    } else if (mode === 'HAND_TRACKING') {
      this.setHint('🖐️', 'Kézkövetés: Csippents a levegőben a golyó megfogásához!');
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
    // 1. Háttér, Színtér és Kamera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0, 0.46, 0.88);
    this.camera.lookAt(0, 0.12, 0);

    // 2. WebGLRenderer WebXR támogatással és árnyékokkal
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    // 3. Asztali Finom Kamera Vezérlés (OrbitControls - szabad körbejárás és nagyítás asztali módban)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0.1, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 2.4;

    // 4. WebXR AR Gomb
    const arBtn = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'hands'],
      domOverlay: { root: document.getElementById('ui-overlay') }
    });
    document.body.appendChild(arBtn);

    // 5. Megvilágítás és árnyékok
    this.setupLighting();

    // 6. Területfeltérképező és animált felületi szkenner (SurfaceScanner)
    this.scanner = new SurfaceScanner(this.scene);

    // 7. Árnyékfelfogó talaj AR módhoz
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.4 })
    );
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.position.y = -0.001;
    this.scene.add(this.shadowPlane);

    // 8. Virtuális Asztali Környezet
    this.setupDesktopEnvironment();

    // 9. Fő rendszerek inicializálása
    this.physics = new PhysicsWorld();
    this.effects = new ParticleSystem(this.scene);
    this.sounds = new SoundEffects();
    this.castle = new CastleBuilder(this.scene, this.physics);

    if (this.soundIcon) {
      this.soundIcon.innerText = this.sounds.isMuted ? '🔇' : '🔊';
    }

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
      (powerPercent, targetName, wasCanceled) => {
        if (wasCanceled) {
          this.setHint('🏹', 'Lövés visszavonva. Húzd hátra a célzáshoz!');
        } else {
          const targetTxt = targetName ? `🎯 ${targetName}` : '🎯 Célzás';
          this.setHint('🏹', `${targetTxt} (${powerPercent}%) — Engedd el a kilövéshez!`);
        }
      }
    );
    this.slingshot.setCastle(this.castle);
    this.slingshot.setEffects(this.effects);

    // Célzás közben letiltjuk a kameramozgatást, elengedéskor visszakapcsoljuk
    this.slingshot.onAimStateChange = (isAiming) => {
      if (this.controls) {
        this.controls.enabled = !isAiming;
      }
    };

    // 10. Kézkövető rendszer (A szelfi kamera tartalma SOHA nem jelenik meg a képernyőn!)
    this.handTracker = new HandTracker(
      () => {
        if (this.controlMode !== 'HAND_TRACKING') return;
        this.slingshot.beginAim();
        this.setHint('🖐️', 'Kéz megfogva: Húzd hátra a kezed a levegőben a feszítéshez!');
      },
      (delta) => {
        if (this.controlMode !== 'HAND_TRACKING') return;
        const pullZ = (delta.z || 0) * 0.45 + (delta.y || 0) * 0.25;
        const pullX = (delta.x || 0) * 0.35;
        const pullY = -(delta.y || 0) * 0.25;
        this.slingshot.setPull(pullX, pullY, pullZ);
      },
      (wasFired) => {
        if (this.controlMode !== 'HAND_TRACKING') return;
        this.slingshot.endAim(wasFired);
      },
      (status) => {
        if (this.handStatusBadge && this.handStatusLabel) {
          if (status.active) {
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

    // 11. WebXR Controller érintésekhez
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.scene.add(this.controller);

    // 12. UI események és asztali egérinterakció
    this.initUI();
    this.initDesktopPlacement();

    // 13. Alapértelmezett játékfelépítés
    this.setupDesktopGame();
    this.updateScoreDisplay();

    // 14. Render loop
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
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.2;
    this.dirLight.shadow.camera.far = 8.0;

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

    const tableGeo = new THREE.BoxGeometry(2.0, 0.04, 1.6);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x2e1b10,
      roughness: 0.6,
      metalness: 0.1
    });
    this.tableMesh = new THREE.Mesh(tableGeo, tableMat);
    this.tableMesh.position.set(0, -0.02, 0);
    this.tableMesh.receiveShadow = true;
    this.desktopGroup.add(this.tableMesh);

    const grid = new THREE.GridHelper(1.6, 16, 0x6366f1, 0x334155);
    grid.position.y = 0.001;
    this.desktopGroup.add(grid);

    this.scene.add(this.desktopGroup);
  }

  setupDesktopGame() {
    this.effects.groundY = 0;
    this.slingshot.generousGrab = false;
    this.castle.buildCastleAt(this.castleWorldPos, null, 0);
    this.slingshot.placeAt(this.slingshotWorldPos, this.castleWorldPos);
    this.updateCastleBadge();

    if (this.dirLight) {
      this.dirLight.target.position.copy(this.castleWorldPos);
      this.dirLight.target.updateMatrixWorld();
    }

    this.stage = 'DESKTOP_BATTLE';
    if (this.arStepper) this.arStepper.classList.add('hidden');
    if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.add('hidden');
    this.scanner.hide();
    this.castle.hideGhost();
    this.slingshot.hideGhost();
    this.setHint('🏹', 'Húzd hátra a csúzli golyóját az egérrel vagy érintéssel a célzáshoz!');
  }

  // Interaktív lehelyezési folyamat indítása (jobb és könnyebb elrendezés szellemelőnézettel)
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

      const initialPos = this.isXRActive ? this.scanner.getPosition() : this.castleWorldPos;
      const yaw = Math.atan2(this.camera.position.x - initialPos.x, this.camera.position.z - initialPos.z);
      this.castle.showGhost(initialPos, null, yaw);
      this.setHint('🏰', '1. Lépés: KOPPINTS a kívánt helyre a VÁR felépítéséhez!');
    } else if (step === 2) {
      this.stage = 'PLACE_SLINGSHOT';
      this.updateStepper(2);
      this.castle.hideGhost();
      this.scanner.show();
      if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.remove('hidden');

      const initialPos = this.isXRActive ? this.scanner.getPosition() : this.slingshotWorldPos;
      const isValid = initialPos.distanceTo(this.castleWorldPos) >= 0.22;
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

    // A vár a játékos kamera pozíciója felé néz
    const yaw = Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
    this.castle.buildCastleAt(this.castleWorldPos, null, yaw);
    this.updateCastleBadge();
    this.effects.createPlacementBurst(this.castleWorldPos, 22);
    this.sounds.playBuild();

    if (this.dirLight) {
      this.dirLight.target.position.copy(this.castleWorldPos);
      this.dirLight.target.updateMatrixWorld();
    }

    this.startPlacement(2);
  }

  confirmSlingshotPlacement(pos) {
    // Ellenőrizzük, hogy nincs-e túl közel a várhoz
    if (pos.distanceTo(this.castleWorldPos) < 0.22) {
      this.setHint('⚠️', 'Túl közel van a várhoz! Helyezd el távolabb a csúzlit.');
      this.sounds.triggerHaptic(20);
      return;
    }

    this.slingshotWorldPos.copy(pos);
    this.slingshot.placeAt(pos, this.castleWorldPos);
    this.slingshot.generousGrab = this.isXRActive;
    this.effects.createPlacementBurst(pos, 16);
    this.sounds.playBuild();

    this.scanner.hide();
    this.slingshot.hideGhost();
    if (this.btnAutoSlingshot) this.btnAutoSlingshot.classList.add('hidden');

    this.stage = this.isXRActive ? 'BATTLE' : 'DESKTOP_BATTLE';
    this.updateStepper(3);
    this.setHint('🏹', 'Harcra kész! Húzd hátra a golyót a célzáshoz.');
  }

  autoPlaceSlingshot() {
    // Intelligens automatikus katapult elhelyezés 52 cm-re a várral szemben
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.castleWorldPos).setY(0).normalize();
    if (dir.lengthSq() < 0.01) {
      dir.set(0, 0, 1);
    }
    const autoPos = this.castleWorldPos.clone().addScaledVector(dir, 0.52);
    autoPos.y = this.castleWorldPos.y;

    this.confirmSlingshotPlacement(autoPos);
  }

  onSelect() {
    if (this.stage === 'PLACE_CASTLE' && this.scanner.active) {
      this.confirmCastlePlacement(this.scanner.getPosition());
      return;
    }

    if (this.stage === 'PLACE_SLINGSHOT' && this.scanner.active) {
      this.confirmSlingshotPlacement(this.scanner.getPosition());
    }
  }

  initDesktopPlacement() {
    // Asztali módban az egér mozgása és kattintása a lehelyezési fázisban
    const getCoords = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1
      };
    };

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (this.isXRActive) return;
      if (this.stage !== 'PLACE_CASTLE' && this.stage !== 'PLACE_SLINGSHOT') return;

      const ndc = getCoords(e);
      this.desktopRaycaster.setFromCamera(ndc, this.camera);
      const intersects = this.desktopRaycaster.intersectObject(this.tableMesh || this.shadowPlane);

      if (intersects.length > 0) {
        const pt = intersects[0].point;
        this.scanner.setPositionDirect(pt);

        if (this.stage === 'PLACE_CASTLE') {
          const yaw = Math.atan2(this.camera.position.x - pt.x, this.camera.position.z - pt.z);
          this.castle.updateGhostPosition(pt, yaw);
        } else if (this.stage === 'PLACE_SLINGSHOT') {
          const isValid = pt.distanceTo(this.castleWorldPos) >= 0.22;
          this.slingshot.updateGhost(pt, this.castleWorldPos, isValid);
        }
      }
    });

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (this.isXRActive) return;
      if (e.target.closest('#ui-overlay button') || e.target.closest('.modal-card')) return;

      if (this.stage === 'PLACE_CASTLE' && this.scanner.active) {
        this.confirmCastlePlacement(this.scanner.getPosition());
      } else if (this.stage === 'PLACE_SLINGSHOT' && this.scanner.active) {
        this.confirmSlingshotPlacement(this.scanner.getPosition());
      }
    });
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnCycle = document.getElementById('btn-cycle-castle');
    const btnReposition = document.getElementById('btn-reposition');
    const btnSound = document.getElementById('btn-sound');
    const btnHelp = document.getElementById('btn-help');
    const btnCloseHelp = document.getElementById('btn-close-help');
    const btnDismissHelp = document.getElementById('btn-dismiss-help');

    // Első érintésre feloldjuk a hangot
    const unlockAudio = () => {
      this.sounds.init();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

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
        this.updateCastleBadge();
        this.sounds.playBuild();
      } else {
        this.castle.cycleNextLayout(this.castleWorldPos);
        this.updateCastleBadge();
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

    // 📱 Telefonmozgás hüvelykujj FAB eseményei
    const startPhoneGrab = (e) => {
      if (this.controlMode !== 'PHONE_MOTION') return;
      e.preventDefault();
      this.isPhonePulling = true;
      this.phoneAnchorCamPos.copy(this.camera.position);
      this.slingshot.beginAim();
      this.btnPhonePull?.classList.add('grabbing');
      this.sounds.playTension();
      this.setHint('📱', 'Tartsd nyomva, és lépj hátra a telefonnal a célzáshoz!');
    };

    const endPhoneGrab = (e) => {
      if (this.controlMode !== 'PHONE_MOTION' || !this.isPhonePulling) return;
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
        this.desktopGroup.visible = false;
        if (this.controls) this.controls.enabled = false;
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
          this.hitTestSourceRequested = false;
          this.hitTestSource = null;
          this.isXRActive = false;
          document.body.classList.remove('xr-active');
          if (this.arStepper) this.arStepper.classList.add('hidden');
          if (this.controls) this.controls.enabled = true;
          this.desktopGroup.visible = true;
          this.setupDesktopGame();
        });

        this.hitTestSourceRequested = true;
      }

      // WebXR AR Felületkeresés (Hit-Testing) simított felületi szkennerrel
      if (this.hitTestSource && (this.stage === 'PLACE_CASTLE' || this.stage === 'PLACE_SLINGSHOT')) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);
          const m = pose.transform.matrix;
          const upY = m[5]; // Vízszintes sík vizsgálata (Y irányvektor felfelé mutat-e)
          const isHorizontal = upY > 0.62;

          this.scanner.setPose(pose.transform.matrix, isHorizontal);
          const scanPos = this.scanner.getPosition();

          if (this.stage === 'PLACE_CASTLE') {
            const yaw = Math.atan2(this.camera.position.x - scanPos.x, this.camera.position.z - scanPos.z);
            this.castle.updateGhostPosition(scanPos, yaw);
            this.setHint('🏰', isHorizontal ? 'Asztal érzékelve! KOPPINTS a VÁR lerakásához!' : '⚠️ Irányítsd vízszintes felületre!');
          } else if (this.stage === 'PLACE_SLINGSHOT') {
            const isValid = scanPos.distanceTo(this.castleWorldPos) >= 0.22;
            this.slingshot.updateGhost(scanPos, this.castleWorldPos, isValid);
            if (!isValid) {
              this.setHint('⚠️', 'Túl közel a várhoz! Lépj hátrébb az asztal mellett.');
            } else {
              this.setHint('🎯', isHorizontal ? 'KOPPINTS a CSÚZLI lerakásához, vagy használd az Auto gombot!' : '⚠️ Irányítsd vízszintes felületre!');
            }
          }
        } else {
          this.scanner.hide();
          this.setHint('🔍', 'Pásztázd a telefonnal az asztal felületét...');
        }
      }

      // WebXR Hand Tracking frissítése
      if (this.controlMode === 'HAND_TRACKING') {
        this.handTracker.updateXRHand(frame, referenceSpace);
      }
    }

    // Pásztázó és felületi animáció frissítése
    this.scanner.update(dt);
    this.slingshot.update(dt);

    // Asztali kamera finommozgás (OrbitControls)
    if (!this.isXRActive && this.controls && this.controls.enabled) {
      this.controls.update();
    }

    // 📱 Telefonmozgás (Phone Pullback) hátrahúzás szimulációja
    if (this.controlMode === 'PHONE_MOTION' && this.isPhonePulling && this.slingshot.dirToCastle) {
      const deltaCam = this.tempCamDelta.copy(this.camera.position).sub(this.phoneAnchorCamPos);

      const pullZ = -deltaCam.dot(this.slingshot.dirToCastle) * 0.85;
      const pullX = deltaCam.dot(this.slingshot.dirRight) * 0.85;
      const pullY = deltaCam.y * 0.65;

      this.slingshot.setPull(pullX, pullY, pullZ);
    }

    // Fizikai világ és részecskék léptetése
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
}

window.addEventListener('DOMContentLoaded', () => {
  new WebXRApp();
});
