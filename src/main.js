import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { PhysicsWorld } from './physics.js';
import { CastleBuilder } from './castle.js';
import { Slingshot } from './slingshot.js';
import { ParticleSystem, SoundEffects } from './effects.js';

class WebXRApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.hint = document.getElementById('slingshot-hint');
    this.scoreDisplay = document.getElementById('score-display');
    this.modeBadge = document.getElementById('mode-badge');
    this.score = 0;

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Állapotgép: 'DESKTOP_BATTLE' (ha nincs AR) | AR esetén: 'WAITING_AR' -> 'PLACE_CASTLE' -> 'PLACE_SLINGSHOT' -> 'BATTLE'
    this.isXRActive = false;
    this.stage = 'DESKTOP_BATTLE';
    this.castleWorldPos = new THREE.Vector3(0, 0, -0.28);
    this.slingshotWorldPos = new THREE.Vector3(0, 0, 0.32);

    this.init();
  }

  init() {
    // 1. Háttér, Színtér és Kamera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0, 0.38, 0.68);
    this.camera.lookAt(0, 0.08, 0);

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

    // 5. Célzó karika (Reticle) AR felületkereséshez
    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
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
        this.effects.createImpact(impactPt, 20);
        this.sounds.playImpact();
      },
      () => this.sounds.playTension()
    );

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
    const d = 1.0;
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

    // Stílusos virtuális fa asztallap a 3D asztali élményhez
    const tableGeo = new THREE.BoxGeometry(1.6, 0.04, 1.3);
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
    const grid = new THREE.GridHelper(1.2, 12, 0x6366f1, 0x334155);
    grid.position.y = 0.001;
    this.desktopGroup.add(grid);

    this.scene.add(this.desktopGroup);
  }

  setupDesktopGame() {
    // Felépítjük a várat a virtuális asztalon
    this.castle.buildCastleAt(this.castleWorldPos);
    this.slingshot.placeAt(this.slingshotWorldPos, this.castleWorldPos);

    if (this.dirLight) {
      this.dirLight.target.position.copy(this.castleWorldPos);
      this.dirLight.target.updateMatrixWorld();
    }

    this.stage = 'DESKTOP_BATTLE';
    if (this.hint) {
      this.hint.innerText = "🏹 Húzd hátra a csúzli golyóját az egérrel/érintéssel a célzáshoz!";
    }
    if (this.modeBadge) {
      this.modeBadge.innerText = "🖥️ 3D Asztali Mód";
    }
  }

  onSelect() {
    // 1. LÉPÉS AR-BEN: VÁR LEHELYEZÉSE
    if (this.stage === 'PLACE_CASTLE' && this.reticle.visible) {
      this.castleWorldPos.setFromMatrixPosition(this.reticle.matrix);

      this.shadowPlane.position.copy(this.castleWorldPos);
      this.shadowPlane.visible = true;

      // Vár felépítése az érzékelt ponton
      this.castle.buildCastleAt(this.castleWorldPos);
      this.sounds.playImpact();

      if (this.dirLight) {
        this.dirLight.target.position.copy(this.castleWorldPos);
        this.dirLight.target.updateMatrixWorld();
      }

      this.stage = 'PLACE_SLINGSHOT';
      this.hint.innerText = "🎯 2/2 LÉPÉS: Lépj kicsit hátrébb, és KOPPINTS a CSÚZLI lerakásához!";
      return;
    }

    // 2. LÉPÉS AR-BEN: CSÚZLI LEHELYEZÉSE
    if (this.stage === 'PLACE_SLINGSHOT' && this.reticle.visible) {
      const slingshotPos = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);

      this.slingshot.placeAt(slingshotPos, this.castleWorldPos);
      this.sounds.playImpact();

      this.reticle.visible = false;
      this.stage = 'BATTLE';
      this.hint.innerText = "🏹 Húzd hátra a csúzli golyóját a célzáshoz és engedd el!";
    }
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnReposition = document.getElementById('btn-reposition');

    btnReset.addEventListener('click', () => {
      this.castle.buildCastleAt(this.castleWorldPos);
      this.score = 0;
      this.scoreDisplay.innerText = this.score;
      this.sounds.playImpact();
      this.effects.clear();
    });

    btnReposition.addEventListener('click', () => {
      if (this.isXRActive) {
        this.stage = 'PLACE_CASTLE';
        this.castle.clear();
        this.slingshot.group.visible = false;
        this.shadowPlane.visible = false;
        this.reticle.visible = true;
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.hint.innerText = "🏰 1/2 LÉPÉS: Pásztázd az asztalt, és KOPPINTS az új helyre!";
      } else {
        // Asztali módban új vár típus generálása
        this.setupDesktopGame();
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.sounds.playImpact();
        this.effects.clear();
      }
    });
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
        // AR módban elrejtjük a virtuális fa asztalt, mert a valós asztalra vetítünk
        this.desktopGroup.visible = false;
        if (this.modeBadge) this.modeBadge.innerText = "📱 WebAR Mód";
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
          this.desktopGroup.visible = true;
          this.setupDesktopGame();
        });

        this.hitTestSourceRequested = true;
        this.stage = 'PLACE_CASTLE';
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
            this.hint.innerText = "🏰 1/2: Asztal érzékelve! KOPPINTS a VÁR lerakásához!";
          } else if (this.stage === 'PLACE_SLINGSHOT') {
            this.hint.innerText = "🎯 2/2: Lépj kicsit hátrébb és KOPPINTS a CSÚZLI lerakásához!";
          }
        } else {
          this.reticle.visible = false;
          this.hint.innerText = "🔍 Pásztázd a kamerával az asztal felületét...";
        }
      }
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
      
      // 2. Felborulás vizsgálata (ha a kő elbillent vagy az oldalára borult)
      const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(block.quaternion).y;

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
