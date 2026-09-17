import * as THREE from 'three';
import { BLOCK_SIZE } from './physics.js';

export class CastleBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.blocks = [];
    this.foundationMeshes = [];

    this.boxGeometry = new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z);
    this.createMaterials();
  }

  createMaterials() {
    // 1. Procedurális középkori kőfal textúra és domborzati térkép (256x256)
    const stoneCanvas = document.createElement('canvas');
    stoneCanvas.width = 256;
    stoneCanvas.height = 256;
    const ctx = stoneCanvas.getContext('2d');

    // Kő alap textúra átmenettel
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#788296');
    grad.addColorStop(0.5, '#6b7280');
    grad.addColorStop(1, '#565d6d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    // Kőtégla fuga és kőtömbök rajzolása
    ctx.strokeStyle = '#2d333e';
    ctx.lineWidth = 6;
    ctx.fillStyle = '#838e9f';

    // 4 sor tégla
    const rowH = 64;
    for (let r = 0; r < 4; r++) {
      const y = r * rowH;
      ctx.strokeRect(0, y, 256, rowH);

      const offset = (r % 2) * 64;
      for (let x = offset; x < 256; x += 128) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + rowH);
        ctx.stroke();

        // Finom kőél árnyékolás a 3D hatásért
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(x + 4, y + 4, 120, 10);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(x + 4, y + rowH - 12, 120, 8);
      }
    }

    // Kőzaj és apró pontok
    for (let i = 0; i < 900; i++) {
      const px = Math.random() * 256;
      const py = Math.random() * 256;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(px, py, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }

    const stoneTex = new THREE.CanvasTexture(stoneCanvas);
    stoneTex.wrapS = THREE.RepeatWrapping;
    stoneTex.wrapT = THREE.RepeatWrapping;

    this.stoneMaterial = new THREE.MeshStandardMaterial({
      map: stoneTex,
      bumpMap: stoneTex,
      bumpScale: 0.003,
      roughness: 0.8,
      metalness: 0.1
    });

    // 2. Erődített kőalap (sötétebb bazalt / gránit)
    this.foundationMaterial = new THREE.MeshStandardMaterial({
      color: 0x374151,
      roughness: 0.9,
      metalness: 0.1
    });

    // 3. Királyi kék bástyák és tetők arany/ezüst csillogással
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.35,
      metalness: 0.45
    });

    // 4. Fa gerendák és kapu textúra
    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 128;
    woodCanvas.height = 128;
    const wCtx = woodCanvas.getContext('2d');
    wCtx.fillStyle = '#683616';
    wCtx.fillRect(0, 0, 128, 128);
    // Fa erezet vonalak
    wCtx.strokeStyle = '#4e270e';
    wCtx.lineWidth = 2;
    for (let y = 8; y < 128; y += 12) {
      wCtx.beginPath();
      wCtx.moveTo(0, y);
      wCtx.bezierCurveTo(40, y + 4, 80, y - 4, 128, y);
      wCtx.stroke();
    }
    const woodTex = new THREE.CanvasTexture(woodCanvas);

    this.woodMaterial = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.85,
      metalness: 0.05
    });
  }

  buildCastleAt(originPos) {
    this.clear();

    // Frissítjük a fizikai talajt pontosan a vár alapjának magasságára
    this.physics.setGroundHeight(originPos.y);

    // Kő udvar / talapzat lehelyezése, ami garantálja a 100%-os stabilitást
    this.createPlinth(originPos);

    const layouts = ['fortress', 'pyramid', 'twin_towers', 'citadel'];
    const chosenLayout = layouts[Math.floor(Math.random() * layouts.length)];
    console.log(`🏰 Stabil vár építése: [${chosenLayout}] @`, originPos);

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

  // Stabil kőtalapzat a vár alá, ami összefogja az árnyékokat és valós fizikai alátámasztást ad
  createPlinth(origin) {
    const plinthSize = { x: 0.54, y: 0.015, z: 0.44 };
    const plinthGeo = new THREE.BoxGeometry(plinthSize.x, plinthSize.y, plinthSize.z);
    const plinthMesh = new THREE.Mesh(plinthGeo, this.foundationMaterial);
    const plinthPos = { x: origin.x, y: origin.y + plinthSize.y / 2, z: origin.z };
    plinthMesh.position.set(plinthPos.x, plinthPos.y, plinthPos.z);
    plinthMesh.receiveShadow = true;
    plinthMesh.userData.isFoundation = true;

    this.scene.add(plinthMesh);
    this.physics.addPlinth(plinthMesh, plinthPos, plinthSize);
    this.foundationMeshes.push(plinthMesh);
  }

  createBlock(worldX, worldY, worldZ, material, mass = 0.35) {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(worldX, worldY, worldZ);
    mesh.userData.isCastleBlock = true;
    mesh.userData.initialPos = new THREE.Vector3(worldX, worldY, worldZ);
    mesh.userData.initialQuat = mesh.quaternion.clone();

    this.scene.add(mesh);
    this.physics.addBox(mesh, { x: worldX, y: worldY, z: worldZ }, mass, true);
    this.blocks.push(mesh);
  }

  // 1. ELRENDEZÉS: Széles Várfal Kapuval és Bástyafokokkal
  buildFortress(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const baseOffsetY = 0.015; // talapzat vastagsága
    const rows = 4;
    const cols = 5;

    // Rétegek építése stabil kötésben
    for (let layer = 0; layer < rows; layer++) {
      const y = origin.y + baseOffsetY + by / 2 + layer * by;

      if (layer === 0) {
        // Földszint: 5 kő, középen a kapu nyílás
        const startX = origin.x - 2 * bx;
        for (let c = 0; c < cols; c++) {
          if (c === 2) continue; // kapu rés
          this.createBlock(startX + c * bx, y, origin.z, this.stoneMaterial, 0.4);
        }
      } else if (layer === 1) {
        // 1. emelet: masszív fa áthidaló gerenda a kapu fölött + oldalsó kőtömbök
        const startX = origin.x - 1.5 * bx;
        for (let c = 0; c < 4; c++) {
          const x = startX + c * bx;
          // A két középső kő hidalja át a kaput fa gerendaként
          const mat = (c === 1 || c === 2) ? this.woodMaterial : this.stoneMaterial;
          this.createBlock(x, y, origin.z, mat, 0.35);
        }
      } else if (layer === 2) {
        // 2. emelet: 5 kőtömb folyamatos kötésben
        const startX = origin.x - 2 * bx;
        for (let c = 0; c < cols; c++) {
          this.createBlock(startX + c * bx, y, origin.z, this.stoneMaterial, 0.35);
        }
      } else if (layer === 3) {
        // 3. emelet: 4 kőtömb zárófal
        const startX = origin.x - 1.5 * bx;
        for (let c = 0; c < 4; c++) {
          this.createBlock(startX + c * bx, y, origin.z, this.stoneMaterial, 0.3);
        }
      }
    }

    // Bástyafokok a tetőre, pontosan a tartókövek tetejére (két szél és közép)
    const topY = origin.y + baseOffsetY + by / 2 + rows * by;
    this.createBlock(origin.x - 1.5 * bx, topY, origin.z, this.accentMaterial, 0.2);
    this.createBlock(origin.x - 0.5 * bx, topY, origin.z, this.accentMaterial, 0.2);
    this.createBlock(origin.x + 0.5 * bx, topY, origin.z, this.accentMaterial, 0.2);
    this.createBlock(origin.x + 1.5 * bx, topY, origin.z, this.accentMaterial, 0.2);
  }

  // 2. ELRENDEZÉS: Sziklaszilárd Zikkurat Lépcsős Piramis
  buildPyramid(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const baseOffsetY = 0.015;
    const maxLayers = 4;

    for (let layer = 0; layer < maxLayers; layer++) {
      const y = origin.y + baseOffsetY + by / 2 + layer * by;
      const count = maxLayers - layer + 1; // 5 -> 4 -> 3 -> 2
      const startX = origin.x - ((count - 1) * bx) / 2;

      for (let i = 0; i < count; i++) {
        const x = startX + i * bx;
        const mat = (layer === maxLayers - 1) ? this.accentMaterial : this.stoneMaterial;
        this.createBlock(x, y, origin.z, mat, 0.35);
      }
    }

    // Csúcsbástya
    const topY = origin.y + baseOffsetY + by / 2 + maxLayers * by;
    this.createBlock(origin.x, topY, origin.z, this.accentMaterial, 0.2);
  }

  // 3. ELRENDEZÉS: Két Bástyatorony Masszív Áthidalóval (Nincs kőátfedés!)
  buildTwinTowers(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const baseOffsetY = 0.015;
    const towerH = 4;
    const towerDist = bx * 2; // Pontosan 2 kő távolság: x = -bx és x = +bx, közép = origin.x

    for (let layer = 0; layer < towerH; layer++) {
      const y = origin.y + baseOffsetY + by / 2 + layer * by;
      // Bal torony
      this.createBlock(origin.x - towerDist / 2, y, origin.z, this.stoneMaterial, 0.4);
      // Jobb torony
      this.createBlock(origin.x + towerDist / 2, y, origin.z, this.stoneMaterial, 0.4);

      // 1. szint: masszív kő áthidaló a kapu fölött
      if (layer === 1) {
        this.createBlock(origin.x, y, origin.z, this.stoneMaterial, 0.35);
      }
      // 2. szint: fa függőhíd a kő áthidalóra támaszkodva a két torony között
      else if (layer === 2) {
        this.createBlock(origin.x, y, origin.z, this.woodMaterial, 0.25);
      }
    }

    // Tetődíszek a tornyok tetején
    const topY = origin.y + baseOffsetY + by / 2 + towerH * by;
    this.createBlock(origin.x - towerDist / 2, topY, origin.z, this.accentMaterial, 0.2);
    this.createBlock(origin.x + towerDist / 2, topY, origin.z, this.accentMaterial, 0.2);
  }

  // 4. ELRENDEZÉS: 3D Erőd Citadella
  buildCitadel(origin) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const bz = BLOCK_SIZE.z;
    const baseOffsetY = 0.015;

    for (let layer = 0; layer < 3; layer++) {
      const y = origin.y + baseOffsetY + by / 2 + layer * by;
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) {
          // Csak a középső (1.) szinten van belső kamra; a 0. szint a padló, a 2. szint a stabil zárófödém
          if (layer === 1 && r === 0 && c === 0) continue;
          const x = origin.x + c * bx;
          const z = origin.z + r * bz;
          this.createBlock(x, y, z, this.stoneMaterial, 0.35);
        }
      }
    }

    // 4 sarokbástya a tetőre
    const topY = origin.y + baseOffsetY + by / 2 + 3 * by;
    [-1, 1].forEach(r => {
      [-1, 1].forEach(c => {
        this.createBlock(origin.x + c * bx, topY, origin.z + r * bz, this.accentMaterial, 0.2);
      });
    });

    // Központi őrtorony (szilárdan a 2. szint zárófödémére támaszkodik)
    this.createBlock(origin.x, topY, origin.z, this.woodMaterial, 0.25);
  }

  clear() {
    this.physics.clearCastle();
    for (const mesh of this.blocks) {
      this.scene.remove(mesh);
    }
    for (const p of this.foundationMeshes) {
      this.scene.remove(p);
    }
    this.blocks = [];
    this.foundationMeshes = [];
  }
}
