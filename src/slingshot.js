import * as THREE from 'three';

export class Slingshot {
  constructor(scene, physics, camera, domElement, onShoot) {
    this.scene = scene;
    this.physics = physics;
    this.camera = camera;
    this.domElement = domElement;
    this.onShoot = onShoot;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.isAiming = false;
    this.targetCastlePos = new THREE.Vector3(0, 0, 0);

    // Kompakt Asztali Méretek (15 cm csúzli magasság)
    this.stemHeight = 0.14;
    this.forkWidth = 0.09;
    this.restLocalPos = new THREE.Vector3(0, this.stemHeight + 0.02, 0);

    this.radius = 0.026; // 5.2 cm átmérőjű lövedék
    this.sphereGeo = new THREE.SphereGeometry(this.radius, 24, 24);
    this.projectileMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xd97706,
      emissiveIntensity: 0.6
    });

    // Célzó golyó
    this.aimBall = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    this.aimBall.position.copy(this.restLocalPos);
    this.aimBall.castShadow = true;
    this.group.add(this.aimBall);

    // Kézfogó / Célzó karika (hogy egyértelmű legyen, hol kell megfogni az ujjal)
    const ringGeo = new THREE.RingGeometry(0.038, 0.045, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.pullHelperRing = new THREE.Mesh(ringGeo, ringMat);
    this.pullHelperRing.position.copy(this.restLocalPos);
    this.group.add(this.pullHelperRing);

    // Csúzli fa modell
    this.createModel();

    // Rugalmas gumiszalagok
    this.createBands();

    // 3D Röppálya trajektória (vastag, világító pontozott ív)
    this.trajectoryPoints = 40;
    const trajGeo = new THREE.BufferGeometry();
    const trajPositions = new Float32Array(this.trajectoryPoints * 3);
    trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
    this.trajectoryLine = new THREE.Line(
      trajGeo,
      new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.03,
        gapSize: 0.02,
        linewidth: 4
      })
    );
    this.trajectoryLine.visible = false;
    this.scene.add(this.trajectoryLine);

    // Becsapódási céljelző a váron
    const hitMarkerGeo = new THREE.RingGeometry(0.025, 0.035, 24);
    const hitMarkerMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
    this.hitMarker = new THREE.Mesh(hitMarkerGeo, hitMarkerMat);
    this.hitMarker.visible = false;
    this.scene.add(this.hitMarker);

    this.projectiles = [];
    this.raycaster = new THREE.Raycaster();

    this.bindEvents();
  }

  placeAt(worldPos, lookTargetPos) {
    this.group.position.copy(worldPos);
    this.targetCastlePos.copy(lookTargetPos);

    // A csúzlit a vár felé fordítjuk
    this.group.lookAt(lookTargetPos.x, worldPos.y, lookTargetPos.z);
    this.group.visible = true;

    // Visszaállítjuk a golyót
    this.aimBall.position.copy(this.restLocalPos);
    this.pullHelperRing.position.copy(this.restLocalPos);
    this.updateBands();
  }

  createModel() {
    this.modelGroup = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.85,
      metalness: 0.05
    });

    // Fő szár
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.016, this.stemHeight, 16),
      woodMat
    );
    stem.position.set(0, this.stemHeight / 2, 0);
    stem.castShadow = true;
    this.modelGroup.add(stem);

    // Két villa ág
    const forkH = 0.07;
    this.leftFork = new THREE.Vector3(-this.forkWidth / 2, this.stemHeight + forkH * 0.75, 0);
    this.rightFork = new THREE.Vector3(this.forkWidth / 2, this.stemHeight + forkH * 0.75, 0);

    const forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, forkH, 12), woodMat);
    forkL.position.set(-this.forkWidth / 3.6, this.stemHeight + forkH * 0.45, 0);
    forkL.rotation.z = Math.PI / 6;
    forkL.castShadow = true;
    this.modelGroup.add(forkL);

    const forkR = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, forkH, 12), woodMat);
    forkR.position.set(this.forkWidth / 3.6, this.stemHeight + forkH * 0.45, 0);
    forkR.rotation.z = -Math.PI / 6;
    forkR.castShadow = true;
    this.modelGroup.add(forkR);

    this.group.add(this.modelGroup);
  }

  createBands() {
    const bandMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 });

    const bandLGeo = new THREE.BufferGeometry().setFromPoints([this.leftFork, this.aimBall.position]);
    this.bandLeft = new THREE.Line(bandLGeo, bandMat);

    const bandRGeo = new THREE.BufferGeometry().setFromPoints([this.rightFork, this.aimBall.position]);
    this.bandRight = new THREE.Line(bandRGeo, bandMat);

    this.group.add(this.bandLeft);
    this.group.add(this.bandRight);
  }

  updateBands() {
    this.bandLeft.geometry.setFromPoints([this.leftFork, this.aimBall.position]);
    this.bandRight.geometry.setFromPoints([this.rightFork, this.aimBall.position]);
    this.pullHelperRing.position.copy(this.aimBall.position);
  }

  bindEvents() {
    let startY = 0;
    let startX = 0;

    const getPos = (e) => {
      const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      return { x: cx, y: cy };
    };

    const onStart = (e) => {
      if (e.target.closest('#ui-overlay button')) return;
      if (!this.group.visible) return;

      const p = getPos(e);
      startX = p.x;
      startY = p.y;

      // Érintés vizsgálat
      this.isAiming = true;
      this.trajectoryLine.visible = true;
      this.hitMarker.visible = true;
    };

    const onMove = (e) => {
      if (!this.isAiming) return;
      const p = getPos(e);

      // Képernyő húzás: deltaY (hátrahúzás), deltaX (oldalra célzás)
      const dy = (p.y - startY) / window.innerHeight;
      const dx = (p.x - startX) / window.innerWidth;

      // Helyi csúzli koordinátában a +Z a hátrahúzás iránya (a vár -Z-ben van!)
      const pullZ = Math.max(0, Math.min(0.25, dy * 0.7)); // max 25 cm húzás
      const pullX = Math.max(-0.1, Math.min(0.1, dx * 0.3));
      const pullY = -pullZ * 0.2; // kicsit lefelé feszül a gumi

      this.aimBall.position.set(
        this.restLocalPos.x + pullX,
        this.restLocalPos.y + pullY,
        this.restLocalPos.z + pullZ
      );

      this.updateBands();
      this.updateTrajectory(pullX, pullY, pullZ);
    };

    const onEnd = () => {
      if (!this.isAiming) return;
      this.isAiming = false;
      this.trajectoryLine.visible = false;
      this.hitMarker.visible = false;

      const localPull = this.aimBall.position.clone().sub(this.restLocalPos);
      if (localPull.z > 0.02) {
        this.launch(localPull);
      }

      // Visszaugrik a golyó a csúzlira
      this.aimBall.position.copy(this.restLocalPos);
      this.updateBands();
    };

    window.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  }

  updateTrajectory(pullX, pullY, pullZ) {
    // Kezdőpont a világban
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());

    // Kilövési sebességvektor:
    // A csúzli helyi terében a -Z tengely mutat a vár felé!
    const force = Math.max(0.5, pullZ) * 26.0;
    const localVel = new THREE.Vector3(
      -pullX * 20.0,
      pullZ * 8.0 + 1.2, // szép emelkedő ív
      -force
    );

    // Átforgatjuk a sebességet a csúzli világforgásával
    const worldVel = localVel.clone().applyQuaternion(this.group.quaternion);

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const dt = 0.025;
    const g = -9.82;

    let curr = worldStart.clone();
    let vel = worldVel.clone();

    for (let i = 0; i < this.trajectoryPoints; i++) {
      positions[i * 3] = curr.x;
      positions[i * 3 + 1] = curr.y;
      positions[i * 3 + 2] = curr.z;

      curr.x += vel.x * dt;
      curr.y += vel.y * dt + 0.5 * g * dt * dt;
      curr.z += vel.z * dt;
      vel.y += g * dt;
    }

    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
    this.trajectoryLine.computeLineDistances();

    // Célkereszt pozícionálása az ív végéhez közel
    this.hitMarker.position.copy(curr);
    this.hitMarker.lookAt(this.camera.position);
  }

  launch(localPull) {
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const force = Math.max(0.5, localPull.z) * 26.0;
    const localVel = new THREE.Vector3(
      -localPull.x * 20.0,
      localPull.z * 8.0 + 1.2,
      -force
    );
    const worldVel = localVel.clone().applyQuaternion(this.group.quaternion);

    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat.clone());
    mesh.castShadow = true;
    mesh.position.copy(worldStart);
    this.scene.add(mesh);

    const body = this.physics.addSphere(mesh, worldStart, this.radius, 0.8);
    body.velocity.set(worldVel.x, worldVel.y, worldVel.z);

    // Felébresztjük a vár blokkjait, hogy azonnal reagáljanak a fizikai becsapódásra
    this.physics.wakeUpAllBlocks();

    this.projectiles.push({ mesh, body, createdAt: Date.now() });

    if (this.onShoot) {
      this.onShoot();
    }
  }

  cleanOldProjectiles() {
    const now = Date.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (now - p.createdAt > 6000) {
        this.physics.removeObject(p.mesh);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
