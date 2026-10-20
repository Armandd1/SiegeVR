import * as THREE from 'three';

// ============================================================================
// 1. TERÜLETFELTÉRKÉPEZŐ ÉS ANIMÁLT FELÜLETI SZKENNER (SURFACE SCANNER)
// ============================================================================
export class SurfaceScanner {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.locked = false;
    this.time = 0;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    // Simított célzó pozíció és elforgatás (lerp a kézremegés és AR jitter ellen)
    this.currentPos = new THREE.Vector3(0, 0, 0);
    this.targetPos = new THREE.Vector3(0, 0, 0);
    this.currentQuat = new THREE.Quaternion();
    this.targetQuat = new THREE.Quaternion();
    this.tempMat4 = new THREE.Matrix4();
    this.hasPose = false;

    // Felületi pásztázó hullámok (Sonár gyűrűk, amik kifelé terjednek a felületen)
    this.wavesCount = 3;
    this.sonarRings = [];
    this.sonarMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    for (let i = 0; i < this.wavesCount; i++) {
      const ringGeo = new THREE.RingGeometry(0.04, 0.048, 36);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMesh = new THREE.Mesh(ringGeo, this.sonarMat.clone());
      ringMesh.position.y = 0.002;
      this.group.add(ringMesh);
      this.sonarRings.push({
        mesh: ringMesh,
        offset: (i / this.wavesCount)
      });
    }

    // Holografikus Felületi Szkennelési Rács (Hatszögletű / Mátrix hatású felület)
    this.createScanGrid();

    // Precíziós AR Célzókarika (Reticle) forgó skálával és célkereszttel
    this.createReticle();
  }

  createScanGrid() {
    this.gridGroup = new THREE.Group();
    this.gridGroup.position.y = 0.001;

    // Kör alakú, finom koordináta-háló a vizsgált felületre vetítve (átmérő: 1.2 m)
    const segments = 32;
    const gridCircleGeo = new THREE.CircleGeometry(0.55, segments);
    gridCircleGeo.rotateX(-Math.PI / 2);

    this.gridMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.16,
      wireframe: true,
      depthWrite: false
    });
    this.gridCircle = new THREE.Mesh(gridCircleGeo, this.gridMat);
    this.gridGroup.add(this.gridCircle);

    // Keresztirányú pásztázó vonalak
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.4
    });

    const crossGeo = new THREE.BufferGeometry();
    const crossPoints = new Float32Array([
      -0.5, 0.001, 0,   0.5, 0.001, 0,
      0, 0.001, -0.5,   0, 0.001, 0.5
    ]);
    crossGeo.setAttribute('position', new THREE.BufferAttribute(crossPoints, 3));
    this.scanCross = new THREE.LineSegments(crossGeo, lineMat);
    this.gridGroup.add(this.scanCross);

    // Animált terep-szkennelő lézersugár csík (oda-vissza pásztáz a felületen)
    const laserGeo = new THREE.PlaneGeometry(0.85, 0.018);
    laserGeo.rotateX(-Math.PI / 2);
    this.laserMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.laserSweep = new THREE.Mesh(laserGeo, this.laserMat);
    this.laserSweep.position.y = 0.002;
    this.gridGroup.add(this.laserSweep);

    // 4 holografikus sarokrögzítő (terület határolók a pásztázott zóna körül)
    const bracketMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 });
    const bSize = 0.38;
    const bArm = 0.08;
    [-1, 1].forEach(sx => {
      [-1, 1].forEach(sz => {
        const bg = new THREE.BufferGeometry();
        const pts = new Float32Array([
          sx * (bSize - bArm), 0.002, sz * bSize,
          sx * bSize, 0.002, sz * bSize,
          sx * bSize, 0.002, sz * bSize,
          sx * bSize, 0.002, sz * (bSize - bArm)
        ]);
        bg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const bracket = new THREE.LineSegments(bg, bracketMat);
        this.gridGroup.add(bracket);
      });
    });

    this.group.add(this.gridGroup);
  }

  createReticle() {
    this.reticleGroup = new THREE.Group();
    this.reticleGroup.position.y = 0.003;

    // 1. Belső pulzáló célzógyűrű
    const innerGeo = new THREE.RingGeometry(0.045, 0.062, 32);
    innerGeo.rotateX(-Math.PI / 2);
    this.innerMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    this.innerRing = new THREE.Mesh(innerGeo, this.innerMat);
    this.reticleGroup.add(this.innerRing);

    // 2. Külső forgó mérőgyűrű szaggatott rovátkákkal
    const outerGeo = new THREE.RingGeometry(0.085, 0.098, 40);
    outerGeo.rotateX(-Math.PI / 2);
    this.outerMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.outerRing = new THREE.Mesh(outerGeo, this.outerMat);
    this.reticleGroup.add(this.outerRing);

    // 3. 4 sarok-irányzék a külső gyűrű szélén
    const tickMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.004), tickMat);
      tick.rotateX(-Math.PI / 2);
      tick.rotation.z = angle;
      tick.position.set(Math.cos(angle) * 0.115, 0.001, Math.sin(angle) * 0.115);
      this.reticleGroup.add(tick);
    }

    // 4. Célzópont a középpontban
    const centerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
    );
    centerDot.position.y = 0.002;
    this.reticleGroup.add(centerDot);

    this.group.add(this.reticleGroup);
  }

  show() {
    this.active = true;
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  stop() {
    this.active = false;
    this.hasPose = false;
    this.group.visible = false;
  }

  // Célzópozíció beállítása simítással és felületi szög ellenőrzéssel (Float32Array vagy THREE.Matrix4)
  setPose(matrix, isValid = true) {
    if (!matrix) return;
    if (matrix instanceof Float32Array || Array.isArray(matrix)) {
      this.tempMat4.fromArray(matrix);
      this.targetPos.set(matrix[12], matrix[13], matrix[14]);
    } else if (matrix.isMatrix4) {
      this.tempMat4.copy(matrix);
      this.targetPos.setFromMatrixPosition(matrix);
    }
    this.targetQuat.setFromRotationMatrix(this.tempMat4);
    this.isPlaneValid = isValid;
    this.hasPose = true;

    if (!this.group.visible) {
      this.currentPos.copy(this.targetPos);
      this.currentQuat.copy(this.targetQuat);
      this.group.position.copy(this.currentPos);
      this.group.quaternion.copy(this.currentQuat);
      this.group.visible = true;
    }
    this.active = true;
  }

  setPositionDirect(pos) {
    this.targetPos.copy(pos);
    this.targetQuat.identity();
    this.currentPos.copy(pos);
    this.currentQuat.identity();
    this.group.position.copy(pos);
    this.group.quaternion.identity();
    this.group.visible = true;
    this.active = true;
    this.hasPose = true;
  }

  update(dt) {
    if (!this.group.visible) return;

    this.time += dt;

    // 1. Simított lebegés / mozgás (lerp + slerp a kézremegés kizárására)
    this.currentPos.lerp(this.targetPos, Math.min(1, dt * 14));
    this.currentQuat.slerp(this.targetQuat, Math.min(1, dt * 14));

    this.group.position.copy(this.currentPos);
    this.group.quaternion.copy(this.currentQuat);

    // 2. Külső gyűrű folyamatos high-tech forgatása
    if (this.outerRing) {
      this.outerRing.rotation.y = this.time * 0.85;
    }

    // 3. Szkennelő sonár gyűrűk tágulása és elhalványulása a felületen
    const wavePeriod = 1.6; // másodperc egy hullámciklus
    for (const ring of this.sonarRings) {
      const cycleProgress = ((this.time / wavePeriod) + ring.offset) % 1.0;
      // 0.08m-től 0.55m sugarig tágul a felületen
      const scale = 1.0 + cycleProgress * 8.5;
      ring.mesh.scale.set(scale, scale, scale);

      // Fényerő görbe: kezdetben látható, a szélén elhalványul
      const alpha = Math.sin(cycleProgress * Math.PI) * (this.isPlaneValid ? 0.65 : 0.25);
      ring.mesh.material.opacity = alpha;
    }

    // 4. Szkennelési rács és lézersugár csík pásztázó animációja
    if (this.gridMat) {
      const pulse = 0.14 + Math.sin(this.time * 2.5) * 0.07;
      this.gridMat.opacity = this.isPlaneValid ? pulse : 0.08;
    }
    if (this.laserSweep && this.laserMat) {
      const sweepZ = Math.sin(this.time * 3.2) * 0.38;
      this.laserSweep.position.z = sweepZ;
      this.laserMat.opacity = this.isPlaneValid ? 0.65 + 0.25 * Math.sin(this.time * 6) : 0.25;
    }

    // 5. Szín állapot: kék/cián ha stabil és vízszintes, narancs/vörös ha szögeltérés van
    const colorHex = this.isPlaneValid ? 0x38bdf8 : 0xf97316;
    if (this.innerMat.color.getHex() !== colorHex) {
      this.innerMat.color.setHex(colorHex);
      if (this.laserMat) this.laserMat.color.setHex(colorHex);
      // A gyűrűk saját (klónozott) anyagot használnak, ezért egyenként kell átszínezni őket
      for (const ring of this.sonarRings) {
        ring.mesh.material.color.setHex(colorHex);
      }
    }
  }

  getMatrix() {
    return this.group.matrixWorld;
  }

  getPosition() {
    return this.currentPos.clone();
  }
}

// ============================================================================
// 2. FEJLETT RÉSZECSKERENDSZER (PARTICLE SYSTEM)
// ============================================================================
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.groundY = 0; // az asztal magassága (a törmelék ezen pattan meg)
    this.pool = new Map(); // típusonkénti újrahasznosított háló készlet (nincs folyamatos GC terhelés)

    // Kőtörmelék geometria és anyag (újrafelhasznált példányok)
    this.debrisGeo = new THREE.DodecahedronGeometry(0.012, 0);
    this.debrisMat = new THREE.MeshStandardMaterial({
      color: 0x8b9bb4,
      roughness: 0.7,
      metalness: 0.1
    });

    // Szikra / tűz geometria és anyag
    this.sparkGeo = new THREE.SphereGeometry(0.006, 6, 6);
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b
    });

    // Füstpuff felhő geometria és anyag
    this.smokeGeo = new THREE.SphereGeometry(0.02, 8, 8);
    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0xd1d5db,
      transparent: true,
      opacity: 0.5
    });

    // Építési szikra geometria
    this.magicSparkGeo = new THREE.SphereGeometry(0.007, 6, 6);
    this.magicSparkMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8
    });
  }

  // Háló kivétele a készletből (vagy új létrehozása, ha üres)
  acquire(kind) {
    const list = this.pool.get(kind);
    let mesh = list && list.pop();
    if (!mesh) {
      switch (kind) {
        case 'debris': mesh = new THREE.Mesh(this.debrisGeo, this.debrisMat); break;
        case 'smoke': mesh = new THREE.Mesh(this.smokeGeo, this.smokeMat.clone()); break;
        case 'magic': mesh = new THREE.Mesh(this.magicSparkGeo, this.magicSparkMat); break;
        case 'spark':
        default: mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat); break;
      }
      mesh.userData.kind = kind;
      this.scene.add(mesh);
    }
    mesh.visible = true;
    mesh.scale.setScalar(1);
    mesh.rotation.set(0, 0, 0);
    return mesh;
  }

  release(mesh) {
    mesh.visible = false;
    const kind = mesh.userData.kind;
    if (!this.pool.has(kind)) this.pool.set(kind, []);
    this.pool.get(kind).push(mesh);
  }

  // Meteor lövedék repülési füst- és csillagszóró csóvája
  createTrail(position) {
    if (this.particles.length > 140) return; // limit a maximális teljesítményhez

    const mesh = this.acquire('spark');
    mesh.position.copy(position);
    mesh.position.x += (Math.random() - 0.5) * 0.02;
    mesh.position.y += (Math.random() - 0.5) * 0.02;
    mesh.position.z += (Math.random() - 0.5) * 0.02;

    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15),
      lifetime: 0.28,
      age: 0,
      isTrail: true,
      rotSpeed: 0
    });
  }

  // Építés / Letételkor mágikus energia- és porrobbanás
  createPlacementBurst(position, count = 16) {
    for (let i = 0; i < count; i++) {
      const mesh = this.acquire('magic');
      mesh.position.copy(position);
      mesh.position.y += 0.02;

      const angle = (i / count) * Math.PI * 2;
      const speed = 0.8 + Math.random() * 0.6;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        Math.random() * 0.6 + 0.3,
        Math.sin(angle) * speed
      );

      this.particles.push({
        mesh,
        velocity,
        lifetime: 0.55,
        age: 0,
        isMagic: true,
        rotSpeed: 0
      });
    }
  }

  // Becsapódási kőtörmelék és füstfelhő
  createImpact(position, count = 18) {
    // 1. Kőtörmelékek kirepülése
    for (let i = 0; i < count; i++) {
      const isSpark = i % 3 === 0;
      const mesh = this.acquire(isSpark ? 'spark' : 'debris');
      mesh.position.copy(position);
      mesh.position.x += (Math.random() - 0.5) * 0.04;
      mesh.position.y += (Math.random() - 0.5) * 0.04;
      mesh.position.z += (Math.random() - 0.5) * 0.04;

      const speed = isSpark ? 2.2 : 1.4;
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.9 + 0.4,
        (Math.random() - 0.5) * speed
      );

      this.particles.push({
        mesh,
        velocity,
        lifetime: isSpark ? 0.6 : 1.1,
        age: 0,
        rotSpeed: (Math.random() - 0.5) * 8
      });
    }

    // 2. Füstfelhő puffanás a becsapódási ponton
    for (let i = 0; i < 4; i++) {
      const smokeMesh = this.acquire('smoke');
      smokeMesh.position.copy(position);
      smokeMesh.material.opacity = 0.45;

      const smokeVel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.4 + 0.1,
        (Math.random() - 0.5) * 0.3
      );

      this.particles.push({
        mesh: smokeMesh,
        velocity: smokeVel,
        lifetime: 0.85,
        age: 0,
        isSmoke: true,
        rotSpeed: 0
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;

      if (p.age >= p.lifetime) {
        this.release(p.mesh);
        // O(1) eltávolítás: az utolsó elemet a helyére tesszük (a sorrend nem számít)
        const last = this.particles.pop();
        if (i < this.particles.length) this.particles[i] = last;
        continue;
      }

      const progress = p.age / p.lifetime;

      if (p.isSmoke) {
        p.velocity.y += 0.05 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        const scale = 1 + progress * 2.5;
        p.mesh.scale.setScalar(scale);
        if (p.mesh.material) {
          p.mesh.material.opacity = Math.max(0, 0.45 * (1 - progress));
        }
      } else if (p.isTrail) {
        p.mesh.position.addScaledVector(p.velocity, dt);
        const scale = Math.max(0.01, 1 - progress);
        p.mesh.scale.setScalar(scale);
      } else if (p.isMagic) {
        p.velocity.y -= 3.2 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        const scale = Math.max(0.01, 1 - progress);
        p.mesh.scale.setScalar(scale);
      } else {
        p.velocity.y -= 9.82 * dt * 0.65;
        p.mesh.position.addScaledVector(p.velocity, dt);

        // A törmelék az asztal lapján megpattan, nem esik át rajta
        if (p.mesh.position.y < this.groundY + 0.006 && p.velocity.y < 0) {
          p.mesh.position.y = this.groundY + 0.006;
          p.velocity.y *= -0.3;
          p.velocity.x *= 0.6;
          p.velocity.z *= 0.6;
        }

        const scale = Math.max(0.01, 1 - progress);
        p.mesh.scale.setScalar(scale);
        p.mesh.rotation.x += p.rotSpeed * dt;
        p.mesh.rotation.y += p.rotSpeed * dt;
      }
    }
  }

  clear() {
    for (const p of this.particles) {
      this.release(p.mesh);
    }
    this.particles = [];
  }
}

// ============================================================================
// 3. PROCEDURÁLIS HANGEFFEKTEK (SOUND EFFECTS)
// ============================================================================
export class SoundEffects {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.lastScoreSoundAt = 0;
    this.isMuted = false; // A hang mindig be van kapcsolva a felhasználó kérésének megfelelően
  }

  toggleMute() {
    this.isMuted = false;
    return false;
  }

  triggerHaptic(pattern) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  init() {
    if (this.isMuted) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Közös mester busz: kompresszor + fő hangerő (egyszerre sok becsapódásnál sincs torzítás)
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 8;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  getNoiseBuffer() {
    // A fehérzaj puffert csak egyszer generáljuk le, minden becsapódás újrahasználja
    if (!this.noiseBuffer) {
      const size = Math.floor(this.ctx.sampleRate * 0.35);
      this.noiseBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < size; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return this.noiseBuffer;
  }

  // Felületérzékelési csengettyű (amikor a szkenner rátalál a síkra)
  playScanPing() {
    this.triggerHaptic(15);
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // Építés / Letétel hangja (masszív kőkoppanás és visszhang)
  playBuild() {
    this.triggerHaptic([30, 20, 50]);
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.22);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // Csúzli gumiszalag feszülés hangja
  playTension() {
    this.triggerHaptic(12);
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(120, this.ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  // Kilövés suhanó és elpattanó hangja
  playShoot() {
    this.triggerHaptic([25, 20]);
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.22);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start(now);
    osc.stop(now + 0.22);
  }

  // Masszív kőbecsapódási dörrenés és omlás
  playImpact() {
    this.triggerHaptic([45, 30, 75]);
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Alacsony frekvenciás mély dörrenés
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(110, now);
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.35);

    subGain.gain.setValueAtTime(0.7, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    subOsc.connect(subGain);
    subGain.connect(this.master);
    subOsc.start(now);
    subOsc.stop(now + 0.35);

    // 2. Kőomlás fehérzaj szűrővel
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer();

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(750, now);
    filter.frequency.exponentialRampToValueAtTime(70, now + 0.35);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.master);

    noise.start(now);
  }

  // Pontszerzési csengés
  playScore() {
    // Omláskor képkockánként nőhet a pontszám – a csengetést és rezgést ritkítjuk
    const nowMs = performance.now();
    if (nowMs - this.lastScoreSoundAt < 140) return;
    this.lastScoreSoundAt = nowMs;

    this.triggerHaptic([20, 40, 20]);
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start(now);
    osc.stop(now + 0.3);
  }
}

