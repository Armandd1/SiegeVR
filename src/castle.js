import * as THREE from 'three';
import { BLOCK_SIZE } from './physics.js';

export class CastleBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.blocks = [];

    this.boxGeometry = new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z);
    this.createMaterials();
  }

  createMaterials() {
    // 1. Procedurális középkori kőfal textúra
    const stoneCanvas = document.createElement('canvas');
    stoneCanvas.width = 128;
    stoneCanvas.height = 128;
    const ctx = stoneCanvas.getContext('2d');

    // Kő alapszín
    ctx.fillStyle = '#8b9bb4';
    ctx.fillRect(0, 0, 128, 128);

    // Kőtégla vonalak és fuga
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 128, 64);
    ctx.strokeRect(0, 64, 128, 64);
    ctx.beginPath();
    ctx.moveTo(64, 0); ctx.lineTo(64, 64);
    ctx.moveTo(32, 64); ctx.lineTo(32, 128);
    ctx.moveTo(96, 64); ctx.lineTo(96, 128);
    ctx.stroke();

    // Zaj és kő textúra pontok
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }

    const stoneTex = new THREE.CanvasTexture(stoneCanvas);
    stoneTex.wrapS = THREE.RepeatWrapping;
    stoneTex.wrapT = THREE.RepeatWrapping;

    this.stoneMaterial = new THREE.MeshStandardMaterial({
      map: stoneTex,
      roughness: 0.85,
      metalness: 0.1
    });

    // 2. Bástya és díszítő tetők (királyi kék és arany beütés)
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.4,
      metalness: 0.4
    });

    // 3. Fa gerendák és kapu
    this.woodMaterial = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.9,
      metalness: 0.05
    });
  }

  buildCastleAt(originPos) {
    this.clear();

    // Frissítjük a fizikai talajt PONTOSAN a vár alapjának magasságára!
    this.physics.setGroundHeight(originPos.y);

    const layouts = ['fortress', 'pyramid', 'twin_towers', 'citadel'];
    const chosenLayout = layouts[Math.floor(Math.random() * layouts.length)];
    console.log(`🏰 Új masszív vár építése: [${chosenLayout}] @`, originPos);

    switch (chosenLayout) {
      case 'pyramid':
        this.buildPyramid(originPos);
        break;
      case 'twin_towers':
        this.buildTwinTowers(originPos);
        break;
      case 'citadel':
        this.buildCitadel(originPos);
        break;
      case 'fortress':
      default:
        this.buildFortress(originPos);
        break;
    }
  }

  createBlock(worldX, worldY, worldZ, material, mass = 0.2) {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(worldX, worldY, worldZ);
    mesh.userData.isCastleBlock = true;

    this.scene.add(mesh);
    this.physics.addBox(mesh, { x: worldX, y: worldY, z: worldZ }, mass);
    this.blocks.push(mesh);
    return mesh;
  }

  // 1. ELRENDEZÉS: Széles Erőd Bástyafokokkal és Kapuval
  buildFortress(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const rows = 4;
    const cols = 5;

    for (let layer = 0; layer < rows; layer++) {
      const y = origin.y + by / 2 + layer * by;
      const count = cols - (layer % 2 === 1 ? 1 : 0);
      const startX = origin.x - ((count - 1) * bx) / 2;

      for (let c = 0; c < count; c++) {
        // Kapu kihagyása a földszinten a közepén
        if (layer === 0 && count === cols && c === 2) continue;

        const x = startX + c * bx;
        const mat = (layer === 0 && count !== cols && c === 1) ? this.woodMaterial : this.stoneMaterial;
        this.createBlock(x, y, origin.z, mat, 0.25);
      }
    }

    // Bástyafokok a tetőre a két szélre és középre
    const topY = origin.y + by / 2 + rows * by;
    this.createBlock(origin.x - (cols / 2 - 0.5) * bx, topY, origin.z, this.accentMaterial, 0.15);
    this.createBlock(origin.x + (cols / 2 - 0.5) * bx, topY, origin.z, this.accentMaterial, 0.15);
    this.createBlock(origin.x, topY, origin.z, this.accentMaterial, 0.15);
  }

  // 2. ELRENDEZÉS: Sziklaszilárd Lépcsős Zikkurat Piramis
  buildPyramid(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const maxLayers = 4;

    for (let layer = 0; layer < maxLayers; layer++) {
      const y = origin.y + by / 2 + layer * by;
      const count = maxLayers - layer + 1; // 5 -> 4 -> 3 -> 2
      const startX = origin.x - ((count - 1) * bx) / 2;

      for (let i = 0; i < count; i++) {
        const x = startX + i * bx;
        const mat = layer === maxLayers - 1 ? this.accentMaterial : this.stoneMaterial;
        this.createBlock(x, y, origin.z, mat, 0.25);
      }
    }

    // Csúcsdísz
    const topY = origin.y + by / 2 + maxLayers * by;
    this.createBlock(origin.x, topY, origin.z, this.accentMaterial, 0.15);
  }

  // 3. ELRENDEZÉS: Két Magas Bástyatorony Összekötő Fa Híddal
  buildTwinTowers(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const towerH = 4;
    const towerDist = bx * 2.2;

    for (let layer = 0; layer < towerH; layer++) {
      const y = origin.y + by / 2 + layer * by;
      // Bal torony
      this.createBlock(origin.x - towerDist / 2, y, origin.z, this.stoneMaterial, 0.3);
      // Jobb torony
      this.createBlock(origin.x + towerDist / 2, y, origin.z, this.stoneMaterial, 0.3);
    }

    // Összekötő híd a 3. szinten
    const bridgeY = origin.y + by / 2 + 2 * by;
    this.createBlock(origin.x, bridgeY, origin.z, this.woodMaterial, 0.2);

    // Tetőbástyák a tornyok tetejére
    const topY = origin.y + by / 2 + towerH * by;
    this.createBlock(origin.x - towerDist / 2, topY, origin.z, this.accentMaterial, 0.15);
    this.createBlock(origin.x + towerDist / 2, topY, origin.z, this.accentMaterial, 0.15);
  }

  // 4. ELRENDEZÉS: 3D Citadella (Masszív, térbeli tömb)
  buildCitadel(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const bz = BLOCK_SIZE.z;

    for (let layer = 0; layer < 3; layer++) {
      const y = origin.y + by / 2 + layer * by;
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) {
          if (layer > 0 && r === 0 && c === 0) continue; // belső üreg
          const x = origin.x + c * bx;
          const z = origin.z + r * bz;
          this.createBlock(x, y, z, this.stoneMaterial, 0.25);
        }
      }
    }

    // 4 sarokbástya a tetőre
    const topY = origin.y + by / 2 + 3 * by;
    [-1, 1].forEach(r => {
      [-1, 1].forEach(c => {
        this.createBlock(origin.x + c * bx, topY, origin.z + r * bz, this.accentMaterial, 0.15);
      });
    });
  }

  clear() {
    this.physics.clearCastle();
    for (const mesh of this.blocks) {
      this.scene.remove(mesh);
    }
    this.blocks = [];
  }
}
