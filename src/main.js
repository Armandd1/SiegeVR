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
    this.score = 0;

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Kétlépcsős állapotgép: 'WAITING_AR' -> 'PLACE_CASTLE' -> 'PLACE_SLINGSHOT' -> 'BATTLE'
    this.stage = 'WAITING_AR';
    this.castleWorldPos = new THREE.Vector3();

    this.init();
  }

  init() {
    // 1. Színtér és Kamera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // 2. WebGLRenderer WebXR támogatással
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 3. WebXR AR Gomb
    const arBtn = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'hands'],
      domOverlay: { root: document.getElementById('ui-overlay') }
    });
    document.body.appendChild(arBtn);

    // 4. Megvilágítás
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8e7, 1.8);
    dirLight.position.set(2, 6, 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.001;
    this.scene.add(dirLight);

    // 5. Célzó karika (Reticle)
    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    this.reticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // 6. Árnyékfelfogó talaj
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.visible = false;
    this.scene.add(this.shadowPlane);

    // 7. Rendszerek inicializálása
    this.physics = new PhysicsWorld();
    this.effects = new ParticleSystem(this.scene);
    this.sounds = new SoundEffects();
    this.castle = new CastleBuilder(this.scene, this.physics);

    this.slingshot = new Slingshot(
      this.scene,
      this.physics,
      this.camera,
      this.renderer.domElement,
      () => {
        this.sounds.playShoot();
      }
    );

    // 8. WebXR Controller érintésekhez
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.scene.add(this.controller);

    // 9. UI események
    this.initUI();

    // 10. Render loop
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(this.render.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  onSelect() {
    // 1. LÉPÉS: VÁR LEHELYEZÉSE
    if (this.stage === 'PLACE_CASTLE' && this.reticle.visible) {
      this.castleWorldPos.setFromMatrixPosition(this.reticle.matrix);

      // Árnyékfelfogó a vár alá
      this.shadowPlane.position.copy(this.castleWorldPos);
      this.shadowPlane.visible = true;

      // Vár felépítése az asztalon
      this.castle.buildCastleAt(this.castleWorldPos);
      this.sounds.playImpact();

      // Átlépünk a csúzli lehelyezésére
      this.stage = 'PLACE_SLINGSHOT';
      this.hint.innerText = "🎯 2/2 LÉPÉS: Lépj kicsit hátrébb, és KOPPINTS a CSÚZLI lerakásához!";
      return;
    }

    // 2. LÉPÉS: CSÚZLI LEHELYEZÉSE
    if (this.stage === 'PLACE_SLINGSHOT' && this.reticle.visible) {
      const slingshotWorldPos = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);

      // Csúzli lerakása és a vár felé fordítása
      this.slingshot.placeAt(slingshotWorldPos, this.castleWorldPos);
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
      if (this.castleWorldPos.length() > 0.01) {
        this.castle.buildCastleAt(this.castleWorldPos);
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.sounds.playImpact();
      } else {
        this.hint.innerText = "🔍 Először koppints az asztalra a vár letételéhez!";
      }
    });

    btnReposition.addEventListener('click', () => {
      this.stage = 'PLACE_CASTLE';
      this.castle.clear();
      this.slingshot.group.visible = false;
      this.shadowPlane.visible = false;
      this.reticle.visible = true;
      this.score = 0;
      this.scoreDisplay.innerText = this.score;
      this.hint.innerText = "🏰 1/2 LÉPÉS: Pásztázd az asztalt, és KOPPINTS az új helyre!";
    });
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (frame) {
      const referenceSpace = this.renderer.xr.getReferenceSpace();
      const session = this.renderer.xr.getSession();

      if (!this.hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((refSpace) => {
          session.requestHitTestSource({ space: refSpace }).then((source) => {
            this.hitTestSource = source;
          });
        });

        session.addEventListener('end', () => {
          this.hitTestSourceRequested = false;
          this.hitTestSource = null;
          this.stage = 'WAITING_AR';
          this.reticle.visible = false;
        });

        this.hitTestSourceRequested = true;
        this.stage = 'PLACE_CASTLE';
      }

      // Felületkeresés
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

    // Fizikai világ léptetése
    if (this.stage === 'BATTLE') {
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
      if (block.position.y < this.castleWorldPos.y - 0.04 || 
          block.position.distanceTo(this.castleWorldPos) > 0.35) {
        movedBlocks++;
      }
    }
    const newScore = movedBlocks * 50;
    if (newScore !== this.score) {
      this.score = newScore;
      this.scoreDisplay.innerText = this.score;
      this.effects.createImpact(this.castleWorldPos.clone().add(new THREE.Vector3(0, 0.1, 0)), 3);
      this.sounds.playImpact();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new WebXRApp();
});
