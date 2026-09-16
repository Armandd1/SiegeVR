import * as THREE from 'three';

export class Slingshot {
  constructor(group, physics, camera, domElement, onShoot) {
    this.group = group;       // A csúzli saját Three.js csoportja az asztalon
    this.physics = physics;
    this.camera = camera;
    this.domElement = domElement;
    this.onShoot = onShoot;

    this.isAiming = false;

    // Kompakt Asztali Méretek (méterben: ~15 cm magas csúzli)
    this.stemHeight = 0.12;
    this.forkWidth = 0.08;
    this.restPosition = new THREE.Vector3(0, this.stemHeight + 0.02, 0); // nyugalmi pozíció a helyi koordinátákban
    this.currentPosition = this.restPosition.clone();
    this.pullVector = new THREE.Vector3();

    this.projectiles = [];

    // Lövedék geometria és anyag (kis kő / tűzgolyó: 5 cm átmérő)
    this.radius = 0.025;
    this.sphereGeo = new THREE.SphereGeometry(this.radius, 24, 24);
    this.projectileMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0xd97706,
      emissiveIntensity: 0.5
    });

    // Célzó golyó a csúzlira feszítve
    this.aimBall = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    this.aimBall.position.copy(this.restPosition);
    this.aimBall.castShadow = true;
    this.group.add(this.aimBall);

    // Csúzli fa ág modell felépítése
    this.createSlingshotModel();

    // Célzó trajektória vonal (pontozott kék ív)
    this.trajectoryPoints = 35;
    const trajGeo = new THREE.BufferGeometry();
    const trajPositions = new Float32Array(this.trajectoryPoints * 3);
    trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
    this.trajectoryLine = new THREE.Line(
      trajGeo,
      new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.03,
        gapSize: 0.015,
        linewidth: 3
      })
    );
    this.trajectoryLine.visible = false;
    // A trajektóriát a jelenetbe vagy a csúzli csoportba helyezzük
    this.group.add(this.trajectoryLine);

    // Két rugalmas gumiszalag
    this.createBands();

    // Raycaster és érintéskezelő sík
    this.raycaster = new THREE.Raycaster();
    this.bindEvents();
  }

  createSlingshotModel() {
    this.modelGroup = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.85,
      metalness: 0.05
    });

    // Törzs
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.016, this.stemHeight, 16),
      woodMat
    );
    stem.position.set(0, this.stemHeight / 2, 0);
    stem.castShadow = true;
    this.modelGroup.add(stem);

    // Bal és jobb villa ág (szarv)
    const forkH = 0.06;
    this.leftFork = new THREE.Vector3(-this.forkWidth / 2, this.stemHeight + forkH * 0.8, 0);
    this.rightFork = new THREE.Vector3(this.forkWidth / 2, this.stemHeight + forkH * 0.8, 0);

    const forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, forkH, 12), woodMat);
    forkL.position.set(-this.forkWidth / 3.5, this.stemHeight + forkH * 0.45, 0);
    forkL.rotation.z = Math.PI / 6;
    forkL.castShadow = true;
    this.modelGroup.add(forkL);

    const forkR = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, forkH, 12), woodMat);
    forkR.position.set(this.forkWidth / 3.5, this.stemHeight + forkH * 0.45, 0);
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
  }

  bindEvents() {
    let startScreenPos = { x: 0, y: 0 };
    let currentScreenPos = { x: 0, y: 0 };

    const getTouchOrMouse = (e) => {
      const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      return { x: clientX, y: clientY };
    };

    const onPointerDown = (e) => {
      if (e.target.closest('#ui-overlay button')) return;
      if (!this.group.visible) return;

      const p = getTouchOrMouse(e);
      startScreenPos = { ...p };
      currentScreenPos = { ...p };

      // Raycast vizsgálat az aimBall-ra vagy a csúzli környékére
      const rect = this.domElement.getBoundingClientRect();
      const ndc = {
        x: ((p.x - rect.left) / rect.width) * 2 - 1,
        y: -((p.y - rect.top) / rect.height) * 2 + 1
      };
      this.raycaster.setFromCamera(ndc, this.camera);
      const intersects = this.raycaster.intersectObjects([this.aimBall, ...this.modelGroup.children]);

      // Ha eltalálta a csúzlit VAGY a képernyő alsó felén húzza
      if (intersects.length > 0 || ndc.y < 0.2) {
        this.isAiming = true;
        this.trajectoryLine.visible = true;
      }
    };

    const onPointerMove = (e) => {
      if (!this.isAiming) return;
      currentScreenPos = getTouchOrMouse(e);

      // Kiszámoljuk az elhúzás mértékét képernyő pixelben
      const deltaX = (currentScreenPos.x - startScreenPos.x) / window.innerWidth;
      const deltaY = (currentScreenPos.y - startScreenPos.y) / window.innerHeight;

      // Helyi koordinátában: deltaY húzza hátra a golyót (+Z tengely felé), deltaX mozgatja oldalra
      const maxPull = 0.25; // maximum 25 cm hátrahúzás
      const pullZ = Math.max(0, deltaY * 0.8);
      const pullX = deltaX * 0.4;
      const pullY = -deltaY * 0.15; // kicsit lefelé is húzódik

      const clampedPullZ = Math.min(pullZ, maxPull);
      const clampedPullX = Math.max(-0.15, Math.min(0.15, pullX));

      this.aimBall.position.set(
        this.restPosition.x + clampedPullX,
        this.restPosition.y + pullY,
        this.restPosition.z + clampedPullZ
      );

      this.updateBands();
      this.updateTrajectory();
    };

    const onPointerUp = () => {
      if (!this.isAiming) return;
      this.isAiming = false;
      this.trajectoryLine.visible = false;

      // Kilövési erő kiszámítása
      const localPull = this.aimBall.position.clone().sub(this.restPosition);
      if (localPull.z > 0.03) {
        this.launch(localPull);
      }

      // Visszaállás
      this.aimBall.position.copy(this.restPosition);
      this.updateBands();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    window.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);
  }

  updateTrajectory() {
    // A golyó helyi koordinátájának eltérése a nyugalmi állapottól
    const localPull = this.aimBall.position.clone().sub(this.restPosition);

    // A kilövés előre (-Z helyi irányba) és kicsit felfelé (+Y) történik
    const forceMultiplier = 28.0;
    const localVel = new THREE.Vector3(
      -localPull.x * forceMultiplier,
      -localPull.y * forceMultiplier * 0.5 + localPull.z * 12.0,
      -localPull.z * forceMultiplier
    );

    // Trajektória pontok számítása a csúzli helyi koordinátarendszerében
    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const dt = 0.03;
    const g = -9.82;

    let curr = this.aimBall.position.clone();
    let vel = localVel.clone();

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
  }

  launch(localPull) {
    const forceMultiplier = 28.0;
    const localVel = new THREE.Vector3(
      -localPull.x * forceMultiplier,
      -localPull.y * forceMultiplier * 0.5 + localPull.z * 12.0,
      -localPull.z * forceMultiplier
    );

    // Áttranszformáljuk a kezdőpozíciót és a sebességvektort a világkoordinátákba!
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = localVel.clone().applyQuaternion(this.group.quaternion);

    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat.clone());
    mesh.castShadow = true;
    mesh.position.copy(worldStart);
    // A kilőtt golyót a globális színtérhez adjuk, hogy független legyen a csúzlitól
    this.group.parent.add(mesh);

    const body = this.physics.addSphere(mesh, this.radius, 0.8);
    body.position.set(worldStart.x, worldStart.y, worldStart.z);
    body.velocity.set(worldVel.x, worldVel.y, worldVel.z);

    this.projectiles.push({ mesh, body, createdAt: Date.now() });

    if (this.onShoot) {
      this.onShoot();
    }
  }

  cleanOldProjectiles() {
    const now = Date.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (now - p.createdAt > 7000) {
        this.physics.removeObject(p.mesh);
        p.mesh.parent?.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
