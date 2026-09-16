import * as THREE from 'three';
import { BLOCK_SIZE } from './physics.js';

export class CastleBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.blocks = [];

    // Anyagok a várhoz: elegáns középkori kőtömbök
    const textureLoader = new THREE.TextureLoader();
    this.boxGeometry = new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z);
    
    this.stoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b9bb4,
      roughness: 0.8,
      metalness: 0.1,
    });

    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f46e5,
      roughness: 0.5,
      metalness: 0.3,
    });

    this.woodMaterial = new THREE.MeshStandardMaterial({
      color: 0x854d0e,
      roughness: 0.9,
      metalness: 0.05,
    });
  }

  buildCastle(centerX = 0, centerZ = -2.5) {
    this.clear();

    // 4 különböző szilárd, önmagában stabil szerkezet típus:
    // 0: Erődített Várfal & Bástyák
    // 1: Piramis / Zikkurat (széles, masszív alap)
    // 2: Két Bástyás Kaputorony összekötő híddal
    // 3: 3x3-as Masszív Vártorony
    const layouts = ['fortress', 'pyramid', 'twin_towers', 'monolith'];
    const chosenLayout = layouts[Math.floor(Math.random() * layouts.length)];

    console.log(`🏰 Új vár építése: [${chosenLayout}]`);

    switch (chosenLayout) {
      case 'pyramid':
        this.buildPyramid(centerX, centerZ);
        break;
      case 'twin_towers':
        this.buildTwinTowers(centerX, centerZ);
        break;
      case 'monolith':
        this.buildMonolith(centerX, centerZ);
        break;
      case 'fortress':
      default:
        this.buildFortress(centerX, centerZ);
        break;
    }
  }

  createBlock(x, y, z, material, mass = 1.2) {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    mesh.userData.isCastleBlock = true;

    this.scene.add(mesh);
    this.physics.addBox(mesh, mass);
    this.blocks.push(mesh);
    return mesh;
  }

  // 1. ELRENDEZÉS: Erődített Várfal és Kapu
  buildFortress(centerX, centerZ) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const rows = 4;
    const cols = 5;

    for (let layer = 0; layer < rows; layer++) {
      const y = by / 2 + layer * by;
      const count = cols - (layer % 2 === 1 ? 1 : 0);
      const startX = centerX - ((count - 1) * bx) / 2;

      for (let c = 0; c < count; c++) {
        const x = startX + c * bx;
        const mat = layer === rows - 1 ? this.accentMaterial : (layer % 2 === 0 ? this.stoneMaterial : this.woodMaterial);
        this.createBlock(x, y, centerZ, mat, 1.2);
      }
    }

    // Bástyák a két szélére
    const topY = by / 2 + rows * by;
    this.createBlock(centerX - (cols / 2 - 0.5) * bx, topY, centerZ, this.accentMaterial, 0.8);
    this.createBlock(centerX + (cols / 2 - 0.5) * bx, topY, centerZ, this.accentMaterial, 0.8);
  }

  // 2. ELRENDEZÉS: Sziklaszilárd Piramis / Zikkurat
  buildPyramid(centerX, centerZ) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const maxLayers = 5;

    for (let layer = 0; layer < maxLayers; layer++) {
      const y = by / 2 + layer * by;
      const blocksInLayer = maxLayers - layer;
      const startX = centerX - ((blocksInLayer - 1) * bx) / 2;

      for (let i = 0; i < blocksInLayer; i++) {
        const x = startX + i * bx;
        const mat = layer === maxLayers - 1 ? this.accentMaterial : (layer % 2 === 0 ? this.stoneMaterial : this.woodMaterial);
        this.createBlock(x, y, centerZ, mat, 1.0);
      }
    }
  }

  // 3. ELRENDEZÉS: Két Bástyás Kapu Összekötő Tetővel
  buildTwinTowers(centerX, centerZ) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const towerHeight = 5;
    const towerDist = bx * 2.2;

    // Bal torony
    for (let layer = 0; layer < towerHeight; layer++) {
      const y = by / 2 + layer * by;
      this.createBlock(centerX - towerDist / 2, y, centerZ, this.stoneMaterial, 1.5);
    }

    // Jobb torony
    for (let layer = 0; layer < towerHeight; layer++) {
      const y = by / 2 + layer * by;
      this.createBlock(centerX + towerDist / 2, y, centerZ, this.stoneMaterial, 1.5);
    }

    // Összekötő felső híd/tetőgerenda
    const bridgeY = by / 2 + 3 * by;
    this.createBlock(centerX, bridgeY, centerZ, this.woodMaterial, 1.0);
    this.createBlock(centerX, bridgeY + by, centerZ, this.accentMaterial, 0.8);
  }

  // 4. ELRENDEZÉS: 3D Masszív Kockatömb (Monolith erődítmény)
  buildMonolith(centerX, centerZ) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const bz = BLOCK_SIZE.z;

    for (let layer = 0; layer < 4; layer++) {
      const y = by / 2 + layer * by;
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          // Kis belső üregesség a közepén
          if (layer > 0 && layer < 3 && row === 0 && col === 0) continue;

          const x = centerX + col * bx;
          const z = centerZ + row * bz;
          const mat = layer === 3 ? this.accentMaterial : this.stoneMaterial;
          this.createBlock(x, y, z, mat, 1.2);
        }
      }
    }
  }

  clear() {
    this.physics.clearCastle();
    for (const mesh of this.blocks) {
      this.scene.remove(mesh);
    }
    this.blocks = [];
  }
}
