import * as THREE from 'three';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];

    // Kőtörmelék geometria és anyag (közös újrafelhasznált példányok)
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
  }

  createImpact(position, count = 18) {
    // 1. Kőtörmelékek kirepülése
    for (let i = 0; i < count; i++) {
      const isSpark = i % 3 === 0;
      const geo = isSpark ? this.sparkGeo : this.debrisGeo;
      const mat = isSpark ? this.sparkMat : this.debrisMat;

      const mesh = new THREE.Mesh(geo, mat);
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

      this.scene.add(mesh);
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
      const smokeMesh = new THREE.Mesh(this.smokeGeo, this.smokeMat.clone());
      smokeMesh.position.copy(position);
      this.scene.add(smokeMesh);

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
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      const progress = p.age / p.lifetime;

      if (p.isSmoke) {
        // Füst lassan tágul és elhalványul
        p.velocity.y += 0.05 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        const scale = 1 + progress * 2.5;
        p.mesh.scale.setScalar(scale);
        if (p.mesh.material) {
          p.mesh.material.opacity = Math.max(0, 0.45 * (1 - progress));
        }
      } else {
        // Kőtörmelék fizika
        p.velocity.y -= 9.82 * dt * 0.65;
        p.mesh.position.addScaledVector(p.velocity, dt);

        const scale = Math.max(0.01, 1 - progress);
        p.mesh.scale.setScalar(scale);
        p.mesh.rotation.x += p.rotSpeed * dt;
        p.mesh.rotation.y += p.rotSpeed * dt;
      }
    }
  }

  clear() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
    }
    this.particles = [];
  }
}

// Gazdag, procedurális szintetizált hangeffektek Web Audio API-val
export class SoundEffects {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Csúzli gumiszalag feszülés hangja
  playTension() {
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
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  // Kilövés suhanó és elpattanó hangja
  playShoot() {
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
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.22);
  }

  // Masszív kőbecsapódási dörrenés és omlás
  playImpact() {
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
    subGain.connect(this.ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.35);

    // 2. Kőomlás fehérzaj szűrővel
    const bufferSize = this.ctx.sampleRate * 0.35;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(750, now);
    filter.frequency.exponentialRampToValueAtTime(70, now + 0.35);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    noise.start(now);
  }

  // Pontszerzési csengés
  playScore() {
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
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  }
}
