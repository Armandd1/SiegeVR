import * as THREE from 'three';
import { BLOCK_SIZE } from './physics.js';

export const CASTLE_LAYOUTS = ['fortress', 'pyramid', 'twin_towers', 'citadel'];

export class CastleBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.blocks = [];
    this.allTargetMeshes = [];
    this.castleBounds = new THREE.Box3();
    this.baseOffsetY = 0; // Nincs platform! A vár közvetlenül a felületre épül.

    // A vár aktuális állapota (pozíció, elforgatás, típus) – az újraépítés ugyanezt állítja vissza
    this.currentLayout = null;
    this.origin = new THREE.Vector3();
    this.yaw = 0;

    this.boxGeometry = new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z);
    this.createMaterials();
  }

  createMaterials() {
    // 1. Procedurális középkori kőfal textúra és domborzati térkép (512x512 magas minőség)
    const stoneCanvas = document.createElement('canvas');
    stoneCanvas.width = 512;
    stoneCanvas.height = 512;
    const ctx = stoneCanvas.getContext('2d');

    // Kő alap árnyalat természetes meleg gránit/mészkő átmenettel
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#848d9f');
    grad.addColorStop(0.5, '#717a8c');
    grad.addColorStop(1, '#5e6677');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Kőtégla fuga és kőtömbök rajzolása (staggered ashlar falazás)
    const rows = 4;
    const rowH = 512 / rows;
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1e222a';

    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      ctx.strokeRect(0, y, 512, rowH);

      const offset = (r % 2) * 128;
      for (let x = offset - 128; x <= 512; x += 256) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + rowH);
        ctx.stroke();

        // Finom kőtégla 3D él-árnyékolás és letörés (Beveling)
        // Felső és bal él világos kőcsillanás
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fillRect(x + 5, y + 5, 246, 12);
        ctx.fillRect(x + 5, y + 5, 12, rowH - 10);

        // Alsó és jobb él árnyék
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(x + 5, y + rowH - 16, 246, 11);
        ctx.fillRect(x + 240, y + 5, 11, rowH - 10);

        // Finom kőrétegződés és vésésnyomok
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(x + 20, y + rowH * 0.45, 200, 4);
      }
    }

    // Természetes kőzaj és kőmintázat
    for (let i = 0; i < 2200; i++) {
      const px = Math.random() * 512;
      const py = Math.random() * 512;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.22)';
      const sz = 1.5 + Math.random() * 3.5;
      ctx.fillRect(px, py, sz, sz);
    }

    const stoneTex = new THREE.CanvasTexture(stoneCanvas);
    stoneTex.wrapS = THREE.RepeatWrapping;
    stoneTex.wrapT = THREE.RepeatWrapping;
    stoneTex.colorSpace = THREE.SRGBColorSpace;
    stoneTex.anisotropy = 4;

    const bumpTex = new THREE.CanvasTexture(stoneCanvas);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;

    this.stoneMaterial = new THREE.MeshStandardMaterial({
      map: stoneTex,
      bumpMap: bumpTex,
      bumpScale: 0.004,
      roughness: 0.78,
      metalness: 0.12
    });

    // 2. Erősített tölgyfa gerenda és kapu textúra vas pántokkal és szegecsekkel (256x256)
    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 256;
    woodCanvas.height = 256;
    const wCtx = woodCanvas.getContext('2d');

    // Tölgyfa deszkák
    wCtx.fillStyle = '#5c3216';
    wCtx.fillRect(0, 0, 256, 256);

    // Függőleges deszka rések
    wCtx.fillStyle = '#381c0a';
    wCtx.fillRect(84, 0, 6, 256);
    wCtx.fillRect(168, 0, 6, 256);

    // Fa erezet görbék
    wCtx.strokeStyle = 'rgba(40, 18, 5, 0.55)';
    wCtx.lineWidth = 3;
    for (let y = 10; y < 256; y += 18) {
      wCtx.beginPath();
      wCtx.moveTo(0, y);
      wCtx.bezierCurveTo(70, y + 8, 180, y - 8, 256, y + 4);
      wCtx.stroke();
    }

    // Fekete kovácsoltvas pántok a deszkákon
    wCtx.fillStyle = '#22252a';
    wCtx.fillRect(0, 48, 256, 22);
    wCtx.fillRect(0, 186, 256, 22);

    // Ezüstös acél szegecsek a vaspántokon
    [32, 85, 128, 171, 224].forEach(x => {
      [59, 197].forEach(y => {
        wCtx.beginPath();
        wCtx.arc(x, y, 4, 0, Math.PI * 2);
        wCtx.fillStyle = '#71717a';
        wCtx.fill();
        wCtx.beginPath();
        wCtx.arc(x - 1, y - 1, 1.5, 0, Math.PI * 2);
        wCtx.fillStyle = '#f4f4f5';
        wCtx.fill();
      });
    });

    const woodTex = new THREE.CanvasTexture(woodCanvas);
    woodTex.colorSpace = THREE.SRGBColorSpace;

    this.woodMaterial = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.82,
      metalness: 0.18
    });

    // 3. Királyi bástya díszkövek: nemesi zafírkék és arany szegély (256x256)
    const accentCanvas = document.createElement('canvas');
    accentCanvas.width = 256;
    accentCanvas.height = 256;
    const aCtx = accentCanvas.getContext('2d');

    // Mélykék alap
    const aGrad = aCtx.createLinearGradient(0, 0, 256, 256);
    aGrad.addColorStop(0, '#1e3a8a');
    aGrad.addColorStop(0.5, '#1e40af');
    aGrad.addColorStop(1, '#172554');
    aCtx.fillStyle = aGrad;
    aCtx.fillRect(0, 0, 256, 256);

    // Arany szegélykeret
    aCtx.strokeStyle = '#d97706';
    aCtx.lineWidth = 12;
    aCtx.strokeRect(6, 6, 244, 244);
    aCtx.strokeStyle = '#fbbf24';
    aCtx.lineWidth = 4;
    aCtx.strokeRect(12, 12, 232, 232);

    // Középső heraldikai rombusz
    aCtx.fillStyle = '#f59e0b';
    aCtx.beginPath();
    aCtx.moveTo(128, 64);
    aCtx.lineTo(192, 128);
    aCtx.lineTo(128, 192);
    aCtx.lineTo(64, 128);
    aCtx.closePath();
    aCtx.fill();

    const accentTex = new THREE.CanvasTexture(accentCanvas);
    accentTex.colorSpace = THREE.SRGBColorSpace;

    this.accentMaterial = new THREE.MeshStandardMaterial({
      map: accentTex,
      roughness: 0.42,
      metalness: 0.48
    });

    this.materialsByKey = {
      stone: this.stoneMaterial,
      wood: this.woodMaterial,
      accent: this.accentMaterial
    };

    // 4. Holografikus szellem előnézet anyagok (Ciánkék áttetsző tervrajz)
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
    this.ghostGroup.clear();
    this.ghostLayout = layoutName;

    // Blokkok előnézete a vártípus alapján – közvetlenül a talajon (nincs platform!)
    for (const b of this.getLayoutSpec(layoutName)) {
      const mesh = new THREE.Mesh(this.boxGeometry, this.ghostMaterial);
      mesh.position.set(b.x, b.y, b.z);
      this.ghostGroup.add(mesh);

      const edges = new THREE.LineSegments(this.boxEdgesGeo, this.ghostEdgeMaterial);
      edges.position.set(b.x, b.y, b.z);
      this.ghostGroup.add(edges);
    }
  }

  // Egyetlen közös igazságforrás minden vártípushoz: helyi koordináták + anyag + tömeg.
  // A valós vár és a szellem előnézet is ebből épül, így 100%-ban megegyeznek.
  getLayoutSpec(layoutName) {
    const bx = BLOCK_SIZE.x;
    const by = BLOCK_SIZE.y;
    const bz = BLOCK_SIZE.z;

    // A legalsó sor alsó síkja pontosan a felületen fekszik (y = 0 felület -> kocka közepe by/2)
    const layerY = (layer) => by / 2 + layer * by;
    const spec = [];
    const add = (x, layer, z, mat, mass) => spec.push({ x, y: layerY(layer), z, mat, mass });

    switch (layoutName) {
      // 1. ELRENDEZÉS: 🏰 Királyi Erőd (Impozáns 3D várfal, sarokbástyák, kapuáthidaló, bástyafokok)
      case 'fortress':
      default: {
        // Alapsor (Layer 0): bal torony, fal, kapu-nyílás a közepén, fal, jobb torony
        // Bal sarokbástya (elöl és hátul is tégla a mélységhez)
        add(-2 * bx, 0, 0, 'stone', 0.85);
        add(-2 * bx, 0, bz * 0.5, 'stone', 0.85);
        add(-1 * bx, 0, 0, 'stone', 0.80);
        // Középen (x=0) a nyitott kapu
        add(1 * bx, 0, 0, 'stone', 0.80);
        add(2 * bx, 0, 0, 'stone', 0.85);
        add(2 * bx, 0, bz * 0.5, 'stone', 0.85);

        // Második szint (Layer 1): kapu fölötti tölgyfa áthidaló gerendák + saroktornyok
        add(-2 * bx, 1, 0, 'stone', 0.75);
        add(-2 * bx, 1, bz * 0.5, 'stone', 0.75);
        add(-1 * bx, 1, 0, 'stone', 0.70);
        add(0, 1, 0, 'wood', 0.55); // masszív fa kapugerenda
        add(1 * bx, 1, 0, 'stone', 0.70);
        add(2 * bx, 1, 0, 'stone', 0.75);
        add(2 * bx, 1, bz * 0.5, 'stone', 0.75);

        // Harmadik szint (Layer 2): összefüggő kőfal a várfolyosóval
        add(-2 * bx, 2, 0, 'stone', 0.65);
        add(-1 * bx, 2, 0, 'stone', 0.60);
        add(0, 2, 0, 'stone', 0.60);
        add(1 * bx, 2, 0, 'stone', 0.60);
        add(2 * bx, 2, 0, 'stone', 0.65);

        // Negyedik szint (Layer 3): magasodó saroktornyok és mellvéd
        add(-2 * bx, 3, 0, 'stone', 0.55);
        add(-0.8 * bx, 3, 0, 'stone', 0.50);
        add(0.8 * bx, 3, 0, 'stone', 0.50);
        add(2 * bx, 3, 0, 'stone', 0.55);

        // Ötödik szint (Layer 4): királyi bástyafokok (crenellations) és zászlós csúcsok
        add(-2 * bx, 4, 0, 'accent', 0.35); // bal csúcsbástya
        add(-0.8 * bx, 4, 0, 'accent', 0.28); // mellvéd fog
        add(0.8 * bx, 4, 0, 'accent', 0.28); // mellvéd fog
        add(2 * bx, 4, 0, 'accent', 0.35); // jobb csúcsbástya
        break;
      }

      // 2. ELRENDEZÉS: 🔺 Lépcsős Piramis (Monumentális lépcsős zikkurat erőd)
      case 'pyramid': {
        const maxLayers = 4;
        for (let layer = 0; layer < maxLayers; layer++) {
          const count = maxLayers - layer + 1; // 5 -> 4 -> 3 -> 2
          const startX = -((count - 1) * bx) / 2;
          const mat = (layer === maxLayers - 1) ? 'accent' : 'stone';
          const mass = 0.85 - layer * 0.14;
          for (let i = 0; i < count; i++) {
            add(startX + i * bx, layer, 0, mat, mass);
            // Alsó két szinten mélységi támasztó kövek a masszív, szép megjelenésért
            if (layer === 0 && (i === 0 || i === count - 1)) {
              add(startX + i * bx, layer, bz * 0.5, 'stone', mass);
            }
          }
        }
        // Csúcskirályi oromzat
        add(0, maxLayers, 0, 'accent', 0.30);
        break;
      }

      // 3. ELRENDEZÉS: 🏛️ Kettős Bástya (Két magas torony, masszív alsó boltív és függőhíd)
      case 'twin_towers': {
        const towerH = 4;
        const half = 1.2 * bx;
        for (let layer = 0; layer < towerH; layer++) {
          const mass = 0.80 - layer * 0.12;
          // Bal torony
          add(-half, layer, 0, 'stone', mass);
          add(-half, layer, bz * 0.45, 'stone', mass);
          // Jobb torony
          add(half, layer, 0, 'stone', mass);
          add(half, layer, bz * 0.45, 'stone', mass);

          if (layer === 1) {
            add(0, layer, 0, 'stone', 0.65); // kő áthidaló boltív
          } else if (layer === 2) {
            add(0, layer, 0, 'wood', 0.45);  // fa függőhíd
          }
        }
        // Toronycsúcs bástyafokok
        add(-half, towerH, 0, 'accent', 0.30);
        add(half, towerH, 0, 'accent', 0.30);
        break;
      }

      // 4. ELRENDEZÉS: 🏯 3D Citadella (Négy sarokbástyás zárt erődítmény)
      case 'citadel': {
        for (let layer = 0; layer < 3; layer++) {
          const mass = 0.78 - layer * 0.12;
          for (let r = -1; r <= 1; r++) {
            for (let c = -1; c <= 1; c++) {
              if (layer === 1 && r === 0 && c === 0) continue; // belső udvar üreg
              const mat = (layer === 2 && r === 0 && c === 0) ? 'wood' : 'stone';
              add(c * bx, layer, r * bz, mat, mass);
            }
          }
        }
        // 4 sarokbástya + központi torony
        [-1, 1].forEach(r => [-1, 1].forEach(c => add(c * bx, 3, r * bz, 'accent', 0.32)));
        add(0, 3, 0, 'accent', 0.38);
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

    // Frissítjük a fizikai talajt pontosan a vár alapjának magasságára (nincs platform!)
    this.physics.setGroundHeight(originPos.y);

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

    // Előre gyorsítótárazott kőháló lista + térbeli befoglaló doboz (Box3) a sugárkövetéshez
    this.allTargetMeshes = this.blocks.slice();
    this.castleBounds.makeEmpty();
    for (const mesh of this.allTargetMeshes) {
      this.castleBounds.expandByObject(mesh);
    }
    this.castleBounds.expandByScalar(0.06);
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

  createBlock(worldX, worldY, worldZ, material, mass = 0.65) {
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
    this.blocks = [];
    this.allTargetMeshes = [];
    this.castleBounds.makeEmpty();
  }
}
