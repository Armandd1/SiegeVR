import * as THREE from 'three';
import { BLOCK_SIZE } from './physics.js';

export const CASTLE_LAYOUTS = ['fortress', 'pyramid', 'twin_towers', 'citadel'];
const PLINTH_SIZE = { x: 0.82, z: 0.62 };

export class CastleBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.blocks = [];
    this.foundationMeshes = [];
    this.baseOffsetY = 0.025; // 2.5 cm-es megerősített kőtalapzat

    // A vár aktuális állapota (pozíció, elforgatás, típus) – az újraépítés ugyanezt állítja vissza
    this.currentLayout = null;
    this.origin = new THREE.Vector3();
    this.yaw = 0;

    this.boxGeometry = new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z);
    this.plinthGeometry = new THREE.BoxGeometry(PLINTH_SIZE.x, this.baseOffsetY, PLINTH_SIZE.z);
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
    stoneTex.colorSpace = THREE.SRGBColorSpace;
    stoneTex.anisotropy = 4;

    // A domborzati térkép lineáris adat, ezért külön textúra példányt kap (nem sRGB)
    const bumpTex = new THREE.CanvasTexture(stoneCanvas);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;

    this.stoneMaterial = new THREE.MeshStandardMaterial({
      map: stoneTex,
      bumpMap: bumpTex,
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
    woodTex.colorSpace = THREE.SRGBColorSpace;

    this.woodMaterial = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.85,
      metalness: 0.05
    });

    this.materialsByKey = {
      stone: this.stoneMaterial,
      wood: this.woodMaterial,
      accent: this.accentMaterial
    };

    // 5. Holografikus szellem előnézet anyagok (Kék/cián áttetsző tervrajz)
    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    this.ghostEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.85
    });
    this.boxEdgesGeo = new THREE.EdgesGeometry(this.boxGeometry);
    this.plinthEdgesGeo = new THREE.EdgesGeometry(this.plinthGeometry);

    this.ghostGroup = new THREE.Group();
    this.ghostGroup.visible = false;
    this.ghostLayout = null;
    this.scene.add(this.ghostGroup);
  }

  // Holografikus előnézet megjelenítése a célzó pozíciónál
  showGhost(originPos, layout = null, yaw = this.yaw) {
    const layoutToPreview = layout || this.currentLayout || 'fortress';
    if (this.ghostLayout !== layoutToPreview) {
      this.rebuildGhostModel(layoutToPreview);
    }
    this.ghostGroup.position.copy(originPos);
    this.ghostGroup.rotation.y = yaw;
    this.ghostGroup.visible = true;
  }

  hideGhost() {
    this.ghostGroup.visible = false;
  }

  updateGhostPosition(worldPos, yaw = null) {
    if (this.ghostGroup.visible) {
      this.ghostGroup.position.copy(worldPos);
      if (yaw !== null) this.ghostGroup.rotation.y = yaw;
    }
  }

  rebuildGhostModel(layoutName) {
    // Korábbi szellemelemek eltávolítása (minden geometria megosztott, nincs mit felszabadítani)
    this.ghostGroup.clear();
    this.ghostLayout = layoutName;

    // 1. Kő talapzat szellem
    const plinthY = this.baseOffsetY / 2;
    const plinthMesh = new THREE.Mesh(this.plinthGeometry, this.ghostMaterial);
    plinthMesh.position.set(0, plinthY, 0);
    this.ghostGroup.add(plinthMesh);

    const plinthEdges = new THREE.LineSegments(this.plinthEdgesGeo, this.ghostEdgeMaterial);
    plinthEdges.position.set(0, plinthY, 0);
    this.ghostGroup.add(plinthEdges);

    // 2. Blokkok előnézete a vártípus alapján
    for (const b of this.getLayoutSpec(layoutName)) {
      const mesh = new THREE.Mesh(this.boxGeometry, this.ghostMaterial);
      mesh.position.set(b.x, b.y, b.z);
      this.ghostGroup.add(mesh);

      const edges = new THREE.LineSegments(this.boxEdgesGeo, this.ghostEdgeMaterial);
      edges.position.set(b.x, b.y, b.z);
      this.ghostGroup.add(edges);
    }
  }

  // Egyetlen igazságforrás minden vártípushoz: helyi koordináták + anyag + tömeg.
  // A valós vár és a szellem előnézet is ebből épül, így soha nem térhetnek el egymástól.
  getLayoutSpec(layoutName) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const bz = BLOCK_SIZE.z;
    const layerY = (layer) => this.baseOffsetY + by / 2 + layer * by;
    const spec = [];
    const add = (x, layer, z, mat, mass) => spec.push({ x, y: layerY(layer), z, mat, mass });

    switch (layoutName) {
      // 2. ELRENDEZÉS: Sziklaszilárd Zikkurat Lépcsős Piramis
      case 'pyramid': {
        const maxLayers = 4;
        for (let layer = 0; layer < maxLayers; layer++) {
          const count = maxLayers - layer + 1; // 5 -> 4 -> 3 -> 2
          const startX = -((count - 1) * bx) / 2;
          const mat = layer === maxLayers - 1 ? 'accent' : 'stone';
          for (let i = 0; i < count; i++) {
            add(startX + i * bx, layer, 0, mat, 1.15 - layer * 0.18);
          }
        }
        add(0, maxLayers, 0, 'accent', 0.4); // Csúcsbástya
        break;
      }

      // 3. ELRENDEZÉS: Két Bástyatorony Masszív Áthidalóval
      case 'twin_towers': {
        const towerH = 4;
        const half = bx; // a két torony pontosan 2 kő távolságra
        for (let layer = 0; layer < towerH; layer++) {
          const mass = 1.1 - layer * 0.12;
          add(-half, layer, 0, 'stone', mass);
          add(half, layer, 0, 'stone', mass);
          if (layer === 1) add(0, layer, 0, 'stone', 0.9);      // kő áthidaló a kapu fölött
          else if (layer === 2) add(0, layer, 0, 'wood', 0.6);  // fa függőhíd
        }
        add(-half, towerH, 0, 'accent', 0.45);
        add(half, towerH, 0, 'accent', 0.45);
        break;
      }

      // 4. ELRENDEZÉS: 3D Erőd Citadella
      case 'citadel': {
        for (let layer = 0; layer < 3; layer++) {
          for (let r = -1; r <= 1; r++) {
            for (let c = -1; c <= 1; c++) {
              if (layer === 1 && r === 0 && c === 0) continue;
              add(c * bx, layer, r * bz, 'stone', 1.1 - layer * 0.15);
            }
          }
        }
        // 4 sarokbástya + központi őrtorony
        [-1, 1].forEach(r => [-1, 1].forEach(c => add(c * bx, 3, r * bz, 'accent', 0.4)));
        add(0, 3, 0, 'wood', 0.55);
        break;
      }

      // 1. ELRENDEZÉS: Széles Várfal Kapuval és Bástyafokokkal (lentről felfelé csökkenő tömeg)
      case 'fortress':
      default: {
        for (let c = 0; c < 5; c++) {
          if (c === 2) continue; // kapu rés
          add((c - 2) * bx, 0, 0, 'stone', 1.15);
        }
        for (let c = 0; c < 4; c++) {
          add((c - 1.5) * bx, 1, 0, (c === 1 || c === 2) ? 'wood' : 'stone', 0.95); // áthidaló gerenda
        }
        for (let c = 0; c < 5; c++) add((c - 2) * bx, 2, 0, 'stone', 0.85);
        for (let c = 0; c < 4; c++) add((c - 1.5) * bx, 3, 0, 'stone', 0.75);
        [-1.5, -0.5, 0.5, 1.5].forEach(o => add(o * bx, 4, 0, 'accent', 0.45)); // bástyafokok
        break;
      }
    }

    return spec;
  }

  buildCastleAt(originPos, forceLayout = null, yaw = this.yaw) {
    this.hideGhost();
    this.clear();

    this.origin.copy(originPos);
    this.yaw = yaw;

    // Frissítjük a fizikai talajt pontosan a vár alapjának magasságára
    this.physics.setGroundHeight(originPos.y);

    // Kő udvar / talapzat lehelyezése, ami garantálja a 100%-os stabilitást
    this.createPlinth();

    // A kiválasztott (vagy előnézetben beállított) típus megmarad – csak legelső építéskor véletlenszerű
    this.currentLayout = forceLayout || this.currentLayout
      || CASTLE_LAYOUTS[Math.floor(Math.random() * CASTLE_LAYOUTS.length)];

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const b of this.getLayoutSpec(this.currentLayout)) {
      // Helyi -> világ koordináta a vár Y tengely körüli elforgatásával
      const wx = originPos.x + b.x * cos + b.z * sin;
      const wz = originPos.z - b.x * sin + b.z * cos;
      this.createBlock(wx, originPos.y + b.y, wz, this.materialsByKey[b.mat], b.mass);
    }
  }

  // Ugyanaz a vár, ugyanott, ugyanabban az irányban
  rebuild() {
    this.buildCastleAt(this.origin, this.currentLayout, this.yaw);
  }

  cycleNextLayout(originPos = this.origin) {
    const currentIndex = CASTLE_LAYOUTS.indexOf(this.currentLayout);
    const nextIndex = (currentIndex + 1) % CASTLE_LAYOUTS.length;
    this.buildCastleAt(originPos, CASTLE_LAYOUTS[nextIndex], this.yaw);
    return this.getLayoutTitle();
  }

  getLayoutTitle() {
    switch (this.currentLayout) {
      case 'fortress': return '🏰 Királyi Erőd';
      case 'pyramid': return '🔺 Lépcsős Piramis';
      case 'twin_towers': return '🏛️ Kettős Bástya';
      case 'citadel': return '🏯 3D Citadella';
      default: return '🏰 Vár';
    }
  }

  // Stabil kőtalapzat a vár alá, ami összefogja az árnyékokat és valós fizikai alátámasztást ad
  createPlinth() {
    const plinthSize = { x: PLINTH_SIZE.x, y: this.baseOffsetY, z: PLINTH_SIZE.z };
    const plinthMesh = new THREE.Mesh(this.plinthGeometry, this.foundationMaterial);
    const plinthPos = { x: this.origin.x, y: this.origin.y + plinthSize.y / 2, z: this.origin.z };
    plinthMesh.position.set(plinthPos.x, plinthPos.y, plinthPos.z);
    plinthMesh.rotation.y = this.yaw;
    plinthMesh.receiveShadow = true;
    plinthMesh.userData.isFoundation = true;

    this.scene.add(plinthMesh);
    this.physics.addPlinth(plinthMesh, plinthPos, plinthSize, this.yaw);
    this.foundationMeshes.push(plinthMesh);
  }

  createBlock(worldX, worldY, worldZ, material, mass = 0.85) {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(worldX, worldY, worldZ);
    mesh.rotation.y = this.yaw;
    mesh.userData.isCastleBlock = true;
    mesh.userData.initialPos = new THREE.Vector3(worldX, worldY, worldZ);
    mesh.userData.initialQuat = mesh.quaternion.clone();

    this.scene.add(mesh);
    this.physics.addBox(mesh, { x: worldX, y: worldY, z: worldZ }, mass, true, this.yaw);
    this.blocks.push(mesh);
  }

  clear() {
    this.physics.clearCastle();
    for (const mesh of this.blocks) {
      this.scene.remove(mesh);
    }
    // A talapzat geometriája megosztott, ezért nem szabadítjuk fel
    for (const p of this.foundationMeshes) {
      this.scene.remove(p);
    }
    this.blocks = [];
    this.foundationMeshes = [];
  }
}
