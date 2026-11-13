import * as THREE from 'three';

// ============================================================================
// 1. LETISZTULT TEREP-SZKENNER ÉS FOLYAMATJELZŐ GYŰRŰ (SURFACE SCANNER)
// ============================================================================
export class SurfaceScanner {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.time = 0;
    this.progress = 0;
    this.isPlaneValid = false;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    // Simított célzó pozíció és elforgatás (lerp a kézremegés és AR jitter ellen)
    this.currentPos = new THREE.Vector3(0, 0, 0);
    this.targetPos = new THREE.Vector3(0, 0, 0);
    this.currentQuat = new THREE.Quaternion();
    this.targetQuat = new THREE.Quaternion();
    this.tempMat4 = new THREE.Matrix4();
    this.tempVec = new THREE.Vector3();
    this.hasPose = false;
    this.lastPoseTime = 0;

    this.lockProgress = 1;
    this.onLock = null;

    this.createReticleAndProgress();
    this.createTetherLine();
  }

  createReticleAndProgress() {
    this.reticleGroup = new THREE.Group();
    this.reticleGroup.position.y = 0.002;

    // 1. Finom alap célzógyűrű
    const baseGeo = new THREE.RingGeometry(0.105, 0.112, 48);
    baseGeo.rotateX(-Math.PI / 2);
    this.baseMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
      depthWrite: false
    });
    this.baseRing = new THREE.Mesh(baseGeo, this.baseMat);
    this.reticleGroup.add(this.baseRing);

    // 2. 3D Folyamatjelző karika (geometria újragenerálás nélkül, setDrawRange-dzsel!)
    this.progressSegments = 48;
    const progressGeo = new THREE.RingGeometry(0.116, 0.134, this.progressSegments);
    progressGeo.rotateX(-Math.PI / 2);
    progressGeo.rotateY(Math.PI / 2); // Elölről/felülről induljon a töltés
    progressGeo.setDrawRange(0, 0);
    this.progressGeo = progressGeo;

    this.progressMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    this.progressRing = new THREE.Mesh(this.progressGeo, this.progressMat);
    this.progressRing.position.y = 0.0005;
    this.reticleGroup.add(this.progressRing);

    // 3. Belső célzógyűrű és középpont
    const innerGeo = new THREE.RingGeometry(0.024, 0.031, 32);
    innerGeo.rotateX(-Math.PI / 2);
    this.innerMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    this.innerRing = new THREE.Mesh(innerGeo, this.innerMat);
    this.reticleGroup.add(this.innerRing);

    const centerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.006, 16).rotateX(-Math.PI / 2),
      this.innerMat
    );
    centerDot.position.y = 0.0005;
    this.reticleGroup.add(centerDot);

    // 4. Egyetlen rögzítési visszajelző lökéshullám
    const shockwaveGeo = new THREE.RingGeometry(0.11, 0.125, 48);
    shockwaveGeo.rotateX(-Math.PI / 2);
    this.lockShockwaveMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.lockShockwave = new THREE.Mesh(shockwaveGeo, this.lockShockwaveMat);
    this.reticleGroup.add(this.lockShockwave);

    this.group.add(this.reticleGroup);
  }

  createTetherLine() {
    // 3D távolság- és irányjelző vonal a Vár és a Csúzli helye között
    const positions = new Float32Array(6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.tetherMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85
    });
    this.tetherLine = new THREE.Line(geo, this.tetherMat);
    this.tetherLine.visible = false;
    this.tetherLine.frustumCulled = false;
    this.scene.add(this.tetherLine);
  }

  updateTether(fromPos, toPos, visible, isValid = true) {
    if (!this.tetherLine) return;
    if (!visible || !fromPos || !toPos) {
      this.tetherLine.visible = false;
      return;
    }
    const arr = this.tetherLine.geometry.attributes.position.array;
    arr[0] = fromPos.x;
    arr[1] = fromPos.y + 0.006;
    arr[2] = fromPos.z;
    arr[3] = toPos.x;
    arr[4] = toPos.y + 0.006;
    arr[5] = toPos.z;
    this.tetherLine.geometry.attributes.position.needsUpdate = true;
    this.tetherMat.color.setHex(isValid ? 0x22c55e : 0xf97316);
    this.tetherLine.visible = true;
  }

  setProgress(progress) {
    const p = Math.max(0, Math.min(1, progress));
    this.progress = p;
    // RingGeometry: minden szegmens 2 háromszög = 6 index
    const count = Math.floor(p * this.progressSegments) * 6;
    this.progressGeo.setDrawRange(0, count);
  }

  triggerLockAnimation() {
    this.lockProgress = 0;
    if (this.onLock) {
      this.onLock();
    }
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
    this.isPlaneValid = false;
    this.setProgress(0);
    this.group.visible = false;
    if (this.tetherLine) this.tetherLine.visible = false;
  }

  // Célzópozíció beállítása simítással és zajszűréssel
  setPose(matrix, isValid = true) {
    if (!matrix) return;
    if (matrix instanceof Float32Array || Array.isArray(matrix)) {
      this.tempMat4.fromArray(matrix);
      this.tempVec.set(matrix[12], matrix[13], matrix[14]);
    } else if (matrix.isMatrix4) {
      this.tempMat4.copy(matrix);
      this.tempVec.setFromMatrixPosition(matrix);
    }

    // Deadzone zajszűrés: 2 mm alatti mikromozgást elnyomunk a remegés kizárására
    if (!this.hasPose || this.tempVec.distanceTo(this.targetPos) >= 0.002) {
      this.targetPos.copy(this.tempVec);
    }
    this.targetQuat.setFromRotationMatrix(this.tempMat4);

    this.isPlaneValid = isValid;
    this.hasPose = true;
    this.lastPoseTime = performance.now();

    if (!this.group.visible) {
      this.currentPos.copy(this.targetPos);
      this.currentQuat.copy(this.targetQuat);
      this.group.position.copy(this.currentPos);
      this.group.quaternion.copy(this.currentQuat);
      this.group.visible = true;
    }
    this.active = true;
  }

  isPoseExpired(timeoutMs = 450) {
    if (!this.hasPose) return true;
    return (performance.now() - this.lastPoseTime) > timeoutMs;
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
    this.isPlaneValid = true;
    this.lastPoseTime = performance.now();
  }

  update(dt) {
    if (!this.group.visible) return;

    this.time += dt;

    // 1. Simított mozgás (lerp + slerp a kézremegés és AR akadozás ellen)
    const lerpFactor = Math.min(1, dt * 12);
    this.currentPos.lerp(this.targetPos, lerpFactor);
    this.currentQuat.slerp(this.targetQuat, lerpFactor);

    this.group.position.copy(this.currentPos);
    this.group.quaternion.copy(this.currentQuat);

    // 2. Állapotszín: zöld ha 100% kész és érvényes, narancs ha nem érvényes, ciánkék pásztázáskor
    const isLockedReady = this.isPlaneValid && this.progress >= 1;
    const colorHex = !this.isPlaneValid ? 0xf59e0b : (isLockedReady ? 0x22c55e : 0x38bdf8);

    if (this.innerMat.color.getHex() !== colorHex) {
      this.innerMat.color.setHex(colorHex);
      this.baseMat.color.setHex(colorHex);
      this.progressMat.color.setHex(colorHex);
    }

    // 3. Finom pulzálás amíg pásztáz
    if (!isLockedReady) {
      const pulse = 1 + Math.sin(this.time * 4) * 0.05;
      this.innerRing.scale.setScalar(pulse);
    } else if (this.lockProgress >= 1) {
      this.innerRing.scale.setScalar(1);
    }

    // 4. Rögzítés pillanatában lefutó lökéshullám
    if (this.lockProgress < 1) {
      this.lockProgress = Math.min(1, this.lockProgress + dt / 0.55);
      const t = this.lockProgress;
      const shockScale = 1.0 + t * 2.2;
      this.lockShockwave.scale.setScalar(shockScale);
      this.lockShockwaveMat.opacity = (1 - t) * 0.85;
      const bounce = 1.0 + Math.sin(t * Math.PI) * 0.3;
      this.innerRing.scale.setScalar(bounce);
    } else if (this.lockShockwaveMat.opacity > 0) {
      this.lockShockwaveMat.opacity = 0;
    }
  }

  getMatrix() {
    return this.group.matrixWorld;
  }

  getPosition(target = null) {
    if (target) return target.copy(this.currentPos);
    return this.currentPos.clone();
  }
}

// ============================================================================
// 2. FEJLETT RÉSZECSKERENDSZER (PARTICLE SYSTEM - ZERO ALLOCATION)
// ============================================================================
const MAX_PARTICLES = 55;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.groundY = 0; // az asztal magassága (a törmelék ezen pattan meg)
    this.pool = new Map(); // típusonkénti újrahasznosított háló készlet
    this.particleObjPool = []; // újrahasznosított részecske-állapot objektumok

    // Kőtörmelék geometria és anyag (gyors MeshLambertMaterial PBR overhead nélkül)
    this.debrisGeo = new THREE.DodecahedronGeometry(0.012, 0);
    this.debrisMat = new THREE.MeshLambertMaterial({
      color: 0x8b9bb4
    });

    // Szikra / tűz geometria és anyag
    this.sparkGeo = new THREE.SphereGeometry(0.006, 5, 5);
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b
    });

    // Füstpuff felhő geometria és anyag
    this.smokeGeo = new THREE.SphereGeometry(0.02, 6, 6);
    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0xd1d5db,
      transparent: true,
      opacity: 0.45
    });

    // Építési szikra geometria
    this.magicSparkGeo = new THREE.SphereGeometry(0.007, 5, 5);
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

  acquireState() {
    return this.particleObjPool.pop() || {
      mesh: null,
      velocity: new THREE.Vector3(),
      lifetime: 0.5,
      age: 0,
      isSmoke: false,
      isTrail: false,
      isMagic: false,
      rotSpeed: 0
    };
  }

  release(p) {
    p.mesh.visible = false;
    const kind = p.mesh.userData.kind;
    if (!this.pool.has(kind)) this.pool.set(kind, []);
    this.pool.get(kind).push(p.mesh);
    p.mesh = null;
    this.particleObjPool.push(p);
  }

  spawnParticle(kind, pos, vx, vy, vz, lifetime, flags = 0, rotSpeed = 0) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const mesh = this.acquire(kind);
    mesh.position.copy(pos);

    const state = this.acquireState();
    state.mesh = mesh;
    state.velocity.set(vx, vy, vz);
    state.lifetime = lifetime;
    state.age = 0;
    state.isSmoke = flags === 1;
    state.isTrail = flags === 2;
    state.isMagic = flags === 3;
    state.rotSpeed = rotSpeed;
    this.particles.push(state);
    return mesh;
  }

  // Meteor lövedék repülési csóvája
  createTrail(position) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const mesh = this.spawnParticle(
      'spark',
      position,
      (Math.random() - 0.5) * 0.14,
      (Math.random() - 0.5) * 0.14,
      (Math.random() - 0.5) * 0.14,
      0.24,
      2,
      0
    );
    if (mesh) {
      mesh.position.x += (Math.random() - 0.5) * 0.016;
      mesh.position.y += (Math.random() - 0.5) * 0.016;
      mesh.position.z += (Math.random() - 0.5) * 0.016;
    }
  }

  // Építés / Letételkor mágikus energia- és porrobbanás
  createPlacementBurst(position, count = 14) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const angle = (i / count) * Math.PI * 2;
      const speed = 0.8 + Math.random() * 0.5;
      const mesh = this.spawnParticle(
        'magic',
        position,
        Math.cos(angle) * speed,
        Math.random() * 0.55 + 0.3,
        Math.sin(angle) * speed,
        0.5,
        3,
        0
      );
      if (mesh) mesh.position.y += 0.02;
    }
  }

  // Becsapódási kőtörmelék és füstfelhő
  createImpact(position, count = 10) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const isSpark = i % 3 === 0;
      const speed = isSpark ? 2.1 : 1.35;
      const mesh = this.spawnParticle(
        isSpark ? 'spark' : 'debris',
        position,
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.9 + 0.4,
        (Math.random() - 0.5) * speed,
        isSpark ? 0.55 : 0.95,
        0,
        (Math.random() - 0.5) * 8
      );
      if (mesh) {
        mesh.position.x += (Math.random() - 0.5) * 0.04;
        mesh.position.y += (Math.random() - 0.5) * 0.04;
        mesh.position.z += (Math.random() - 0.5) * 0.04;
      }
    }

    for (let i = 0; i < 2; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const smokeMesh = this.spawnParticle(
        'smoke',
        position,
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.35 + 0.1,
        (Math.random() - 0.5) * 0.3,
        0.75,
        1,
        0
      );
      if (smokeMesh && smokeMesh.material) {
        smokeMesh.material.opacity = 0.45;
      }
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;

      if (p.age >= p.lifetime) {
        this.release(p);
        // O(1) eltávolítás: az utolsó elemet a helyére tesszük (a sorrend nem számít)
        const last = this.particles.pop();
        if (i < this.particles.length) this.particles[i] = last;
        continue;
      }

      const progress = p.age / p.lifetime;

      if (p.isSmoke) {
        p.velocity.y += 0.05 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        const scale = 1 + progress * 2.4;
        p.mesh.scale.setScalar(scale);
        if (p.mesh.material) {
          p.mesh.material.opacity = Math.max(0, 0.45 * (1 - progress));
        }
      } else if (p.isTrail) {
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.scale.setScalar(Math.max(0.01, 1 - progress));
      } else if (p.isMagic) {
        p.velocity.y -= 3.2 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.scale.setScalar(Math.max(0.01, 1 - progress));
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

        p.mesh.scale.setScalar(Math.max(0.01, 1 - progress));
        p.mesh.rotation.x += p.rotSpeed * dt;
        p.mesh.rotation.y += p.rotSpeed * dt;
      }
    }
  }

  clear() {
    for (const p of this.particles) {
      this.release(p);
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

