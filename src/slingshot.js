import * as THREE from 'three';

export class Slingshot {
  constructor(scene, physics, camera, domElement, onShoot, onImpact, onTension) {
    this.scene = scene;
    this.physics = physics;
    this.camera = camera;
    this.domElement = domElement;
    this.onShoot = onShoot;
    this.onImpact = onImpact;
    this.onTension = onTension;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.isAiming = false;
    this.targetCastlePos = new THREE.Vector3(0, 0, 0);

    // Kompakt Asztali Méretek (kb. 16 cm magas fa ostrom csúzli)
    this.stemHeight = 0.13;
    this.forkWidth = 0.095;
    this.forkHeight = 0.075;
    this.restLocalPos = new THREE.Vector3(0, this.stemHeight + this.forkHeight * 0.45, 0);

    this.radius = 0.024; // 4.8 cm átmérőjű lövedék
    this.sphereGeo = new THREE.SphereGeometry(this.radius, 24, 24);
    
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
    const pouchGeo = new THREE.BoxGeometry(0.045, 0.035, 0.012);
    const pouchMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.9 });
    this.pouch = new THREE.Mesh(pouchGeo, pouchMat);
    this.pouch.position.copy(this.restLocalPos);
    this.pouch.castShadow = true;
    this.group.add(this.pouch);

    // Kézfogó / Célzó karika pulzáló világítással
    const ringGeo = new THREE.RingGeometry(0.035, 0.044, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.pullHelperRing = new THREE.Mesh(ringGeo, ringMat);
    this.pullHelperRing.position.copy(this.restLocalPos);
    this.group.add(this.pullHelperRing);

    // Csúzli modell (faragott fa + masszív talapzat + réz rögzítők)
    this.createModel();

    // Valódi 3D gumiszalagok (a hajszálvékony 1px drótok helyett)
    this.create3DBands();

    // 3D Röppálya trajektória
    this.trajectoryPoints = 45;
    const trajGeo = new THREE.BufferGeometry();
    const trajPositions = new Float32Array(this.trajectoryPoints * 3);
    trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
    this.trajectoryLine = new THREE.Line(
      trajGeo,
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85
      })
    );
    this.trajectoryLine.visible = false;
    this.scene.add(this.trajectoryLine);

    // Pontos becsapódási célkereszt
    const hitMarkerGeo = new THREE.RingGeometry(0.022, 0.034, 32);
    const hitMarkerMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    this.hitMarker = new THREE.Mesh(hitMarkerGeo, hitMarkerMat);
    this.hitMarker.visible = false;
    this.scene.add(this.hitMarker);

    this.projectiles = [];
    this.raycaster = new THREE.Raycaster();
    this.groundY = 0;

    this.bindEvents();
  }

  placeAt(worldPos, lookTargetPos) {
    this.group.position.copy(worldPos);
    this.targetCastlePos.copy(lookTargetPos);
    this.groundY = worldPos.y;

    // Csúzlitól a vár felé mutató vízszintes irányvektor
    this.dirToCastle = new THREE.Vector3().subVectors(lookTargetPos, worldPos).setY(0).normalize();
    this.dirRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.dirToCastle).normalize();

    // A csúzli -Z tengelyét a vár felé fordítjuk
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.dirToCastle);
    this.group.visible = true;

    // Golyó és fészek visszaállítása nyugalmi állapotba
    this.aimBall.position.copy(this.restLocalPos);
    this.pouch.position.copy(this.restLocalPos);
    this.pullHelperRing.position.copy(this.restLocalPos);
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
      new THREE.CylinderGeometry(0.065, 0.075, 0.016, 24),
      woodMat
    );
    baseMesh.position.set(0, 0.008, 0);
    baseMesh.receiveShadow = true;
    baseMesh.castShadow = true;
    this.modelGroup.add(baseMesh);

    // 2. Fő törzs / fogantyú
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.018, this.stemHeight, 16),
      woodMat
    );
    stem.position.set(0, this.stemHeight / 2 + 0.008, 0);
    stem.castShadow = true;
    this.modelGroup.add(stem);

    // 3. Két villa ág
    const forkY = this.stemHeight + 0.008;
    this.leftForkTip = new THREE.Vector3(-this.forkWidth / 2, forkY + this.forkHeight, 0);
    this.rightForkTip = new THREE.Vector3(this.forkWidth / 2, forkY + this.forkHeight, 0);

    const forkGeo = new THREE.CylinderGeometry(0.009, 0.013, this.forkHeight, 14);

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
    const ringGeo = new THREE.TorusGeometry(0.011, 0.0035, 12, 16);
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

    // Bőrfészek forgatása a húzás irányába és célzó karika igazítása
    const pullOffset = ballPos.clone().sub(this.restLocalPos);
    if (pullOffset.length() > 0.002) {
      this.pouch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), pullOffset.clone().normalize());
      this.pouch.position.copy(ballPos).addScaledVector(pullOffset.clone().normalize(), 0.006);
    } else {
      this.pouch.quaternion.identity();
      this.pouch.position.copy(ballPos);
      this.pouch.position.z += 0.006;
    }

    this.pullHelperRing.position.copy(ballPos);
    this.pullHelperRing.lookAt(this.camera.position);
  }

  orientBand(bandMesh, startPt, endPt) {
    const dir = new THREE.Vector3().subVectors(endPt, startPt);
    const length = dir.length();
    if (length < 0.001) return;

    bandMesh.position.copy(startPt);
    bandMesh.scale.set(1, length, 1);
    bandMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  bindEvents() {
    let startScreenPos = { x: 0, y: 0 };
    let hasPlayedTension = false;

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
      const intersects = this.raycaster.intersectObjects([
        this.aimBall,
        this.pullHelperRing,
        this.pouch,
        ...this.modelGroup.children
      ]);

      // Ha rákattint vagy a képernyő alsó felére bök
      if (intersects.length > 0 || ndc.y < 0.35) {
        this.isAiming = true;
        hasPlayedTension = false;
        startScreenPos = { x: p.x, y: p.y };
        this.trajectoryLine.visible = true;
        this.hitMarker.visible = true;
      }
    };

    const onMove = (e) => {
      if (!this.isAiming) return;
      const p = getPos(e);

      const dx = (p.x - startScreenPos.x) / window.innerWidth;
      const dy = (p.y - startScreenPos.y) / window.innerHeight;

      // Hátrahúzás és célzás arányai
      const pullZ = Math.max(0.015, Math.min(0.22, dy * 0.55));
      const pullX = Math.max(-0.14, Math.min(0.14, dx * 0.4));
      const pullY = Math.max(-0.09, Math.min(0.09, -dy * 0.28));

      this.aimBall.position.set(
        this.restLocalPos.x + pullX,
        this.restLocalPos.y + pullY,
        this.restLocalPos.z + pullZ
      );

      this.update3DBands();
      this.updateTrajectory(pullX, pullY, pullZ);

      if (!hasPlayedTension && pullZ > 0.05) {
        hasPlayedTension = true;
        if (this.onTension) this.onTension();
      }
    };

    const onEnd = () => {
      if (!this.isAiming) return;
      this.isAiming = false;
      this.trajectoryLine.visible = false;
      this.hitMarker.visible = false;

      const localPull = this.aimBall.position.clone().sub(this.restLocalPos);
      if (localPull.z > 0.025) {
        this.launch(localPull);
      }

      // Visszaáll nyugalmi helyzetbe
      this.aimBall.position.copy(this.restLocalPos);
      this.update3DBands();
    };

    window.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    const onTouchStart = (e) => onStart(e);
    const onTouchMove = (e) => {
      if (this.isAiming) {
        e.preventDefault(); // Megakadályozza a mobil böngésző lapozását és a pull-to-refresh-t célzás közben
      }
      onMove(e);
    };
    const onTouchEnd = (e) => onEnd(e);

    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }

  calculateWorldVelocity(pullX, pullY, pullZ) {
    if (!this.dirToCastle) {
      this.dirToCastle = new THREE.Vector3(0, 0, -1);
      this.dirRight = new THREE.Vector3(1, 0, 0);
    }

    // Finomhangolt sebesség az asztali méretarányhoz (3.8 - 7.0 m/s)
    const forwardForce = Math.max(2.0, pullZ * 33.0);
    const verticalForce = Math.max(0.8, pullZ * 11.0 - pullY * 16.0);
    const sideForce = -pullX * 17.0;

    const vel = new THREE.Vector3();
    vel.addScaledVector(this.dirToCastle, forwardForce);
    vel.y = verticalForce;
    vel.addScaledVector(this.dirRight, sideForce);

    return vel;
  }

  updateTrajectory(pullX, pullY, pullZ) {
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(pullX, pullY, pullZ);

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const dt = 0.032;
    const g = -9.82;

    let curr = worldStart.clone();
    let vel = worldVel.clone();
    let hitFound = false;
    let hitPoint = curr.clone();
    let hitNormal = new THREE.Vector3(0, 1, 0);

    let hitIndex = this.trajectoryPoints - 1;

    for (let i = 0; i < this.trajectoryPoints; i++) {
      positions[i * 3] = curr.x;
      positions[i * 3 + 1] = curr.y;
      positions[i * 3 + 2] = curr.z;

      // Elmozdulás kiszámítása
      const nextX = curr.x + vel.x * dt;
      const nextY = curr.y + vel.y * dt + 0.5 * g * dt * dt;
      const nextZ = curr.z + vel.z * dt;
      vel.y += g * dt;

      // Becsapódás vizsgálata a talajjal (asztallal)
      if (!hitFound && nextY <= this.groundY) {
        hitFound = true;
        hitIndex = i;
        hitPoint.set(nextX, this.groundY + 0.002, nextZ);
        hitNormal.set(0, 1, 0);
        positions[i * 3] = hitPoint.x;
        positions[i * 3 + 1] = hitPoint.y;
        positions[i * 3 + 2] = hitPoint.z;
        break;
      }

      // Becsapódás vizsgálata a vár körzetével
      if (!hitFound && this.targetCastlePos.length() > 0.01) {
        const dToCastle = new THREE.Vector2(curr.x - this.targetCastlePos.x, curr.z - this.targetCastlePos.z).length();
        if (dToCastle < 0.22 && curr.y < this.targetCastlePos.y + 0.35 && curr.y >= this.targetCastlePos.y) {
          hitFound = true;
          hitIndex = i;
          hitPoint.copy(curr);
          hitNormal.set(curr.x - this.targetCastlePos.x, 0.2, curr.z - this.targetCastlePos.z).normalize();
          break;
        }
      }

      curr.set(nextX, nextY, nextZ);
    }

    // A trajektória vonal pontosan a becsapódásnál megáll (nem fúr bele a földbe)
    this.trajectoryLine.geometry.setDrawRange(0, hitFound ? (hitIndex + 1) : this.trajectoryPoints);
    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;

    // Céljelző elhelyezése pontosan a becsapódási pontra
    this.hitMarker.position.copy(hitFound ? hitPoint : curr);
    if (hitFound && hitNormal.y > 0.8) {
      this.hitMarker.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      this.hitMarker.lookAt(this.camera.position);
    }
  }

  launch(localPull) {
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(localPull.x, localPull.y, localPull.z);

    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    mesh.castShadow = true;
    mesh.position.copy(worldStart);
    this.scene.add(mesh);

    const body = this.physics.addSphere(mesh, worldStart, this.radius, 0.65);
    body.velocity.set(worldVel.x, worldVel.y, worldVel.z);

    // FONTOS STABILITÁSI JAVÍTÁS:
    // A vár kizárólag a VALÓS BECSAPÓDÁSKOR ébred fel!
    let hasCollided = false;
    body.addEventListener('collide', (event) => {
      if (hasCollided) return;
      hasCollided = true;

      const impactPoint = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
      
      // Becsapódási hang és részecskék indítása
      if (this.onImpact) {
        this.onImpact(impactPoint);
      }

      // Kőtömbök aktiválása
      this.physics.wakeUpNear(impactPoint, 0.35);

      // Kinetikus energia és impulzus átadása a közvetlenül eltalált merevtestnek
      if (event.body && event.body.type !== 0) { // nem STATIC
        const forwardDir = new THREE.Vector3(body.velocity.x, body.velocity.y, body.velocity.z).normalize();
        const impulseMagnitude = 0.45;
        event.body.applyImpulse(
          new (body.velocity.constructor)(forwardDir.x * impulseMagnitude, forwardDir.y * impulseMagnitude, forwardDir.z * impulseMagnitude),
          new (body.position.constructor)(impactPoint.x, impactPoint.y, impactPoint.z)
        );
      }
    });

    this.projectiles.push({ mesh, body, createdAt: Date.now() });

    if (this.onShoot) {
      this.onShoot();
    }
  }

  cleanOldProjectiles() {
    const now = Date.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (now - p.createdAt > 6500) {
        this.physics.removeObject(p.mesh);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
