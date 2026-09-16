import * as THREE from 'three';

export class DimensionPortal {
  constructor(scene) {
    this.scene = scene;
    this.isActive = false;
    this.portalGroup = new THREE.Group();
    this.portalGroup.position.set(0, 1.4, -2.5); // A vár mögött/felett lebegő kapu

    this.createPortalFrame();
    this.createOtherWorldInside();

    this.portalGroup.visible = false;
    this.scene.add(this.portalGroup);
  }

  createPortalFrame() {
    // Sci-Fi / Mágikus ovális vagy kerek kapukeret
    const torusGeo = new THREE.TorusGeometry(1.4, 0.08, 16, 64);
    const torusMat = new THREE.MeshStandardMaterial({
      color: 0xec4899,
      emissive: 0xdb2777,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.9
    });
    this.frameMesh = new THREE.Mesh(torusGeo, torusMat);
    this.portalGroup.add(this.frameMesh);

    // Belső fény / örvény a kapuban
    const circleGeo = new THREE.CircleGeometry(1.35, 32);
    const portalCoreMat = new THREE.MeshBasicMaterial({
      color: 0x1e1b4b,
      side: THREE.DoubleSide
    });
    this.coreMesh = new THREE.Mesh(circleGeo, portalCoreMat);
    this.portalGroup.add(this.coreMesh);
  }

  createOtherWorldInside() {
    // Kis lebegő sziklák és idegen kristályok, amik a portál "mögött" látszódnak
    this.otherWorldGroup = new THREE.Group();
    this.otherWorldGroup.position.set(0, 0, -1.0);

    const crystalGeo = new THREE.OctahedronGeometry(0.25, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
      roughness: 0.1,
      metalness: 0.8
    });

    for (let i = 0; i < 8; i++) {
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      const angle = (i / 8) * Math.PI * 2;
      const radius = 0.8 + Math.random() * 0.3;
      crystal.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.5 - Math.random() * 0.5);
      crystal.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.otherWorldGroup.add(crystal);
    }

    this.portalGroup.add(this.otherWorldGroup);
  }

  toggle() {
    this.isActive = !this.isActive;
    this.portalGroup.visible = this.isActive;
    return this.isActive;
  }

  update(dt, time) {
    if (!this.isActive) return;

    // Kapukeret finom lebegése és pulzálása
    this.portalGroup.position.y = 1.4 + Math.sin(time * 2) * 0.08;
    this.frameMesh.rotation.z += dt * 0.5;

    // Idegen világ kristályainak forgása
    if (this.otherWorldGroup) {
      this.otherWorldGroup.rotation.z -= dt * 0.3;
      this.otherWorldGroup.children.forEach((child, idx) => {
        child.rotation.x += dt * (1 + idx * 0.2);
        child.rotation.y += dt * 0.8;
      });
    }
  }
}
