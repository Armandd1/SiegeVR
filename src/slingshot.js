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

    // Kiszámoljuk a csúzlitól a vár felé mutató vízszintes világvektort
    this.dirToCastle = new THREE.Vector3().subVectors(lookTargetPos, worldPos).setY(0).normalize();
    this.dirRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.dirToCastle).normalize();

    // A csúzli elforgatása a vár felé: a -Z helyi tengelyt a dirToCastle irányába állítjuk
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.dirToCastle);
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
    let startScreenPos = { x: 0, y: 0 };

    const getPos = (e) => {
      const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      return { x: cx, y: cy };
    };

    const onStart = (e) => {
      if (e.target.closest('#ui-overlay button')) return;
      if (!this.group.visible) return;

      const p = getPos(e);
      const rect = this.domElement.getBoundingClientRect();
      const ndc = {
        x: ((p.x - rect.left) / rect.width) * 2 - 1,
        y: -((p.y - rect.top) / rect.height) * 2 + 1
      };

      this.raycaster.setFromCamera(ndc, this.camera);
      // Megvizsgáljuk, hogy az ujj a csúzli golyóját vagy a célzó karikát érinti-e
      const intersects = this.raycaster.intersectObjects([this.aimBall, this.pullHelperRing, ...this.modelGroup.children]);

      // Ha rábök a csúzlira vagy a képernyő alsó felére a csúzli közelében
      if (intersects.length > 0 || ndc.y < 0.3) {
        this.isAiming = true;
        startScreenPos = { x: p.x, y: p.y };
        this.trajectoryLine.visible = true;
        this.hitMarker.visible = true;
      }
    };

    const onMove = (e) => {
      if (!this.isAiming) return;
      const p = getPos(e);

      // Képernyő elmozdulás
      const dx = (p.x - startScreenPos.x) / window.innerWidth;
      const dy = (p.y - startScreenPos.y) / window.innerHeight;

      // Szabad 3D célzás:
      // dy > 0: hátrahúzzuk a golyót maga felé (+Z) és lefelé (-Y a magasabb röppályáért)
      // dx: oldalra feszítjük a csúzlit (-X / +X)
      const pullZ = Math.max(0.01, Math.min(0.20, dy * 0.5)); // 20 cm max feszítés
      const pullX = Math.max(-0.12, Math.min(0.12, dx * 0.35));
      const pullY = Math.max(-0.08, Math.min(0.08, -dy * 0.25));

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

      // Visszaáll nyugalmi helyzetbe
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

  calculateWorldVelocity(pullX, pullY, pullZ) {
    // Ha még nem definiált, kiszámoljuk
    if (!this.dirToCastle) {
      this.dirToCastle = new THREE.Vector3(0, 0, -1);
      this.dirRight = new THREE.Vector3(1, 0, 0);
    }

    // Sebesség méretezés a kompakt asztali pályához (kb. 3.5 - 6.5 m/s)
    const forwardForce = Math.max(1.8, pullZ * 32.0);
    const verticalForce = Math.max(0.7, pullZ * 10.0 - pullY * 16.0);
    const sideForce = -pullX * 16.0; // ellenkező oldalra feszítés

    const vel = new THREE.Vector3();
    vel.addScaledVector(this.dirToCastle, forwardForce); // FŐ VEKTOR: EGYENESEN A VÁR FELÉ
    vel.y = verticalForce;                               // EMELKEDŐ PARABOLA ÍV
    vel.addScaledVector(this.dirRight, sideForce);       // OLDALIRÁNYÚ KORREKCIÓ

    return vel;
  }

  updateTrajectory(pullX, pullY, pullZ) {
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(pullX, pullY, pullZ);

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const dt = 0.035;
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

    this.hitMarker.position.copy(curr);
    this.hitMarker.lookAt(this.camera.position);
  }

  launch(localPull) {
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(localPull.x, localPull.y, localPull.z);

    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat.clone());
    mesh.castShadow = true;
    mesh.position.copy(worldStart);
    this.scene.add(mesh);

    const body = this.physics.addSphere(mesh, worldStart, this.radius, 0.6);
    body.velocity.set(worldVel.x, worldVel.y, worldVel.z);

    // Felébresztjük a vár összeragasztott blokkjait, így a becsapódás azonnal ledönti őket!
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
