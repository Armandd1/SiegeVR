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
    this.isPlaced = false;

    this.init();
  }

  init() {
    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // 3. Renderer WebXR támogatással
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 4. Hivatalos Three.js AR Gomb (WebXR Hit-test kéréssel)
    const arButton = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.getElementById('ui-overlay') }
    });
    document.body.appendChild(arButton);

    // 5. Fények
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8e7, 1.6);
    dirLight.position.set(3, 8, 4);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // 6. Felületérzékelő Célzó Karika (Reticle)
    const reticleGeo = new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    this.reticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // 7. Játék elemek csoportja
    this.gameGroup = new THREE.Group();
    this.gameGroup.visible = false;
    this.scene.add(this.gameGroup);

    // Árnyékfelfogó az asztal felületére
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    shadowPlane.receiveShadow = true;
    this.gameGroup.add(shadowPlane);

    // 8. Fizika és játékrendszerek
    this.physics = new PhysicsWorld();
    this.effects = new ParticleSystem(this.gameGroup);
    this.sounds = new SoundEffects();
    this.castle = new CastleBuilder(this.gameGroup, this.physics);
    this.portal = new DimensionPortal(this.gameGroup);

    // Csúzli
    this.slingshot = new Slingshot(
      this.gameGroup,
      this.physics,
      this.camera,
      this.renderer.domElement,
      () => {
        this.sounds.playShoot();
      }
    );

    // 9. Koppintás / Controller kiválasztás az elhelyezéshez
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.scene.add(this.controller);

    // 10. UI kezelés
    this.initUI();

    // 11. Render ciklus
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(this.render.bind(this));

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  onSelect() {
    // Ha a célzó karika látható és még nem tettük le a várat
    if (this.reticle.visible && !this.isPlaced) {
      // Átmozgatjuk a játékot a megtalált felületre
      this.gameGroup.position.setFromMatrixPosition(this.reticle.matrix);
      this.gameGroup.visible = true;
      this.isPlaced = true;
      this.reticle.visible = false;

      // Vár felépítése az asztalon
      this.castle.buildCastle(0, -1.2);
      this.sounds.playImpact();
      this.hint.innerText = "🎯 Vár felépítve! Húzd hátra a golyót a lövéshez!";
    }
  }

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnPortal = document.getElementById('btn-portal');

    btnReset.addEventListener('click', () => {
      if (this.isPlaced) {
        this.castle.buildCastle(0, -1.2);
        this.score = 0;
        this.scoreDisplay.innerText = this.score;
        this.sounds.playImpact();
      } else {
        this.hint.innerText = "🔍 Először koppints az asztalra a vár letételéhez!";
      }
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

      // WebXR Hit-test forrás kérése
      if (!this.hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((referenceSpace) => {
          session.requestHitTestSource({ space: referenceSpace }).then((source) => {
            this.hitTestSource = source;
          });
        });

        session.addEventListener('end', () => {
          this.hitTestSourceRequested = false;
          this.hitTestSource = null;
          this.isPlaced = false;
          this.reticle.visible = false;
        });

        this.hitTestSourceRequested = true;
      }

      // Ha van aktív felületkeresés és még nincs lerakva a vár
      if (this.hitTestSource && !this.isPlaced) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);

          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);
          this.hint.innerText = "📍 Asztal érzékelve! Koppints a képernyőre a vár lerakásához!";
        } else {
          this.reticle.visible = false;
          this.hint.innerText = "🔍 Pásztázd a kamerával a padlót vagy asztalt...";
        }
      }
    }

    // Csak lerakás után szimulálunk fizikát
    if (this.isPlaced) {
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
      if (block.position.y < 0.15 || Math.abs(block.position.x) > 1.0) {
        movedBlocks++;
      }
    }
    const newScore = movedBlocks * 50;
    if (newScore !== this.score) {
      this.score = newScore;
      this.scoreDisplay.innerText = this.score;
      this.effects.createImpact(new THREE.Vector3(0, 0.5, -1.2), 3);
      this.sounds.playImpact();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new WebXRApp();
});
