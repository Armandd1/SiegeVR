import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { CastleBuilder } from './castle.js';
import { Slingshot } from './slingshot.js';
import { ParticleSystem, SoundEffects } from './effects.js';
import { MindARThree } from '/mindar-image-three.prod.js';

class ARApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.score = 0;
    this.scoreDisplay = document.getElementById('score-display');
    this.hint = document.getElementById('slingshot-hint');

    this.init();
  }

  async init() {
    this.hint.innerText = "⏳ Kamera és AR inicializálása...";

    try {
      // 2. MindARThree példányosítása közvetlen ES modulból
      this.mindarThree = new MindARThree({
        container: this.container,
        imageTargetSrc: './card.mind',
        filterMinCF: 0.0001,
        filterBeta: 0.001
      });

      this.hint.innerText = "⏳ 3/3: Kamera elindítása...";

      const { renderer, scene, camera } = this.mindarThree;
      this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Árnyékok engedélyezése az AR renderelőben
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 3. Fények hozzáadása az AR jelenethez
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8e7, 1.5);
    dirLight.position.set(2, 6, 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    // 4. AR Anchor (Követési célkereszt)
    this.anchor = this.mindarThree.addAnchor(0);

    // Játék főcsoportja, amit a kártyához rögzítünk
    this.gameGroup = new THREE.Group();
    // MindAR kártya orientáció: a kártya síkja az XY sík, így elforgatjuk 90 fokkal a kényelmes függőleges álláshoz
    this.gameGroup.scale.set(0.25, 0.25, 0.25);
    this.gameGroup.rotation.x = Math.PI / 2;
    this.anchor.group.add(this.gameGroup);

    // Árnyékfelfogó a valódi kártya/asztal síkjára (hogy a virtuális vár árnyékot vessen az asztalra!)
    const shadowPlaneGeo = new THREE.PlaneGeometry(8, 8);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.4 });
    const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.receiveShadow = true;
    shadowPlane.position.set(0, 0, 0);
    this.gameGroup.add(shadowPlane);

    // 5. Fizika és Játékelemek
    this.physics = new PhysicsWorld();
    this.effects = new ParticleSystem(this.gameGroup);
    this.sounds = new SoundEffects();
    this.castle = new CastleBuilder(this.gameGroup, this.physics);
    this.portal = new DimensionPortal(this.gameGroup);

    // Vár építése a kártya közepére
    this.castle.buildCastle(0, -1.0);

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

    // Események: célkép megtalálása / elvesztése
    this.anchor.onTargetFound = () => {
      this.hint.innerText = "🎯 Célkép megtalálva! Húzd hátra a golyót a lövéshez!";
    };

    this.anchor.onTargetLost = () => {
      this.hint.innerText = "🔍 Keresd a kamerával az AR Kártyát az asztalon...";
    };

    // 6. UI események
    this.initUI();

    // 7. AR Kamera indítása hibakezeléssel
    try {
      await this.mindarThree.start();
      this.hint.innerText = "🔍 Irányítsd a kamerát az AR Kártyára!";
    } catch (camErr) {
      console.error("Kamera indítási hiba:", camErr);
      this.hint.innerText = "📷 Koppints ide a kamera engedélyezéséhez!";
      this.hint.style.cursor = "pointer";
      this.hint.onclick = async () => {
        try {
          await this.mindarThree.start();
          this.hint.innerText = "🔍 Irányítsd a kamerát az AR Kártyára!";
        } catch (e) {
          alert("Kamera hiba: Győződj meg róla, hogy engedélyezted a kamerát a böngészőben! " + e.message);
        }
      };
    }

    // 8. Render ciklus
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(this.animate.bind(this));
  } catch (globalErr) {
    console.error("AR Inicializációs hiba:", globalErr);
    this.hint.innerText = "❌ Hiba: " + globalErr.message;
  }
}

  initUI() {
    const btnReset = document.getElementById('btn-reset');
    const btnPortal = document.getElementById('btn-portal');
    const btnShowMarker = document.getElementById('btn-show-marker');
    const markerModal = document.getElementById('marker-modal');
    const btnCloseMarker = document.getElementById('btn-close-marker');

    btnReset.addEventListener('click', () => {
      this.castle.buildCastle(0, -1.0);
      this.score = 0;
      this.scoreDisplay.innerText = this.score;
      this.sounds.playImpact();
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

    btnShowMarker.addEventListener('click', () => {
      markerModal.classList.remove('modal-hidden');
    });

    btnCloseMarker.addEventListener('click', () => {
      markerModal.classList.add('modal-hidden');
    });
  }

  animate() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsedTime();

    // Csak akkor szimuláljuk a fizikát és animációkat, ha látható a célkép
    if (this.anchor.visible) {
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
      if (block.position.y < 0.2 || Math.abs(block.position.x) > 1.0) {
        movedBlocks++;
      }
    }
    const newScore = movedBlocks * 50;
    if (newScore !== this.score) {
      this.score = newScore;
      this.scoreDisplay.innerText = this.score;
      this.effects.createImpact(new THREE.Vector3(0, 0.5, -1.0), 3);
      this.sounds.playImpact();
    }
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}

// Kizárólag natív AR Alkalmazás indítása
window.addEventListener('DOMContentLoaded', () => {
  new ARApp();
});
