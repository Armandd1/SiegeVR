import * as THREE from 'three';
import { Vec3 } from 'cannon-es';
import { PHYSICS_DT, GRAVITY, PROJECTILE_DAMPING } from './physics.js';

// Egységes húzási határok – mindhárom vezérlési mód (érintés, telefon, kéz) ugyanezt használja
export const PULL_LIMITS = {
  minZ: 0.002,
  maxZ: 0.18,
  maxX: 0.12,
  maxY: 0.08,
  fireZ: 0.004,      // finom, kis húzás esetén is kilövi a golyót! Csak a kiindulási pontra visszatolás ( < 4 mm ) vonja vissza
  fullPowerZ: 0.16   // 100%-os erő
};

const MAX_PROJECTILES = 10;
const PROJECTILE_LIFETIME_MS = 6500;
const TRAJECTORY_POINTS = 90; // 1.5 s előrejelzés 60 Hz-es lépésekkel

// Újrafelhasznált ideiglenes vektorok (nincs képkockánkénti allokáció)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _curr = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _next = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _segBox = new THREE.Box3();
const _hitPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _Z_NEG = new THREE.Vector3(0, 0, -1);
const _Z_POS = new THREE.Vector3(0, 0, 1);
const _Y_UP = new THREE.Vector3(0, 1, 0);

export class Slingshot {
  constructor(scene, physics, camera, domElement, onShoot, onImpact, onTension, onAim) {
    this.scene = scene;
    this.physics = physics;
    this.camera = camera;
    this.domElement = domElement;
    this.onShoot = onShoot;
    this.onImpact = onImpact;
    this.onTension = onTension;
    this.onAim = onAim;

    this.castle = null;
    this.trajRaycaster = new THREE.Raycaster();

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.isAiming = false;
    this.hasPlayedTension = false;
    this.targetCastlePos = new THREE.Vector3(0, 0, 0);
    this.dirToCastle = new THREE.Vector3(0, 0, -1);
    this.dirRight = new THREE.Vector3(1, 0, 0);

    // AR-ban a képernyő alsó részén bárhol indítható a húzás; asztali módban csak a csúzli közelében
    this.generousGrab = false;

    // Rugós visszacsapódás és újratöltés animáció állapota
    this.springOffset = new THREE.Vector3();
    this.springVel = new THREE.Vector3();
    this.reloadT = 1;
    this.time = 0;

    // Finomított kompakt asztali méretek (arányosítva a kisebb várhoz: kb. 15 cm magas)
    this.stemHeight = 0.12;
    this.forkWidth = 0.095;
    this.forkHeight = 0.072;
    this.restLocalPos = new THREE.Vector3(0, this.stemHeight + this.forkHeight * 0.45, 0);

    this.radius = 0.025; // 5.0 cm átmérőjű kompakt ostromlövedék
    this.sphereGeo = new THREE.SphereGeometry(this.radius, 20, 20);

    // Izzó meteor / tüzes ágyúgolyó anyag
    this.projectileMat = new THREE.MeshStandardMaterial({
      color: 0xff6b00,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0xef4444,
      emissiveIntensity: 0.85
    });

    // Célzó golyó a fészekben
    this.aimBall = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    this.aimBall.position.copy(this.restLocalPos);
    this.aimBall.castShadow = true;
    this.group.add(this.aimBall);

    // Bőr lövedéktartó fészek a golyó mögött
    const pouchGeo = new THREE.BoxGeometry(0.045, 0.034, 0.012);
    const pouchMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.9 });
    this.pouch = new THREE.Mesh(pouchGeo, pouchMat);
    this.pouch.position.copy(this.restLocalPos);
    this.pouch.castShadow = true;
    this.group.add(this.pouch);

    // Kézfogó / Célzó karika pulzáló világítással
    const ringGeo = new THREE.RingGeometry(0.032, 0.042, 32);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    this.pullHelperRing = new THREE.Mesh(ringGeo, this.ringMat);
    this.pullHelperRing.position.copy(this.restLocalPos);
    this.group.add(this.pullHelperRing);

    // Csúzli modell (faragott fa + masszív talapzat + réz rögzítők)
    this.createModel();

    // Valódi 3D gumiszalagok (a hajszálvékony 1px drótok helyett)
    this.create3DBands();

    // 3D Röppálya trajektória
    this.trajectoryPoints = TRAJECTORY_POINTS;
    const trajGeo = new THREE.BufferGeometry();
    const trajPositions = new Float32Array(this.trajectoryPoints * 3);
    trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
    this.trajMaterial = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9
    });
    this.trajectoryLine = new THREE.Line(trajGeo, this.trajMaterial);
    this.trajectoryLine.visible = false;
    this.trajectoryLine.frustumCulled = false; // a pontok dinamikusak, a befoglaló gömb elavulna
    this.scene.add(this.trajectoryLine);

    // Taktikai precíziós célkereszt csoport
    this.hitMarkerGroup = new THREE.Group();
    this.hitMarkerGroup.visible = false;
    this.scene.add(this.hitMarkerGroup);

    this.hitMarkerMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });

    const markerRing = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.026, 32), this.hitMarkerMat);
    this.hitMarkerGroup.add(markerRing);

    const markerDot = new THREE.Mesh(new THREE.CircleGeometry(0.005, 16), this.hitMarkerMat);
    this.hitMarkerGroup.add(markerDot);

    // Szálkereszt rovátkák a célkereszten
    [-1, 1].forEach(dir => {
      const hBar = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.0028), this.hitMarkerMat);
      hBar.position.set(dir * 0.034, 0, 0);
      this.hitMarkerGroup.add(hBar);

      const vBar = new THREE.Mesh(new THREE.PlaneGeometry(0.0028, 0.012), this.hitMarkerMat);
      vBar.position.set(0, dir * 0.034, 0);
      this.hitMarkerGroup.add(vBar);
    });

    this.controlMode = 'TOUCH';
    this.projectiles = [];
    this.raycaster = new THREE.Raycaster();
    this.groundY = 0;
    this.effects = null;
    this.onAimStateChange = null;

    // A sugárkövetéshez használt objektumok (csak a csúzli, a ghost nélkül)
    this.grabTargets = null;

    this.createGhostModel();
    this.bindEvents();
  }

  setCastle(castle) {
    this.castle = castle;
  }

  setEffects(effects) {
    this.effects = effects;
  }

  setControlMode(mode) {
    if (this.isAiming) this.endAim(false);
    this.controlMode = mode;
  }

  createGhostModel() {
    this.ghostGroup = new THREE.Group();
    this.ghostGroup.visible = false;
    this.scene.add(this.ghostGroup);

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const ghostMat = this.ghostMat;

    const baseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.072, 0.015, 24),
      ghostMat
    );
    baseMesh.position.set(0, 0.008, 0);
    this.ghostGroup.add(baseMesh);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.016, this.stemHeight, 16),
      ghostMat
    );
    stem.position.set(0, this.stemHeight / 2 + 0.008, 0);
    this.ghostGroup.add(stem);

    const forkGeo = new THREE.CylinderGeometry(0.008, 0.011, this.forkHeight, 14);
    const forkY = this.stemHeight + 0.008;

    const forkL = new THREE.Mesh(forkGeo, ghostMat);
    forkL.position.set(-this.forkWidth / 3.4, forkY + this.forkHeight * 0.46, 0);
    forkL.rotation.z = Math.PI / 6.2;
    this.ghostGroup.add(forkL);

    const forkR = new THREE.Mesh(forkGeo, ghostMat);
    forkR.position.set(this.forkWidth / 3.4, forkY + this.forkHeight * 0.46, 0);
    forkR.rotation.z = -Math.PI / 6.2;
    this.ghostGroup.add(forkR);
  }

  showGhost(worldPos, lookTargetPos) {
    this.updateGhost(worldPos, lookTargetPos);
    this.ghostGroup.visible = true;
  }

  updateGhost(worldPos, lookTargetPos, isValid = true) {
    this.ghostGroup.position.copy(worldPos);
    if (lookTargetPos) {
      const dir = _v1.subVectors(lookTargetPos, worldPos).setY(0);
      if (dir.lengthSq() > 0.000001) {
        this.ghostGroup.quaternion.setFromUnitVectors(_Z_NEG, dir.normalize());
      }
    }
    // Érvénytelen (túl közeli) helyen a szellem narancsra vált
    this.ghostMat.color.setHex(isValid ? 0x38bdf8 : 0xf97316);
  }

  hideGhost() {
    this.ghostGroup.visible = false;
  }

  placeAt(worldPos, lookTargetPos) {
    if (this.isAiming) this.endAim(false);
    this.hideGhost();
    this.group.position.copy(worldPos);
    this.targetCastlePos.copy(lookTargetPos);
    this.groundY = worldPos.y;

    // Csúzlitól a vár felé mutató vízszintes irányvektor
    this.dirToCastle.subVectors(lookTargetPos, worldPos).setY(0);
    if (this.dirToCastle.lengthSq() < 0.000001) this.dirToCastle.set(0, 0, -1);
    this.dirToCastle.normalize();
    // Valódi jobb irány (a játékos szemszögéből) – a helyi +X tengellyel egyezik
    this.dirRight.crossVectors(this.dirToCastle, _Y_UP).normalize();

    // A csúzli -Z tengelyét a vár felé fordítjuk
    this.group.quaternion.setFromUnitVectors(_Z_NEG, this.dirToCastle);
    this.group.visible = true;

    // Golyó és fészek visszaállítása nyugalmi állapotba
    this.springOffset.set(0, 0, 0);
    this.springVel.set(0, 0, 0);
    this.reloadT = 1;
    this.aimBall.scale.setScalar(1);
    this.aimBall.position.copy(this.restLocalPos);
    this.pouch.position.copy(this.restLocalPos);
    this.pullHelperRing.position.copy(this.restLocalPos);
    this.trajectoryLine.visible = false;
    this.hitMarkerGroup.visible = false;
    this.update3DBands();
  }

  createModel() {
    this.modelGroup = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3216,
      roughness: 0.75,
      metalness: 0.08
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.35,
      metalness: 0.8
    });

    // 1. Stabil kör alakú nehéz fa talapzat, ami szilárdan ráfekszik az asztalra
    const baseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.072, 0.015, 24),
      woodMat
    );
    baseMesh.position.set(0, 0.008, 0);
    baseMesh.receiveShadow = true;
    baseMesh.castShadow = true;
    this.modelGroup.add(baseMesh);

    // 2. Fő törzs / fogantyú
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.016, this.stemHeight, 16),
      woodMat
    );
    stem.position.set(0, this.stemHeight / 2 + 0.008, 0);
    stem.castShadow = true;
    this.modelGroup.add(stem);

    // 3. Két villa ág
    const forkY = this.stemHeight + 0.008;
    this.leftForkTip = new THREE.Vector3(-this.forkWidth / 2, forkY + this.forkHeight, 0);
    this.rightForkTip = new THREE.Vector3(this.forkWidth / 2, forkY + this.forkHeight, 0);

    const forkGeo = new THREE.CylinderGeometry(0.008, 0.011, this.forkHeight, 14);

    const forkL = new THREE.Mesh(forkGeo, woodMat);
    forkL.position.set(-this.forkWidth / 3.4, forkY + this.forkHeight * 0.46, 0);
    forkL.rotation.z = Math.PI / 6.2;
    forkL.castShadow = true;
    this.modelGroup.add(forkL);

    const forkR = new THREE.Mesh(forkGeo, woodMat);
    forkR.position.set(this.forkWidth / 3.4, forkY + this.forkHeight * 0.46, 0);
    forkR.rotation.z = -Math.PI / 6.2;
    forkR.castShadow = true;
    this.modelGroup.add(forkR);

    // 4. Réz rögzítőgyűrűk a villahegyeken
    const ringGeo = new THREE.TorusGeometry(0.011, 0.003, 12, 16);
    const ringL = new THREE.Mesh(ringGeo, brassMat);
    ringL.position.copy(this.leftForkTip);
    ringL.rotation.y = Math.PI / 2;
    this.modelGroup.add(ringL);

    const ringR = new THREE.Mesh(ringGeo, brassMat);
    ringR.position.copy(this.rightForkTip);
    ringR.rotation.y = Math.PI / 2;
    this.modelGroup.add(ringR);

    this.group.add(this.modelGroup);
  }

  create3DBands() {
    // Valódi térbeli hengeres gumiszalagok, amik 3D-ben nyúlnak
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.5,
      metalness: 0.1
    });

    // 1 egység magas alaphenger, amit skálázunk a hossza alapján
    const bandGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 8);
    bandGeo.translate(0, 0.5, 0); // origó az egyik végpontján

    this.bandLeft = new THREE.Mesh(bandGeo, bandMat);
    this.bandRight = new THREE.Mesh(bandGeo, bandMat);
    this.bandLeft.castShadow = true;
    this.bandRight.castShadow = true;

    this.group.add(this.bandLeft);
    this.group.add(this.bandRight);
  }

  update3DBands() {
    const ballPos = this.aimBall.position;

    // Bal gumi igazítása a villa hegyétől a golyóig
    this.orientBand(this.bandLeft, this.leftForkTip, ballPos);
    // Jobb gumi igazítása
    this.orientBand(this.bandRight, this.rightForkTip, ballPos);

    // Bőrfészek forgatása a húzás irányába
    const pullOffset = _v1.copy(ballPos).sub(this.restLocalPos);
    if (pullOffset.length() > 0.002) {
      pullOffset.normalize();
      this.pouch.quaternion.setFromUnitVectors(_Z_NEG, pullOffset);
      this.pouch.position.copy(ballPos).addScaledVector(pullOffset, 0.006);
    } else {
      this.pouch.quaternion.identity();
      this.pouch.position.copy(ballPos);
      this.pouch.position.z += 0.006;
    }

    this.pullHelperRing.position.copy(ballPos);
  }

  orientBand(bandMesh, startPt, endPt) {
    const dir = _v2.subVectors(endPt, startPt);
    const length = dir.length();
    if (length < 0.001) return;

    bandMesh.position.copy(startPt);
    bandMesh.scale.set(1, length, 1);
    bandMesh.quaternion.setFromUnitVectors(_Y_UP, dir.divideScalar(length));
  }

  // ---------------------------------------------------------------------------
  // EGYSÉGES CÉLZÁSI API – az érintés, a telefonmozgás és a kézkövetés is ezt hívja
  // ---------------------------------------------------------------------------
  beginAim() {
    if (this.isAiming || !this.group.visible) return false;
    this.isAiming = true;
    this.hasPlayedTension = false;
    this.springOffset.set(0, 0, 0);
    this.springVel.set(0, 0, 0);
    this.reloadT = 1;
    this.aimBall.scale.setScalar(1);
    if (this.onAimStateChange) this.onAimStateChange(true);
    this.setPull(0, 0, PULL_LIMITS.minZ);
    return true;
  }

  setPull(pullX, pullY, pullZ) {
    if (!this.isAiming) return;
    const x = THREE.MathUtils.clamp(pullX, -PULL_LIMITS.maxX, PULL_LIMITS.maxX);
    const y = THREE.MathUtils.clamp(pullY, -PULL_LIMITS.maxY, PULL_LIMITS.maxY);
    const z = THREE.MathUtils.clamp(pullZ, PULL_LIMITS.minZ, PULL_LIMITS.maxZ);

    this.aimBall.position.set(
      this.restLocalPos.x + x,
      this.restLocalPos.y + y,
      this.restLocalPos.z + z
    );
    this.update3DBands();
    this.updateTrajectory(x, y, z);

    if (!this.hasPlayedTension && z > 0.012) {
      this.hasPlayedTension = true;
      if (this.onTension) this.onTension();
    }
  }

  // Visszatérési érték: true, ha ténylegesen kilőttük a golyót
  endAim(fire = true) {
    if (!this.isAiming) return false;
    this.isAiming = false;
    this.trajectoryLine.visible = false;
    this.hitMarkerGroup.visible = false;

    const localPull = _v1.copy(this.aimBall.position).sub(this.restLocalPos);
    let launched = false;

    if (fire && localPull.z > PULL_LIMITS.fireZ) {
      this.launch(localPull);
      launched = true;
      // A gumi előrecsapódik, a fészekbe pedig "újratöltődik" egy új golyó
      this.springOffset.copy(localPull).multiplyScalar(-0.35);
      this.springVel.set(0, 0, 0);
      this.reloadT = 0;
      this.aimBall.scale.setScalar(0.001);
    } else {
      // Visszavont lövés: a gumi rugalmasan visszaugrik nyugalmi helyzetbe
      this.springOffset.copy(localPull);
      this.springVel.set(0, 0, 0);
      if (this.onAim) this.onAim(0, null, true);
    }

    if (this.onAimStateChange) this.onAimStateChange(false);
    return launched;
  }

  // Képkockánkénti animáció: rugós gumi, újratöltés, pulzáló fogókarika
  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;

    // Rugós visszacsapódás (csillapított rugó)
    if (!this.isAiming && (this.springOffset.lengthSq() > 1e-8 || this.springVel.lengthSq() > 1e-8)) {
      const k = 320;
      const c = 16;
      this.springVel.addScaledVector(this.springOffset, -k * dt);
      this.springVel.multiplyScalar(Math.max(0, 1 - c * dt));
      this.springOffset.addScaledVector(this.springVel, dt);

      if (this.springOffset.lengthSq() < 1e-8 && this.springVel.lengthSq() < 1e-6) {
        this.springOffset.set(0, 0, 0);
        this.springVel.set(0, 0, 0);
      }
      this.aimBall.position.copy(this.restLocalPos).add(this.springOffset);
      this.update3DBands();
    }

    // Új golyó "kipattan" a fészekben
    if (this.reloadT < 1) {
      this.reloadT = Math.min(1, this.reloadT + dt / 0.35);
      const t = this.reloadT;
      const s = t < 0.3 ? 0.001 : 1 + 2.2 * Math.pow((t - 0.3) / 0.7 - 1, 3) + 1.2 * Math.pow((t - 0.3) / 0.7 - 1, 2);
      this.aimBall.scale.setScalar(Math.max(0.001, s));
    }

    // A fogókarika mindig a kamera felé néz és nyugalomban finoman pulzál
    this.camera.getWorldPosition(_camPos);
    this.pullHelperRing.lookAt(_camPos);
    if (this.isAiming) {
      this.pullHelperRing.scale.setScalar(1);
      this.ringMat.opacity = 0.35;
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      this.pullHelperRing.scale.setScalar(1 + pulse * 0.12);
      this.ringMat.opacity = 0.55 + pulse * 0.35;
    }
  }

  // ---------------------------------------------------------------------------
  // ÉRINTŐ / EGÉR BEMENET (Pointer Events – egységes egér, toll és érintés kezelés)
  // ---------------------------------------------------------------------------
  isUiTarget(target) {
    return !!(target && target.closest && target.closest(
      'button, .modal-backdrop, #phone-motion-container, .hud-header, .hud-footer'
    ));
  }

  isNearBallOnScreen(clientX, clientY, pointerType) {
    const rect = this.domElement.getBoundingClientRect();
    this.aimBall.getWorldPosition(_v1).project(this.camera);
    if (_v1.z > 1) return false; // a kamera mögött van
    const sx = rect.left + (_v1.x + 1) / 2 * rect.width;
    const sy = rect.top + (1 - _v1.y) / 2 * rect.height;
    const radius = pointerType === 'mouse' ? 110 : 160;
    return Math.hypot(clientX - sx, clientY - sy) < radius;
  }

  bindEvents() {
    let activePointerId = null;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e) => {
      if (this.controlMode !== 'TOUCH' || this.isAiming) return;
      if (!e.isPrimary || e.button !== 0) return;
      if (!this.group.visible || this.isUiTarget(e.target)) return;

      const rect = this.domElement.getBoundingClientRect();
      const ndc = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1
      };

      if (!this.grabTargets) {
        this.grabTargets = [this.aimBall, this.pullHelperRing, this.pouch, ...this.modelGroup.children];
      }
      this.raycaster.setFromCamera(ndc, this.camera);
      const hitsSlingshot = this.raycaster.intersectObjects(this.grabTargets, false).length > 0;

      const grabbed = hitsSlingshot
        || this.isNearBallOnScreen(e.clientX, e.clientY, e.pointerType)
        || (this.generousGrab && ndc.y < 0.45);

      if (grabbed && this.beginAim()) {
        activePointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
      }
    };

    const onPointerMove = (e) => {
      if (!this.isAiming || e.pointerId !== activePointerId) return;

      // Kijelző méretaránytól független, 1:1 szimmetrikus húzási skála (nincs ovális torzulás mobilon!)
      const scaleRef = Math.min(window.innerWidth, window.innerHeight, 520);
      const normX = (e.clientX - startX) / scaleRef;
      const normY = (e.clientY - startY) / scaleRef;

      // Hátrahúzás (Z): lefelé húzáskor nő a feszültség
      // Oldalirányú célzás (X): jobbra húzva balra lő – mint egy valódi csúzli
      // Magassági korrekció (Y): lejjebb húzva magasabb ív
      this.setPull(normX * 0.48, -normY * 0.28, normY * 0.65);
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      this.endAim(true);
    };

    const onPointerCancel = (e) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      this.endAim(false);
    };

    // Capture fázis: még az OrbitControls előtt fut le, így célzáskor a kamera nem fordul el
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  calculateWorldVelocity(pullX, pullY, pullZ, target = new THREE.Vector3()) {
    // Hooke rugótörvénye: progresszív, természetes sebesség a hátrahúzás arányában
    const power = Math.min(1.0, pullZ / PULL_LIMITS.fullPowerZ);
    const forwardSpeed = 2.2 + power * 5.2; // 2.2 m/s (finom kis húzás) - 7.4 m/s (kompakt ostromerő)
    const upwardSpeed = 0.45 + power * 2.2 - (pullY / PULL_LIMITS.maxY) * 1.5;
    const sideSpeed = -(pullX / PULL_LIMITS.maxX) * 2.0;

    target.set(0, 0, 0);
    target.addScaledVector(this.dirToCastle, forwardSpeed);
    target.y = upwardSpeed;
    target.addScaledVector(this.dirRight, sideSpeed);

    return target;
  }

  updateTrajectory(pullX, pullY, pullZ) {
    this.trajectoryLine.visible = true;
    this.hitMarkerGroup.visible = true;

    this.aimBall.getWorldPosition(_curr);
    this.calculateWorldVelocity(pullX, pullY, pullZ, _vel);

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    // Pontosan a Cannon fix lépésével és csillapítási képletével számolunk
    const dt = PHYSICS_DT;
    const dampFactor = Math.pow(1 - PROJECTILE_DAMPING, dt);
    // A golyó akkor ér az asztalhoz, amikor a középpontja egy sugárnyira van tőle
    const groundContactY = this.groundY + this.radius;

    let hitFound = false;
    _hitPoint.copy(_curr);
    _hitNormal.set(0, 1, 0);
    let hitTargetName = 'Talaj / Asztal';
    let isCastleHit = false;
    let hitIndex = this.trajectoryPoints - 1;

    // A vár valódi kövei: előre tárolt tömb (nincs allokáció), doboz culling a lag megszüntetésére
    const targetMeshes = this.castle
      ? (this.castle.allTargetMeshes && this.castle.allTargetMeshes.length
          ? this.castle.allTargetMeshes
          : this.castle.blocks)
      : [];
    const castleBox = this.castle ? this.castle.castleBounds : null;
    const hasCastleBounds = castleBox && !castleBox.isEmpty();

    for (let i = 0; i < this.trajectoryPoints; i++) {
      positions[i * 3] = _curr.x;
      positions[i * 3 + 1] = _curr.y;
      positions[i * 3 + 2] = _curr.z;

      // Cannon-hű lépés: csillapítás -> gravitáció -> pozíció (szemi-implicit Euler)
      _vel.multiplyScalar(dampFactor);
      _vel.y += GRAVITY * dt;
      _next.copy(_curr).addScaledVector(_vel, dt);

      // 1. TŰPONTOS KŐÜTKÖZÉS: AABB doboz előszűréssel (csak a vár közelében lévő lépéseknél raycastolunk)
      if (targetMeshes.length > 0) {
        let testRaycast = true;
        if (hasCastleBounds) {
          _segBox.setFromPoints([_curr, _next]);
          testRaycast = castleBox.intersectsBox(_segBox);
        }

        if (testRaycast) {
          _seg.subVectors(_next, _curr);
          const segDist = _seg.length();

          if (segDist > 0.0001) {
            this.trajRaycaster.set(_curr, _seg.divideScalar(segDist));
            this.trajRaycaster.far = segDist;

            const intersects = this.trajRaycaster.intersectObjects(targetMeshes, false);
            if (intersects.length > 0) {
              const hit = intersects[0];
              hitFound = true;
              hitIndex = i + 1;
              _hitPoint.copy(hit.point);

              if (hit.face) {
                _hitNormal.copy(hit.face.normal).applyQuaternion(hit.object.quaternion).normalize();
              }

              isCastleHit = hit.object.userData.isCastleBlock === true;
              hitTargetName = isCastleHit ? '🏰 Várfal kőtömb' : 'Kőtalapzat';
              break;
            }
          }
        }
      }

      // 2. Becsapódás vizsgálata a valódi asztal lapjával
      if (_next.y <= groundContactY) {
        hitFound = true;
        hitIndex = i + 1;

        // Pontos sík-metszéspont interpolálása
        const dyTotal = _next.y - _curr.y;
        const alpha = Math.abs(dyTotal) > 0.0001
          ? THREE.MathUtils.clamp((groundContactY - _curr.y) / dyTotal, 0, 1)
          : 0;

        _hitPoint.set(
          _curr.x + (_next.x - _curr.x) * alpha,
          this.groundY + 0.002,
          _curr.z + (_next.z - _curr.z) * alpha
        );
        _hitNormal.set(0, 1, 0);
        hitTargetName = 'Asztal lapja';
        isCastleHit = false;
        break;
      }

      _curr.copy(_next);
    }

    // A trajektória vonal pontosan a becsapódási pontig tart
    if (hitFound && hitIndex < this.trajectoryPoints) {
      positions[hitIndex * 3] = _hitPoint.x;
      positions[hitIndex * 3 + 1] = _hitPoint.y;
      positions[hitIndex * 3 + 2] = _hitPoint.z;
    }
    const drawCount = hitFound ? Math.min(hitIndex + 1, this.trajectoryPoints) : this.trajectoryPoints;
    this.trajectoryLine.geometry.setDrawRange(0, drawCount);
    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;

    // Röppálya színének dinamikus változása az erő mértékében
    const power = Math.min(1.0, pullZ / PULL_LIMITS.fullPowerZ);
    const trajColor = power > 0.75 ? 0xef4444 : (power > 0.4 ? 0xf59e0b : 0x38bdf8);
    this.trajMaterial.color.setHex(trajColor);

    // Taktikai célkereszt pozicionálása és felületre simítása
    this.hitMarkerGroup.visible = hitFound;
    this.hitMarkerGroup.position.copy(_hitPoint).addScaledVector(_hitNormal, 0.003);
    this.hitMarkerGroup.quaternion.setFromUnitVectors(_Z_POS, _hitNormal);
    // Célkereszt színezése: piros, ha közvetlen vártalálat, kék, ha asztalfelület
    this.hitMarkerMat.color.setHex(isCastleHit ? 0xef4444 : 0x38bdf8);

    // Célzási előrehaladás visszajelzése a HUD felületre
    if (this.onAim) {
      this.onAim(Math.round(power * 100), hitTargetName, false);
    }
  }

  launch(localPull) {
    // Túl sok egyidejű lövedék esetén a legrégebbit eltávolítjuk (stabil fizikai teljesítmény)
    while (this.projectiles.length >= MAX_PROJECTILES) {
      this.removeProjectile(0);
    }

    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(localPull.x, localPull.y, localPull.z);

    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    mesh.castShadow = true;
    mesh.position.copy(worldStart);
    this.scene.add(mesh);

    const body = this.physics.addSphere(mesh, worldStart, this.radius, 1.15);
    body.velocity.set(worldVel.x, worldVel.y, worldVel.z);

    // FONTOS STABILITÁSI JAVÍTÁS:
    // A vár kizárólag akkor ébred fel, ha a lövedék TÉNYLEGESEN egy várkövet talál el.
    // Mellélövéskor (asztal / talapzat) csak a becsapódási effekt fut, a vár állva marad.
    let impactFxDone = false;
    let castleHit = false;
    body.addEventListener('collide', (event) => {
      const other = event.body;
      if (!other || other.isProjectile) return;

      const impactPoint = new THREE.Vector3(body.position.x, body.position.y, body.position.z);

      // Becsapódási hang és részecskék indítása (lövedékenként egyszer)
      if (!impactFxDone) {
        impactFxDone = true;
        if (this.onImpact) this.onImpact(impactPoint, other.isCastleBlock === true);
      }

      if (!other.isCastleBlock || castleHit) return;
      castleHit = true;

      // Kőtömbök aktiválása
      this.physics.wakeUpNear(impactPoint, 0.35);

      // Kinetikus energia és impulzus átadása a közvetlenül eltalált merevtestnek
      const v = body.velocity;
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 0.03) {
        const impulseMagnitude = 0.45 / speed;
        other.applyImpulse(
          new Vec3(v.x * impulseMagnitude, v.y * impulseMagnitude, v.z * impulseMagnitude),
          new Vec3(impactPoint.x, impactPoint.y, impactPoint.z)
        );
      }
    });

    this.projectiles.push({ mesh, body, createdAt: performance.now() });

    if (this.onShoot) {
      this.onShoot();
    }
  }

  removeProjectile(index) {
    const p = this.projectiles[index];
    this.physics.removeObject(p.mesh);
    this.scene.remove(p.mesh);
    this.projectiles.splice(index, 1);
  }

  cleanOldProjectiles() {
    const now = performance.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      // Repülő lövedék parázscsóvája
      if (this.effects && p.body.velocity.lengthSquared() > 0.4) {
        this.effects.createTrail(p.mesh.position);
      }
      // Lejárt vagy az asztalról leesett lövedékek eltávolítása
      if (now - p.createdAt > PROJECTILE_LIFETIME_MS || p.body.position.y < this.groundY - 1.5) {
        this.removeProjectile(i);
      }
    }
  }

  clearAllProjectiles() {
    for (const p of this.projectiles) {
      this.physics.removeObject(p.mesh);
      this.scene.remove(p.mesh);
    }
    this.projectiles = [];
  }
}
