import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Slingshot {
  constructor(scene, physics, camera, domElement, onShoot) {
    this.scene = scene;
    this.physics = physics;
    this.camera = camera;
    this.domElement = domElement;
    this.onShoot = onShoot;

    this.isAiming = false;
    this.restPosition = new THREE.Vector3(0, 0.8, 1.5);
    this.currentPosition = this.restPosition.clone();
    this.pullVector = new THREE.Vector3();

    this.projectiles = [];

    // Lövedék geometria és anyag
    this.radius = 0.22;
    this.sphereGeo = new THREE.SphereGeometry(this.radius, 32, 32);
    this.projectileMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Lángoló narancs/arany
      roughness: 0.3,
      metalness: 0.8,
      emissive: 0xd97706,
      emissiveIntensity: 0.4
    });

    // Nyugalmi lövedék (célzó golyó)
    this.aimBall = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    this.aimBall.position.copy(this.restPosition);
    this.aimBall.castShadow = true;
    this.scene.add(this.aimBall);

    // Csúzli talapzat és karok
    this.createSlingshotModel();

    // Célzó trajektória vonal (pontozott ív)
    this.trajectoryPoints = 30;
    const trajGeo = new THREE.BufferGeometry();
    const trajPositions = new Float32Array(this.trajectoryPoints * 3);
    trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
    this.trajectoryLine = new THREE.Line(
      trajGeo,
      new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.1,
        gapSize: 0.05,
        linewidth: 2
      })
    );
    this.trajectoryLine.visible = false;
    this.scene.add(this.trajectoryLine);

    // Kötél vonalak (bal és jobb gumi)
    this.createBands();

    // Raycaster és érintéskezelő
    this.raycaster = new THREE.Raycaster();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.restPosition.z);
    this.planeIntersect = new THREE.Vector3();

    this.bindEvents();
  }

  createSlingshotModel() {
    this.baseGroup = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.8 });
    
    // Oszlop
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.8), woodMat);
    stem.position.set(0, 0.4, this.restPosition.z);
    stem.castShadow = true;
    this.baseGroup.add(stem);

    // Bal és jobb szarv (villa)
    this.leftFork = new THREE.Vector3(-0.35, 0.9, this.restPosition.z);
    this.rightFork = new THREE.Vector3(0.35, 0.9, this.restPosition.z);

    const forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4), woodMat);
    forkL.position.set(-0.2, 0.85, this.restPosition.z);
    forkL.rotation.z = Math.PI / 6;
    this.baseGroup.add(forkL);

    const forkR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4), woodMat);
    forkR.position.set(0.2, 0.85, this.restPosition.z);
    forkR.rotation.z = -Math.PI / 6;
    this.baseGroup.add(forkR);

    this.scene.add(this.baseGroup);
  }

  createBands() {
    const bandMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 });

    const bandLeftGeo = new THREE.BufferGeometry().setFromPoints([this.leftFork, this.aimBall.position]);
    this.bandLeft = new THREE.Line(bandLeftGeo, bandMat);

    const bandRightGeo = new THREE.BufferGeometry().setFromPoints([this.rightFork, this.aimBall.position]);
    this.bandRight = new THREE.Line(bandRightGeo, bandMat);

    this.scene.add(this.bandLeft);
    this.scene.add(this.bandRight);
  }

  updateBands() {
    this.bandLeft.geometry.setFromPoints([this.leftFork, this.aimBall.position]);
    this.bandRight.geometry.setFromPoints([this.rightFork, this.aimBall.position]);
  }

  bindEvents() {
    const getPointerPos = (e) => {
      const rect = this.domElement.getBoundingClientRect();
      const clientX = e.clientX ?? e.touches?.[0]?.clientX;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY;
      return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1
      };
    };

    const onPointerDown = (e) => {
      if (e.target.closest('#ui-overlay button')) return;
      const pos = getPointerPos(e);
      this.raycaster.setFromCamera(pos, this.camera);
      const intersects = this.raycaster.intersectObject(this.aimBall);

      if (intersects.length > 0 || (pos.y < -0.1 && Math.abs(pos.x) < 0.4)) {
        this.isAiming = true;
        this.trajectoryLine.visible = true;
      }
    };

    const onPointerMove = (e) => {
      if (!this.isAiming) return;
      const pos = getPointerPos(e);
      this.raycaster.setFromCamera(pos, this.camera);

      // Metsszük egy síkkal a csúzli körül
      const hit = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.dragPlane, hit);

      if (hit) {
        // Korlátozzuk a húzás mértékét
        const delta = hit.clone().sub(this.restPosition);
        delta.z = Math.max(0, -delta.y * 0.5); // ahogy lehúzzuk, kicsit magunk felé is húzódik
        delta.clampLength(0, 1.2); // max húzás

        this.aimBall.position.copy(this.restPosition).add(delta);
        this.updateBands();
        this.updateTrajectory();
      }
    };

    const onPointerUp = () => {
      if (!this.isAiming) return;
      this.isAiming = false;
      this.trajectoryLine.visible = false;

      // Lövedék kilövése
      const pull = this.restPosition.clone().sub(this.aimBall.position);
      if (pull.length() > 0.15) {
        this.launch(pull);
      }

      // Csúzli golyó visszaugrik a helyére
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
    const pull = this.restPosition.clone().sub(this.aimBall.position);
    const forceMultiplier = 16.0;
    const velocity = new THREE.Vector3(
      pull.x * forceMultiplier,
      pull.y * forceMultiplier * 0.8 + 2.0,
      pull.z * forceMultiplier - pull.length() * 12.0
    );

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const dt = 0.04;
    const g = -9.82;
    let curr = this.restPosition.clone();
    let vel = velocity.clone();

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

  launch(pull) {
    const forceMultiplier = 18.0;
    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat.clone());
    mesh.castShadow = true;
    mesh.position.copy(this.aimBall.position);
    this.scene.add(mesh);

    const body = this.physics.addSphere(mesh, this.radius, 8.0);
    body.velocity.set(
      pull.x * forceMultiplier,
      pull.y * forceMultiplier * 0.8 + 2.0,
      pull.z * forceMultiplier - pull.length() * 14.0
    );

    this.projectiles.push({ mesh, body, createdAt: Date.now() });

    if (this.onShoot) {
      this.onShoot();
    }
  }

  cleanOldProjectiles() {
    const now = Date.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      // 8 másodperc után töröljük a régi golyókat a memóriából
      if (now - p.createdAt > 8000) {
        this.physics.removeObject(p.mesh);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
