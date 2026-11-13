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
let pinchAnchor = { x: 0, y: 0, z: 0 };
let smoothedMid = { x: 0.5, y: 0.5, z: 0 };
let pinchLostAt = 0;
const PINCH_HOLD_GRACE_MS = 180; // Auto-Hold (Coyote-time)

const filterX = new OneEuroFilter1D(1.1, 0.05, 1.0);
const filterY = new OneEuroFilter1D(1.1, 0.05, 1.0);
const filterZ = new OneEuroFilter1D(1.0, 0.04, 1.0);

function initMediaPipe() {
  hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  // A laptop processzora könnyen elbírja: Maximális pontosságú (modelComplexity: 1) Full háló!
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
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
  const middleMcp = landmarks[9];
  const thumb = landmarks[4];
  const index = landmarks[8];
  const middle = landmarks[12];

  // Skálafüggetlen többujjas csippentés mérése
  const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.22;
  const dThumbIndex = Math.hypot(thumb.x - index.x, thumb.y - index.y);
  const dThumbMiddle = middle ? Math.hypot(thumb.x - middle.x, thumb.y - middle.y) : 99;
  const pinchDist = Math.min(dThumbIndex, dThumbMiddle);

  const rawX = (thumb.x + index.x) * 0.5;
  const rawY = (thumb.y + index.y) * 0.5;
  const rawZ = (thumb.z + index.z) * 0.5;

  // 1€ Filter a tökéletesen sima, remegésmentes és késleltetésmentes követéshez
  smoothedMid.x = filterX.filter(rawX, now);
  smoothedMid.y = filterY.filter(rawY, now);
  smoothedMid.z = filterZ.filter(rawZ, now);

  const pinchRatio = pinchDist / handScale;
  const isCurrentlyPinched = isPinching ? pinchRatio < 0.46 : pinchRatio < 0.35;

  // Teljes 3D csontváz és célzó kirajzolása
  drawCyberSkeleton(landmarks, isCurrentlyPinched, thumb, index);

  if (isCurrentlyPinched) {
    pinchLostAt = 0;
    if (!isPinching) {
      isPinching = true;
      pinchAnchor = { ...smoothedMid };
      hudText.innerText = '✊ CSIPPENTVE! Húzd hátra a kezed a feszítéshez!';
      sendToPhone({ type: 'PINCH_START', anchor: pinchAnchor });
    } else {
      // Érzékeny, dinamikus feszítési vektor számítása
      const deltaX = (pinchAnchor.x - smoothedMid.x) * 3.0;
      const deltaY = (smoothedMid.y - pinchAnchor.y) * 3.0;
      const deltaZ = (pinchAnchor.z - smoothedMid.z) * 3.8;

      const tensionPct = Math.round(Math.min(100, Math.max(0, (deltaZ / 0.15) * 100)));
      if (tensionBar) tensionBar.style.width = `${tensionPct}%`;

      hudText.innerText = `✊ Feszítés: ${tensionPct}% ERŐ | Z: ${deltaZ.toFixed(2)} | X: ${deltaX.toFixed(2)}`;
      sendToPhone({ type: 'PINCH_MOVE', delta: { x: deltaX, y: deltaY, z: deltaZ } });
    }
  } else if (isPinching) {
    // Enyhe szétnyílásnál türelmi idő, határozott elengedésnél azonnali kilövés
    if (pinchRatio < 0.55) {
      if (pinchLostAt === 0) pinchLostAt = now;
      else if (now - pinchLostAt >= 110) {
        isPinching = false;
        pinchLostAt = 0;
        if (tensionBar) tensionBar.style.width = '0%';
        hudText.innerText = '🚀 KILŐVE!';
        sendToPhone({ type: 'PINCH_END', fire: true });
      }
    } else {
      isPinching = false;
      pinchLostAt = 0;
      if (tensionBar) tensionBar.style.width = '0%';
      hudText.innerText = '🚀 KILŐVE!';
      sendToPhone({ type: 'PINCH_END', fire: true });
    }
  } else {
    hudText.innerText = '🖐️ Kéz követve — Csippents a mutató- és hüvelykujjaddal!';
    if (tensionBar) tensionBar.style.width = '0%';
  }

  ctx.restore();
}

// Sci-fi stílusú kibernetikus csontváz kirajzoló
function drawCyberSkeleton(landmarks, isPinched, thumb, index) {
  const w = canvasEl.width;
  const h = canvasEl.height;

  // Csontok kirajzolása neon kék / arany vonalakkal
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = isPinched ? 'rgba(245, 158, 11, 0.7)' : 'rgba(56, 189, 248, 0.6)';
  ctx.beginPath();
  for (const [start, end] of HAND_CONNECTIONS) {
    const p1 = landmarks[start];
    const p2 = landmarks[end];
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
  }
  ctx.stroke();

  // Ízületi pontok
  ctx.fillStyle = isPinched ? '#f59e0b' : '#38bdf8';
  for (let i = 0; i < landmarks.length; i++) {
    if (i === 4 || i === 8) continue;
    const pt = landmarks[i];
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Csippentő ujjvégek kiemelése
  const tx = thumb.x * w;
  const ty = thumb.y * h;
  const ix = index.x * w;
  const iy = index.y * h;
  const mx = (tx + ix) * 0.5;
  const my = (ty + iy) * 0.5;

  ctx.strokeStyle = isPinched ? '#ef4444' : '#22c55e';
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.arc(tx, ty, isPinched ? 10 : 7, 0, Math.PI * 2);
  ctx.arc(ix, iy, isPinched ? 10 : 7, 0, Math.PI * 2);
  ctx.fillStyle = isPinched ? '#ef4444' : '#22c55e';
  ctx.fill();
  ctx.stroke();

  // Célzó kör a két ujj között
  ctx.beginPath();
  ctx.arc(mx, my, isPinched ? 16 : 10, 0, Math.PI * 2);
  ctx.strokeStyle = isPinched ? '#fbbf24' : '#06b6d4';
  ctx.lineWidth = 2;
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
