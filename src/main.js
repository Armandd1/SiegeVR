import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { PhysicsWorld } from './physics.js';
import { CastleBuilder } from './castle.js';
import { Slingshot } from './slingshot.js';
import { ParticleSystem, SoundEffects } from './effects.js';
import { DimensionPortal } from './portal.js';

class WebXRApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.hint = document.getElementById('slingshot-hint');
    this.scoreDisplay = document.getElementById('score-display');
    this.score = 0;

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Kétlépcsős elhelyezési fázisok:
    // 'WAITING_AR' -> 'PLACE_CASTLE' -> 'PLACE_SLINGSHOT' -> 'BATTLE'
    this.placementStage = 'WAITING_AR';

    this.init();
  }

  init() {
    // 1. Háttér és színtér
    this.scene = new THREE.Scene();

    // 2. Kamera
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // 3. WebGLRenderer WebXR támogatással
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 4. WebXR AR Gomb
    const arButton = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'hands'],
      domOverlay: { root: document.getElementById('ui-overlay') }
    });
    document.body.appendChild(arButton);

    // 5. Fények
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8e7, 1.8);
    dirLight.position.set(2, 6, 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.001;
    this.scene.add(dirLight);

    // 6. Felületérzékelő Célzó Karika (Reticle)
    const reticleGeo = new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    this.reticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // 7. Csoportok a Várnak és a Csúzlinak (KÜLÖN csoportok!)
    this.castleGroup = new THREE.Group();
    this.castleGroup.visible = false;
    this.scene.add(this.castleGroup);

    this.slingshotGroup = new THREE.Group();
    this.slingshotGroup.visible = false;
    this.scene.add(this.slingshotGroup);

    // Árnyékfelfogó az asztal felületére a vár alatt
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    shadowPlane.receiveShadow = true;
    this.castleGroup.add(shadowPlane);

    // 8. Fizika, Effektek és Játékelemek
    this.physics = new PhysicsWorld();
    this.effects = new ParticleSystem(this.scene);
    this.sounds = new SoundEffects();
    this.castle = new CastleBuilder(this.castleGroup, this.physics);
    this.portal = new DimensionPortal(this.castleGroup);

    // Csúzli inicializálása
    this.slingshot = new Slingshot(
      this.slingshotGroup,
      this.physics,
      this.camera,
      this.renderer.domElement,
      () => {
        this.sounds.playShoot();
      }
    );

    // 9. WebXR Controller a felületre koppintáshoz
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.scene.add(this.controller);

    // 10. UI kezelőszervek
    this.initUI();

    // 11. Render ciklus
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(this.render.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  onSelect() {
    // 1. LÉPÉS: VÁR LEHELYEZÉSE
    if (this.placementStage === 'PLACE_CASTLE' && this.reticle.visible) {
      this.castleGroup.position.setFromMatrixPosition(this.reticle.matrix);
      this.castleGroup.visible = true;

      // Felépítjük a várat a kívánt helyen
      this.castle.buildCastle(0, 0);
      this.sounds.playImpact();

      // Átlépünk a 2. lépésre: Csúzli lehelyezése
      this.placementStage = 'PLACE_SLINGSHOT';
      this.hint.innerText = "🎯 2/2 LÉPÉS: Lépj kicsit hátrébb, és KOPPINTS a CSÚZLI lerakásához!";
      return;
    }

    // 2. LÉPÉS: CSÚZLI LEHELYEZÉSE
    if (this.placementStage === 'PLACE_SLINGSHOT' && this.reticle.visible) {
      this.slingshotGroup.position.setFromMatrixPosition(this.reticle.matrix);
      this.slingshotGroup.visible = true;

      // A csúzlit automatikusan a vár felé fordítjuk!
      this.slingshotGroup.lookAt(
        this.castleGroup.position.x,
        this.slingshotGroup.position.y,
        this.castleGroup.position.z
      );

      this.sounds.playImpact();
      this.reticle.visible = false;

      // Átlépünk a játék állapotba
      this.placementStage = 'BATTLE';
      this.hint.innerText = "🏹 Húzd hátra az ujjaddal a golyót a célzáshoz és engedd el!";
    }
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnPortal = document.getElementById('btn-portal');

    btnReset.addEventListener('click', () => {
      if (this.castleGroup.visible) {
        this.castle.buildCastle(0, 0);
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.sounds.playImpact();
      } else {
        this.hint.innerText = "🔍 Először koppints az asztalra a vár letételéhez!";
      }
    });

    const btnReposition = document.getElementById('btn-reposition');
    btnReposition.addEventListener('click', () => {
      this.placementStage = 'PLACE_CASTLE';
      this.castleGroup.visible = false;
      this.slingshotGroup.visible = false;
      this.reticle.visible = true;
      this.score = 0;
      this.scoreDisplay.innerText = this.score;
      this.hint.innerText = "🏰 1/2 LÉPÉS: Pásztázd az asztalt, és KOPPINTS az új helyre!";
    });

    btnPortal.addEventListener('click', () => {
      const active = this.portal.toggle();
      this.sounds.playPortal();
      if (active) {
        btnPortal.classList.add('active-portal');
        btnPortal.querySelector('.btn-text').innerText = 'Portál: BE';
      } else {
        btnPortal.classList.remove('active-portal');
        btnPortal.querySelector('.btn-text').innerText = 'Portál: KI';
      }
    });
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsedTime();

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
          this.placementStage = 'WAITING_AR';
          this.reticle.visible = false;
        });

        this.hitTestSourceRequested = true;
        this.placementStage = 'PLACE_CASTLE';
      }

      // Felületérzékelés aktív, amíg le nem raktuk mindkét tárgyat
      if (this.hitTestSource && (this.placementStage === 'PLACE_CASTLE' || this.placementStage === 'PLACE_SLINGSHOT')) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);

          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);

          if (this.placementStage === 'PLACE_CASTLE') {
            this.hint.innerText = "🏰 1/2 LÉPÉS: Asztal érzékelve! KOPPINTS a VÁR lerakásához!";
          } else if (this.placementStage === 'PLACE_SLINGSHOT') {
            this.hint.innerText = "🎯 2/2 LÉPÉS: Lépj hátrébb és KOPPINTS a CSÚZLI lerakásához!";
          }
        } else {
          this.reticle.visible = false;
          this.hint.innerText = "🔍 Pásztázd a kamerával az asztal vagy padló felületét...";
        }
      }
    }

    // Csak a játék fázisban léptetjük a fizikai szimulációt
    if (this.placementStage === 'BATTLE') {
      this.physics.step(dt);
      this.effects.update(dt);
      this.portal.update(dt, time);
      this.slingshot.cleanOldProjectiles();
      this.updateScore();
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateScore() {
    let movedBlocks = 0;
    for (const block of this.castle.blocks) {
      // Ha a blokk leesett az asztalról vagy elmozdult a helyéről
      const worldPos = block.getWorldPosition(new THREE.Vector3());
      if (worldPos.y < this.castleGroup.position.y - 0.05 || 
          worldPos.distanceTo(this.castleGroup.position) > 0.35) {
        movedBlocks++;
      }
    }
    const newScore = movedBlocks * 50;
    if (newScore !== this.score) {
      this.score = newScore;
      this.scoreDisplay.innerText = this.score;
      this.effects.createImpact(this.castleGroup.position.clone().add(new THREE.Vector3(0, 0.15, 0)), 4);
      this.sounds.playImpact();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new WebXRApp();
});
