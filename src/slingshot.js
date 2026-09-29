import * as THREE from 'three';

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
    this.targetCastlePos = new THREE.Vector3(0, 0, 0);

    // Kompakt Asztali Méretek (arányosítva a nagyobb várhoz: kb. 20 cm magas)
    this.stemHeight = 0.16;
    this.forkWidth = 0.125;
    this.forkHeight = 0.095;
    this.restLocalPos = new THREE.Vector3(0, this.stemHeight + this.forkHeight * 0.45, 0);

    this.radius = 0.034; // 6.8 cm átmérőjű masszív ostromlövedék
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
    const pouchGeo = new THREE.BoxGeometry(0.06, 0.045, 0.016);
    const pouchMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.9 });
    this.pouch = new THREE.Mesh(pouchGeo, pouchMat);
    this.pouch.position.copy(this.restLocalPos);
    this.pouch.castShadow = true;
    this.group.add(this.pouch);

    // Kézfogó / Célzó karika pulzáló világítással
    const ringGeo = new THREE.RingGeometry(0.044, 0.056, 32);
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

    // 3D Röppálya trajektória (nagy felbontású 65 pont a tűpontos előrejelzéshez)
    this.trajectoryPoints = 65;
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

    const markerRing = new THREE.Mesh(new THREE.RingGeometry(0.024, 0.034, 32), this.hitMarkerMat);
    this.hitMarkerGroup.add(markerRing);

    const markerDot = new THREE.Mesh(new THREE.CircleGeometry(0.007, 16), this.hitMarkerMat);
    this.hitMarkerGroup.add(markerDot);

    // Szálkereszt rovátkák a célkereszten
    [-1, 1].forEach(dir => {
      const hBar = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.0035), this.hitMarkerMat);
      hBar.position.set(dir * 0.044, 0, 0);
      this.hitMarkerGroup.add(hBar);

      const vBar = new THREE.Mesh(new THREE.PlaneGeometry(0.0035, 0.016), this.hitMarkerMat);
      vBar.position.set(0, dir * 0.044, 0);
      this.hitMarkerGroup.add(vBar);
    });

    this.controlMode = 'TOUCH';
    this.projectiles = [];
    this.raycaster = new THREE.Raycaster();
    this.groundY = 0;

    this.bindEvents();
  }

  setCastle(castle) {
    this.castle = castle;
  }

  setControlMode(mode) {
    this.controlMode = mode;
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
      new THREE.CylinderGeometry(0.08, 0.095, 0.02, 24),
      woodMat
    );
    baseMesh.position.set(0, 0.01, 0);
    baseMesh.receiveShadow = true;
    baseMesh.castShadow = true;
    this.modelGroup.add(baseMesh);

    // 2. Fő törzs / fogantyú
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.022, this.stemHeight, 16),
      woodMat
    );
    stem.position.set(0, this.stemHeight / 2 + 0.01, 0);
    stem.castShadow = true;
    this.modelGroup.add(stem);

    // 3. Két villa ág
    const forkY = this.stemHeight + 0.01;
    this.leftForkTip = new THREE.Vector3(-this.forkWidth / 2, forkY + this.forkHeight, 0);
    this.rightForkTip = new THREE.Vector3(this.forkWidth / 2, forkY + this.forkHeight, 0);

    const forkGeo = new THREE.CylinderGeometry(0.011, 0.015, this.forkHeight, 14);

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
    const ringGeo = new THREE.TorusGeometry(0.014, 0.004, 12, 16);
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
    const bandGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 8);
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
      if (this.controlMode !== 'TOUCH') return;
      if (e.target.closest('#ui-overlay button') || e.target.closest('#help-modal') || e.target.closest('#mode-modal') || e.target.closest('#phone-motion-container')) return;
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

      // Ha a csúzlira bök vagy a képernyő alsóbb részén indítja a húzást
      if (intersects.length > 0 || ndc.y < 0.45) {
        this.isAiming = true;
        hasPlayedTension = false;
        startScreenPos = { x: p.x, y: p.y };
        this.trajectoryLine.visible = true;
        this.hitMarkerGroup.visible = true;
      }
    };

    const onMove = (e) => {
      if (!this.isAiming) return;
      const p = getPos(e);

      // Kijelző méretaránytól független, 1:1 szimmetrikus húzási skála (nincs ovális torzulás mobilon!)
      const scaleRef = Math.min(window.innerWidth, window.innerHeight, 520);
      const normX = (p.x - startScreenPos.x) / scaleRef;
      const normY = (p.y - startScreenPos.y) / scaleRef;

      // Hátrahúzás (Z): lefelé húzáskor nő a feszültség
      const pullZ = Math.max(0.005, Math.min(0.24, normY * 0.65));
      // Oldalirányú célzás (X): finom vízszintes pásztázás
      const pullX = Math.max(-0.16, Math.min(0.16, normX * 0.48));
      // Magassági korrekció (Y): enyhe röppálya emelés/süllyesztés
      const pullY = Math.max(-0.10, Math.min(0.10, -normY * 0.28));

      this.aimBall.position.set(
        this.restLocalPos.x + pullX,
        this.restLocalPos.y + pullY,
        this.restLocalPos.z + pullZ
      );

      this.update3DBands();
      this.updateTrajectory(pullX, pullY, pullZ);

      if (!hasPlayedTension && pullZ > 0.04) {
        hasPlayedTension = true;
        if (this.onTension) this.onTension();
      }
    };

    const onEnd = () => {
      if (!this.isAiming) return;
      this.isAiming = false;
      this.trajectoryLine.visible = false;
      this.hitMarkerGroup.visible = false;

      const localPull = this.aimBall.position.clone().sub(this.restLocalPos);
      // Ha legalább 3.2 cm-t hátrahúzta (érdemi feszítés), akkor kilőjük
      // Ha visszatolta a kiindulópont közelébe, a lövés visszavonódik (visszalépés)
      if (localPull.z > 0.032) {
        this.launch(localPull);
      } else if (this.onAim) {
        this.onAim(0, null, true);
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
        e.preventDefault(); // Megakadályozza a mobil böngésző lapozását célzás közben
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

    // Hooke rugótörvénye: progresszív, természetes sebesség a hátrahúzás arányában
    const power = Math.min(1.0, pullZ / 0.22);
    const forwardSpeed = 3.8 + power * 4.4; // 3.8 m/s - 8.2 m/s
    const upwardSpeed = 0.9 + power * 2.1 - (pullY / 0.1) * 1.8;
    const sideSpeed = -(pullX / 0.16) * 2.3;

    const vel = new THREE.Vector3();
    vel.addScaledVector(this.dirToCastle, forwardSpeed);
    vel.y = upwardSpeed;
    vel.addScaledVector(this.dirRight, sideSpeed);

    return vel;
  }

  updateTrajectory(pullX, pullY, pullZ) {
    this.trajectoryLine.visible = true;
    if (this.hitMarkerGroup) this.hitMarkerGroup.visible = true;

    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(pullX, pullY, pullZ);

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const dt = 0.02; // Finom 50 Hz időlépés a Cannon fizikai szimulációval megegyezően
    const g = -9.82;
    const damping = 0.04; // Pontosan megegyezik a Cannon merevtest lineáris csillapításával!

    let curr = worldStart.clone();
    let vel = worldVel.clone();
    let hitFound = false;
    let hitPoint = curr.clone();
    let hitNormal = new THREE.Vector3(0, 1, 0);
    let hitTargetName = 'Talaj / Asztal';
    let isCastleHit = false;

    let hitIndex = this.trajectoryPoints - 1;

    // Összegyűjtjük a vár valódi köveit a precíz sugárkövetéshez (Raycast)
    const targetMeshes = [];
    if (this.castle && Array.isArray(this.castle.blocks)) {
      targetMeshes.push(...this.castle.blocks);
    }
    if (this.castle && Array.isArray(this.castle.foundationMeshes)) {
      targetMeshes.push(...this.castle.foundationMeshes);
    }

    for (let i = 0; i < this.trajectoryPoints; i++) {
      positions[i * 3] = curr.x;
      positions[i * 3 + 1] = curr.y;
      positions[i * 3 + 2] = curr.z;

      // Következő elmozdulás kiszámítása Cannon-hű Euler lépéssel és csillapítással
      const nextVel = vel.clone();
      nextVel.y += g * dt;
      nextVel.multiplyScalar(1 - damping * dt);

      const nextPos = curr.clone().addScaledVector(nextVel, dt);

      // 1. TŰPONTOS KŐÜTKÖZÉS: Szakasz-sugárkövetés a vár tényleges köveivel
      if (!hitFound && targetMeshes.length > 0) {
        const segVector = nextPos.clone().sub(curr);
        const segDist = segVector.length();

        if (segDist > 0.0001) {
          this.trajRaycaster.set(curr, segVector.normalize());
          this.trajRaycaster.far = segDist;

          const intersects = this.trajRaycaster.intersectObjects(targetMeshes, false);
          if (intersects.length > 0) {
            const hit = intersects[0];
            hitFound = true;
            hitIndex = i;
            hitPoint.copy(hit.point);

            if (hit.face) {
              hitNormal.copy(hit.face.normal).applyQuaternion(hit.object.quaternion).normalize();
            } else {
              hitNormal.set(0, 1, 0);
            }

            isCastleHit = hit.object.userData.isCastleBlock === true;
            hitTargetName = isCastleHit ? '🏰 Várfal kőtömb' : 'Kőtalapzat';

            positions[i * 3] = hitPoint.x;
            positions[i * 3 + 1] = hitPoint.y;
            positions[i * 3 + 2] = hitPoint.z;
            break;
          }
        }
      }

      // 2. Becsapódás vizsgálata a valódi asztal lapjával
      if (!hitFound && nextPos.y <= this.groundY) {
        hitFound = true;
        hitIndex = i;

        // Pontos sík-metszéspont interpolálása
        const dyTotal = nextPos.y - curr.y;
        const alpha = Math.abs(dyTotal) > 0.0001 ? Math.max(0, Math.min(1, (this.groundY - curr.y) / dyTotal)) : 0;

        hitPoint.set(
          curr.x + (nextPos.x - curr.x) * alpha,
          this.groundY + 0.002,
          curr.z + (nextPos.z - curr.z) * alpha
        );
        hitNormal.set(0, 1, 0);
        hitTargetName = 'Asztal lapja';
        isCastleHit = false;

        positions[i * 3] = hitPoint.x;
        positions[i * 3 + 1] = hitPoint.y;
        positions[i * 3 + 2] = hitPoint.z;
        break;
      }

      curr.copy(nextPos);
      vel.copy(nextVel);
    }

    // A trajektória vonal pontosan a becsapódási pontig tart
    this.trajectoryLine.geometry.setDrawRange(0, hitFound ? (hitIndex + 1) : this.trajectoryPoints);
    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;

    // Röppálya színének dinamikus változása az erő mértékében
    const power = Math.min(1.0, pullZ / 0.22);
    const trajColor = power > 0.75 ? 0xef4444 : (power > 0.4 ? 0xf59e0b : 0x38bdf8);
    this.trajMaterial.color.setHex(trajColor);

    // Taktikai célkereszt pozicionálása és felületre simítása
    if (this.hitMarkerGroup) {
      this.hitMarkerGroup.position.copy(hitPoint).addScaledVector(hitNormal, 0.003);
      this.hitMarkerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitNormal);

      // Célkereszt színezése: piros, ha közvetlen vártalálat, kék, ha asztalfelület
      this.hitMarkerMat.color.setHex(isCastleHit ? 0xef4444 : 0x38bdf8);
    }

    // Célzási előrehaladás visszajelzése a HUD felületre
    if (this.onAim) {
      const percent = Math.round(power * 100);
      this.onAim(percent, hitTargetName, false);
    }
  }

  launch(localPull) {
    const worldStart = this.aimBall.getWorldPosition(new THREE.Vector3());
    const worldVel = this.calculateWorldVelocity(localPull.x, localPull.y, localPull.z);

    const mesh = new THREE.Mesh(this.sphereGeo, this.projectileMat);
    mesh.castShadow = true;
    mesh.position.copy(worldStart);
    this.scene.add(mesh);

    const body = this.physics.addSphere(mesh, worldStart, this.radius, 1.15);
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
        const speedSq = body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y + body.velocity.z * body.velocity.z;
        if (speedSq > 0.001) {
          const invSpeed = 1 / Math.sqrt(speedSq);
          const fX = body.velocity.x * invSpeed;
          const fY = body.velocity.y * invSpeed;
          const fZ = body.velocity.z * invSpeed;
          const impulseMagnitude = 0.45;
          event.body.applyImpulse(
            new (body.velocity.constructor)(fX * impulseMagnitude, fY * impulseMagnitude, fZ * impulseMagnitude),
            new (body.position.constructor)(impactPoint.x, impactPoint.y, impactPoint.z)
          );
        }
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

  clearAllProjectiles() {
    for (const p of this.projectiles) {
      this.physics.removeObject(p.mesh);
      this.scene.remove(p.mesh);
    }
    this.projectiles = [];
  }
}
