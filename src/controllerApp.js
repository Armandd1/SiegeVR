// Laptop Kéz Kontroller - Nagy pontosságú 60 FPS kézkövetés és WebRTC P2P továbbítás a telefonra

const roomCodeEl = document.getElementById('room-code');
const connStatusEl = document.getElementById('conn-status');
const btnStartCam = document.getElementById('btn-start-camera');
const videoEl = document.getElementById('webcam');
const canvasEl = document.getElementById('canvas-overlay');
const ctx = canvasEl.getContext('2d');
const hudText = document.getElementById('hud-text');

// 4 jegyű véletlenszerű párosítási szoba-kód
const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
roomCodeEl.innerText = roomCode;

const peerId = `siege-laptop-${roomCode}`;
let peer = null;
let activeConnection = null;

// PeerJS inicializálása
function initPeer() {
  if (typeof window.Peer === 'undefined') {
    setTimeout(initPeer, 300);
    return;
  }
  peer = new window.Peer(peerId, {
    debug: 1
  });

  peer.on('open', (id) => {
    console.log('Laptop Peer csatlakozva ID-val:', id);
    connStatusEl.innerText = '🟡 Várakozás a telefon csatlakozására...';
  });

  peer.on('connection', (conn) => {
    console.log('Telefon csatlakozott!');
    activeConnection = conn;

    conn.on('open', () => {
      connStatusEl.innerText = '🟢 Telefon csatlakoztatva! (Valós idejű vezérlés aktív)';
      connStatusEl.classList.add('connected');
    });

    conn.on('close', () => {
      connStatusEl.innerText = '🔴 Telefon lekapcsolódott';
      connStatusEl.classList.remove('connected');
      activeConnection = null;
    });
  });

  peer.on('error', (err) => {
    console.warn('Peer hiba:', err);
  });
}
initPeer();

// MediaPipe Hands inicializálása
let hands = null;
let camera = null;
let isPinching = false;
let pinchAnchor = { x: 0, y: 0, z: 0 };
let smoothedMid = { x: 0.5, y: 0.5, z: 0 };

function initMediaPipe() {
  hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  // Laptopon a nagy pontosságú (modelComplexity: 1) modellt használjuk!
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

function onResults(results) {
  canvasEl.width = videoEl.videoWidth || 640;
  canvasEl.height = videoEl.videoHeight || 480;

  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    hudText.innerText = '🔍 Keresés... Tartsd a kezed a webkamera elé!';
    if (isPinching) {
      isPinching = false;
      sendToPhone({ type: 'PINCH_END', fire: false });
    }
    ctx.restore();
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const thumb = landmarks[4];
  const index = landmarks[8];

  const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.2;
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const dz = (thumb.z - index.z) || 0;
  const pinchDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const rawMid = {
    x: (thumb.x + index.x) * 0.5,
    y: (thumb.y + index.y) * 0.5,
    z: (thumb.z + index.z) * 0.5
  };

  const alpha = 0.65;
  smoothedMid.x = smoothedMid.x * (1 - alpha) + rawMid.x * alpha;
  smoothedMid.y = smoothedMid.y * (1 - alpha) + rawMid.y * alpha;
  smoothedMid.z = smoothedMid.z * (1 - alpha) + rawMid.z * alpha;

  const pinchRatio = pinchDist / handScale;
  const shouldPinch = isPinching ? pinchRatio < 0.45 : pinchRatio < 0.32;

  // Csontváz kirajzolása a laptop képernyőjén
  drawHand(landmarks, shouldPinch);

  if (shouldPinch) {
    if (!isPinching) {
      isPinching = true;
      pinchAnchor = { ...smoothedMid };
      hudText.innerText = '✊ CSIPPENTVE! Húzd hátra a kezed a feszítéshez!';
      sendToPhone({ type: 'PINCH_START', anchor: pinchAnchor });
    } else {
      // Húzási delta számítása
      const deltaX = (pinchAnchor.x - smoothedMid.x) * 2.8;
      const deltaY = (smoothedMid.y - pinchAnchor.y) * 2.8;
      const deltaZ = (pinchAnchor.z - smoothedMid.z) * 3.4;

      hudText.innerText = `✊ Feszítés: Z: ${deltaZ.toFixed(2)} | X: ${deltaX.toFixed(2)}`;
      sendToPhone({ type: 'PINCH_MOVE', delta: { x: deltaX, y: deltaY, z: deltaZ } });
    }
  } else {
    if (isPinching) {
      isPinching = false;
      hudText.innerText = '🚀 KILŐVE!';
      sendToPhone({ type: 'PINCH_END', fire: true });
    } else {
      hudText.innerText = '🖐️ Kéz követve — Csippents a mutató- és hüvelykujjaddal!';
    }
  }

  ctx.restore();
}

function drawHand(landmarks, isPinched) {
  ctx.strokeStyle = isPinched ? '#f59e0b' : '#38bdf8';
  ctx.lineWidth = 3;

  // Hüvelyk és mutató ujjbegy kiemelése
  [4, 8].forEach(idx => {
    const pt = landmarks[idx];
    ctx.beginPath();
    ctx.arc(pt.x * canvasEl.width, pt.y * canvasEl.height, isPinched ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = isPinched ? '#ef4444' : '#22c55e';
    ctx.fill();
    ctx.stroke();
  });
}

btnStartCam.addEventListener('click', async () => {
  btnStartCam.disabled = true;
  btnStartCam.innerText = '⏳ Kamera indítása...';

  initMediaPipe();

  camera = new window.Camera(videoEl, {
    onFrame: async () => {
      if (hands) {
        await hands.send({ image: videoEl });
      }
    },
    width: 640,
    height: 480
  });

  await camera.start();
  btnStartCam.innerText = '✅ Kamera aktív (60 FPS)';
  hudText.innerText = '🖐️ Tartsd a kezed a kamera elé!';
});
