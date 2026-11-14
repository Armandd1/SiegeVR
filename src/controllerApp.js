import QRCode from 'qrcode';

// 1€ Filter (One Euro Filter) – Meta Quest szintű adaptív szűrő laptopra
class OneEuroFilter1D {
  constructor(minCutoff = 1.0, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
  filter(x, tMs) {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max(0.003, Math.min(0.2, (tMs - this.tPrev) * 0.001));
    this.tPrev = tMs;
    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    this.dxPrev = edx;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const filtered = this.xPrev + this.alpha(cutoff, dt) * (x - this.xPrev);
    this.xPrev = filtered;
    return filtered;
  }
  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

const roomCodeEl = document.getElementById('room-code');
const connStatusEl = document.getElementById('conn-status');
const btnStartCam = document.getElementById('btn-start-camera');
const videoEl = document.getElementById('webcam');
const canvasEl = document.getElementById('canvas-overlay');
const ctx = canvasEl.getContext('2d');
const hudText = document.getElementById('hud-text');
const latencyBadge = document.getElementById('latency-badge');
const tensionBar = document.getElementById('tension-bar');
const qrCanvas = document.getElementById('qr-canvas');

// 4 jegyű szobakód
const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
roomCodeEl.innerText = roomCode;

// QR kód legenerálása közvetlenül a telefonos játék indító URL-jével
function generateQrCode() {
  const currentHost = window.location.hostname;
  const currentPort = window.location.port ? `:${window.location.port}` : '';
  const protocol = window.location.protocol;
  // A telefon közvetlenül megkapja az URL-ben a connect kódot: ?remote=1234
  const targetUrl = `${protocol}//${currentHost}${currentPort}/?remote=${roomCode}`;
  console.log('Generált telefonos csatlakozási URL:', targetUrl);

  if (qrCanvas) {
    QRCode.toCanvas(qrCanvas, targetUrl, {
      width: 110,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }, (err) => {
      if (err) {
        console.error('QR kód generálási hiba:', err);
      } else {
        console.log('QR kód sikeresen kirajzolva a canvasre!');
      }
    });
  }
}
generateQrCode();

const peerId = `siege-laptop-${roomCode}`;
let peer = null;
let activeConnection = null;

// PeerJS WebRTC P2P kapcsolat
function initPeer() {
  if (typeof window.Peer === 'undefined') {
    setTimeout(initPeer, 250);
    return;
  }
  peer = new window.Peer(peerId, { debug: 1 });

  peer.on('open', (id) => {
    console.log('Laptop Peer aktív:', id);
    connStatusEl.innerText = '🟡 Várakozás a telefonra...';
  });

  peer.on('connection', (conn) => {
    activeConnection = conn;

    conn.on('open', () => {
      connStatusEl.innerText = '🟢 Telefon csatlakoztatva! (P2P aktív)';
      connStatusEl.classList.add('connected');
      if (latencyBadge) latencyBadge.classList.remove('hidden');
    });

    conn.on('data', (data) => {
      if (data && data.type === 'PONG') {
        const ping = Math.round(performance.now() - data.t);
        if (latencyBadge) latencyBadge.innerText = `⚡ Késleltetés: ${ping} ms`;
      }
    });

    conn.on('close', () => {
      connStatusEl.innerText = '🔴 Telefon lekapcsolódott';
      connStatusEl.classList.remove('connected');
      if (latencyBadge) latencyBadge.classList.add('hidden');
      activeConnection = null;
    });
  });

  // Rendszeres ping mérés (2 másodpercenként)
  setInterval(() => {
    if (activeConnection && activeConnection.open) {
      activeConnection.send({ type: 'PING', t: performance.now() });
    }
  }, 2000);
}
initPeer();

// MediaPipe Hands & 1€ Filter
let hands = null;
let camera = null;
let isPinching = false;
let pinchAnchor = { x: 0.5, y: 0.5, z: 0 };
let pinchAnchorScale = 0.22;
let smoothedMid = { x: 0.5, y: 0.5, z: 0 };
let pinchLostAt = 0;
const PINCH_HOLD_GRACE_MS = 140; // Auto-Hold (Coyote-time)

// Finoman hangolt 1€ Filter: álló helyzetben (célzáskor) 100% rezgésmentes, gyors mozgáskor 0 ms késleltetés
const filterX = new OneEuroFilter1D(0.70, 0.08, 1.0);
const filterY = new OneEuroFilter1D(0.70, 0.08, 1.0);
const filterZ = new OneEuroFilter1D(0.65, 0.08, 1.0);
const filterScale = new OneEuroFilter1D(0.50, 0.06, 1.0);

function initMediaPipe() {
  hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  // A laptop processzora könnyen elbírja: Maximális pontosságú (modelComplexity: 1) Full háló!
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence: 0.65
  });

  hands.onResults(onResults);
}

function sendToPhone(data) {
  if (activeConnection && activeConnection.open) {
    activeConnection.send(data);
  }
}

// Kézcsontok kapcsolatai a professzionális sci-fi HUD kirajzoláshoz
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Hüvelykujj
  [0, 5], [5, 6], [6, 7], [7, 8],       // Mutatóujj
  [0, 9], [9, 10], [10, 11], [11, 12],   // Középső ujj
  [0, 13], [13, 14], [14, 15], [15, 16], // Gyűrűsujj
  [0, 17], [17, 18], [18, 19], [19, 20], // Kisujj
  [5, 9], [9, 13], [13, 17]             // Tenyérív
];

function onResults(results) {
  canvasEl.width = videoEl.videoWidth || 1280;
  canvasEl.height = videoEl.videoHeight || 720;
  const now = performance.now();

  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    if (isPinching) {
      if (pinchLostAt === 0) {
        pinchLostAt = now;
      } else if (now - pinchLostAt >= PINCH_HOLD_GRACE_MS) {
        isPinching = false;
        pinchLostAt = 0;
        sendToPhone({ type: 'PINCH_END', fire: false });
        if (tensionBar) tensionBar.style.width = '0%';
      }
    }
    hudText.innerText = '🔍 Kéz keresése... Tartsd a webkamera elé a kezed!';
    ctx.restore();
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const indexDip = landmarks[7];
  const middleTip = landmarks[12];
  const middleMcp = landmarks[9];

  // Tenyér alapmérete normalizáláshoz
  const rawHandScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.22;
  const handScale = filterScale.filter(rawHandScale, now);

  // Kiterjesztett, szögfüggetlen csippentésmérés:
  // Hüvelykujj távolsága a mutatóujj hegyéhez, felső ízületéhez (DIP), vagy középső ujjhoz
  const dThumbIndexTip = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  const dThumbIndexDip = Math.hypot(thumbTip.x - indexDip.x, thumbTip.y - indexDip.y);
  const dThumbMiddleTip = middleTip ? Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y) : 99;
  const pinchDist = Math.min(dThumbIndexTip, dThumbIndexDip * 1.08, dThumbMiddleTip);

  const rawX = (thumbTip.x + indexTip.x) * 0.5;
  const rawY = (thumbTip.y + indexTip.y) * 0.5;
  const rawZ = (thumbTip.z + indexTip.z) * 0.5;

  smoothedMid.x = filterX.filter(rawX, now);
  smoothedMid.y = filterY.filter(rawY, now);
  smoothedMid.z = filterZ.filter(rawZ, now);

  const pinchRatio = pinchDist / Math.max(0.10, handScale);
  
  // Hysterézis a biztos fogáshoz és pontos kilövéshez:
  // Csippentés aktiválása: < 0.38
  // Csippentés megtartása hátrahúzás közben: < 0.54 (nem old ki véletlenül!)
  const isCurrentlyPinched = isPinching ? pinchRatio < 0.54 : pinchRatio < 0.38;

  // Teljes 3D csontváz, célzókereszt és rugalmas feszítésvonal kirajzolása
  drawCyberSkeleton(landmarks, isCurrentlyPinched, thumbTip, indexTip, pinchAnchor, isPinching, smoothedMid);

  if (isCurrentlyPinched) {
    pinchLostAt = 0;
    if (!isPinching) {
      isPinching = true;
      pinchAnchor = { ...smoothedMid };
      pinchAnchorScale = handScale;
      hudText.innerText = '✊ CSIPPENTVE! Húzd hátra vagy lefelé a kezed a feszítéshez!';
      sendToPhone({ type: 'PINCH_START', anchor: pinchAnchor });
    } else {
      // Hibrid Z-mélység:
      // 1. A kéz látszólagos méretének csökkenése a kamera felől távolodva:
      const scaleShrink = (pinchAnchorScale - handScale) / Math.max(0.08, pinchAnchorScale);
      // 2. Relatív Z-mélység változás a MediaPipe-ból:
      const relativeZ = (pinchAnchor.z - smoothedMid.z);
      // 3. Függőleges lefelé húzás (természetes csúzli mozdulat):
      const downwardPull = (smoothedMid.y - pinchAnchor.y);

      // Súlyozott feszítési erő (0.005 .. 0.150):
      const rawTension = Math.max(0, scaleShrink * 0.48) + Math.max(0, relativeZ * 0.35) + Math.max(0, downwardPull * 0.25);
      const pullZ = Math.max(0.005, Math.min(0.150, rawTension));

      // Oldalirányú célzás (X) - tükrözött képernyő korrekció:
      const deltaX = (smoothedMid.x - pinchAnchor.x);
      const pullX = Math.max(-0.10, Math.min(0.10, -deltaX * 0.40));

      // Magassági célzás (Y):
      const deltaY = (pinchAnchor.y - smoothedMid.y);
      const pullY = Math.max(-0.08, Math.min(0.08, -deltaY * 0.35));

      const tensionPct = Math.round(Math.min(100, Math.max(0, (pullZ / 0.12) * 100)));
      if (tensionBar) tensionBar.style.width = `${tensionPct}%`;

      hudText.innerText = `✊ Feszítés: ${tensionPct}% ERŐ | 🎯 Célzás aktív`;
      sendToPhone({ 
        type: 'PINCH_MOVE', 
        delta: { x: pullX, y: pullY, z: pullZ, power: tensionPct } 
      });
    }
  } else if (isPinching) {
    // Határozott elengedés: azonnali kilövés!
    isPinching = false;
    pinchLostAt = 0;
    if (tensionBar) tensionBar.style.width = '0%';
    hudText.innerText = '🚀 KILŐVE!';
    sendToPhone({ type: 'PINCH_END', fire: true });
  } else {
    hudText.innerText = '🖐️ Kéz követve — Csippents a hüvelyk- és mutatóujjaddal!';
    if (tensionBar) tensionBar.style.width = '0%';
  }

  ctx.restore();
}

// Sci-fi stílusú kibernetikus csontváz és AR célzó HUD
function drawCyberSkeleton(landmarks, isPinched, thumb, index, anchor, inPinchMode, currentMid) {
  const w = canvasEl.width;
  const h = canvasEl.height;

  // 1. Csontok kirajzolása (cián kék nyugalomban, arany feszítéskor)
  ctx.lineWidth = isPinched ? 3 : 2;
  ctx.strokeStyle = isPinched ? 'rgba(251, 191, 36, 0.85)' : 'rgba(56, 189, 248, 0.65)';
  ctx.beginPath();
  for (const [start, end] of HAND_CONNECTIONS) {
    const p1 = landmarks[start];
    const p2 = landmarks[end];
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
  }
  ctx.stroke();

  // 2. Ízületi pontok
  ctx.fillStyle = isPinched ? '#fbbf24' : '#38bdf8';
  for (let i = 0; i < landmarks.length; i++) {
    if (i === 4 || i === 8) continue;
    const pt = landmarks[i];
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Ujjvégek pozíciói
  const tx = thumb.x * w;
  const ty = thumb.y * h;
  const ix = index.x * w;
  const iy = index.y * h;
  const mx = (tx + ix) * 0.5;
  const my = (ty + iy) * 0.5;

  // 4. Ha csippentve van: Rugalmas virtuális feszítőgumik & rögzítési célzókereszt
  if (inPinchMode && anchor) {
    const ax = anchor.x * w;
    const ay = anchor.y * h;

    // Feszítésvonal (gumiszalag) a rögzítési pont és a kéz között
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(mx, my);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Rögzítési pont célzókereszt
    ctx.beginPath();
    ctx.arc(ax, ay, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ax - 16, ay); ctx.lineTo(ax + 16, ay);
    ctx.moveTo(ax, ay - 16); ctx.lineTo(ax, ay + 16);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // 5. Csippentő ujjvégek kiemelése
  ctx.beginPath();
  ctx.arc(tx, ty, isPinched ? 9 : 7, 0, Math.PI * 2);
  ctx.arc(ix, iy, isPinched ? 9 : 7, 0, Math.PI * 2);
  ctx.fillStyle = isPinched ? '#ef4444' : '#22c55e';
  ctx.fill();

  // 6. Célzó energiagyűrű a két ujj között
  ctx.beginPath();
  ctx.arc(mx, my, isPinched ? 14 : 9, 0, Math.PI * 2);
  ctx.strokeStyle = isPinched ? '#fbbf24' : '#06b6d4';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

btnStartCam.addEventListener('click', async () => {
  btnStartCam.disabled = true;
  btnStartCam.innerText = '⏳ Kamera inicializálása...';

  initMediaPipe();

  // 1280x720 nagy felbontás a tűpontos ujjkövetéshez
  camera = new window.Camera(videoEl, {
    onFrame: async () => {
      if (hands) {
        await hands.send({ image: videoEl });
      }
    },
    width: 1280,
    height: 720
  });

  await camera.start();
  btnStartCam.innerText = '✅ HD Kamera aktív (60 FPS)';
  hudText.innerText = '🖐️ Tartsd a kezed a webkamera elé!';
});
