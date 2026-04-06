const imageInput = document.getElementById("imageInput");
const removeImageBtn = document.getElementById("removeImageBtn");
const exportImageBtn = document.getElementById("exportImageBtn");

const backgroundImage = document.getElementById("backgroundImage");
const drawCanvas = document.getElementById("drawCanvas");

const STORAGE_KEY = "uploadedImage";
/* =========================
   ETAPE 8 — STYLE GRAPHIQUE GLOBAL
========================= */

const currentStyle = {
  strokeColor: "#000000",
  fillColor: "#000000",
  lineWidth: 2,
  opacity: 1,
  fontSize: 16,
  fontFamily: "Arial"
};

/* =========================
   RESTAURATION AU CHARGEMENT
========================= */
const savedImage = localStorage.getItem(STORAGE_KEY);
if (savedImage) {
  backgroundImage.src = savedImage;
}

/* =========================
   UPLOAD + SAUVEGARDE
========================= */
imageInput.addEventListener("change", function () {
  const file = imageInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const dataUrl = e.target.result;
    backgroundImage.src = dataUrl;
    localStorage.setItem(STORAGE_KEY, dataUrl);
  };
  reader.readAsDataURL(file);
});

/* =========================
   SUPPRESSION
========================= */
removeImageBtn.addEventListener("click", function () {
  backgroundImage.src = "";
  imageInput.value = "";
  localStorage.removeItem(STORAGE_KEY);
});

/* =========================
   ETAPE 9 — EXPORT PNG (FOND + CANVAS)
   Résultat : fidèle à l’écran
========================= */
exportImageBtn.addEventListener("click", function () {
  if (!backgroundImage.src) {
    alert("Aucune image à exporter");
    return;
  }

  // sécurité : image bien chargée
  if (!backgroundImage.complete || backgroundImage.naturalWidth === 0) {
    alert("Image en cours de chargement, réessaie dans 1 seconde.");
    return;
  }

  // export à la taille écran (fidèle à ce que tu vois)
  const w = drawCanvas.width;
  const h = drawCanvas.height;

  if (!w || !h) {
    alert("Canvas non prêt (charge une image d'abord).");
    return;
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = w;
  exportCanvas.height = h;

  const exportCtx = exportCanvas.getContext("2d");

  // 1) fond (image affichée, même taille que l’écran)
  exportCtx.drawImage(backgroundImage, 0, 0, w, h);

  // 2) dessin (canvas par-dessus)
  exportCtx.drawImage(drawCanvas, 0, 0);

  // 3) téléchargement PNG
  const link = document.createElement("a");
  link.download = "export-final.png";
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
});

function syncCanvasSize() {
  if (!backgroundImage.src) return;

  drawCanvas.width = backgroundImage.clientWidth;
  drawCanvas.height = backgroundImage.clientHeight;

  drawCanvas.style.width = backgroundImage.clientWidth + "px";
  drawCanvas.style.height = backgroundImage.clientHeight + "px";
}

// quand l’image est chargée
backgroundImage.onload = function () {
  syncCanvasSize();
};

// au redimensionnement de la fenêtre
window.addEventListener("resize", syncCanvasSize);

/* =========================
   ETAPE 9.2 — EXPORT JPG
   Qualité fixe (0.9)
========================= */
const exportJpgBtn = document.getElementById("exportJpgBtn");

exportJpgBtn.addEventListener("click", function () {
  if (!backgroundImage.src) {
    alert("Aucune image à exporter");
    return;
  }

  const w = drawCanvas.width;
  const h = drawCanvas.height;
  if (!w || !h) {
    alert("Canvas non prêt");
    return;
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = w;
  exportCanvas.height = h;

  const ctx = exportCanvas.getContext("2d");

  // fond
  ctx.drawImage(backgroundImage, 0, 0, w, h);
  // dessin
  ctx.drawImage(drawCanvas, 0, 0);

  const link = document.createElement("a");
  link.download = "export-final.jpg";
  link.href = exportCanvas.toDataURL("image/jpeg", 0.9); // QUALITÉ FIXE
  link.click();
});

/* =========================
   OBJET SIMPLE + SELECTION
========================= */

const ctx = drawCanvas.getContext("2d");

// objet unique pour commencer
const object = {
  x: 100,
  y: 100,
  width: 150,
  height: 80,
  rotation: 0,
  selected: false
};

/* =========================
   HISTORIQUE (UNDO / REDO)
========================= */

let undoStack = [];
let redoStack = [];

function saveState() {
  // clone simple de l'état de l'objet
  undoStack.push(JSON.stringify(object));
  // toute nouvelle action invalide le redo
  redoStack = [];
}


function draw() {
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;

  /* =====================
     OBJET (AVEC ROTATION)
  ===================== */
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(object.rotation);
  ctx.translate(-cx, -cy);

  ctx.fillStyle = object.selected
    ? "rgba(0, 150, 255, 0.5)"
    : "rgba(0, 150, 255, 0.3)";
  ctx.fillRect(object.x, object.y, object.width, object.height);

  if (object.selected) {
    ctx.strokeStyle = "blue";
    ctx.lineWidth = 2;
    ctx.strokeRect(object.x, object.y, object.width, object.height);
  }

  ctx.restore();

  /* =====================
     POIGNÉES (SANS ROTATION)
  ===================== */
  if (object.selected) {
    // poignée resize
    ctx.fillStyle = "blue";
    ctx.fillRect(
      object.x + object.width - resizeHandleSize,
      object.y + object.height - resizeHandleSize,
      resizeHandleSize,
      resizeHandleSize
    );

    // poignée rotation (cercle AU-DESSUS, stable)
    ctx.beginPath();
    ctx.arc(cx, object.y - 20, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}



// clic souris → sélection
drawCanvas.addEventListener("click", function (e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  object.selected =
    mouseX >= object.x &&
    mouseX <= object.x + object.width &&
    mouseY >= object.y &&
    mouseY <= object.y + object.height;

  draw();
});

// premier rendu
draw();
saveState();

/* =========================
   DEPLACEMENT (DRAG)
========================= */

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

drawCanvas.addEventListener("mousedown", function (e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (
    mouseX >= object.x &&
    mouseX <= object.x + object.width &&
    mouseY >= object.y &&
    mouseY <= object.y + object.height
  ) {
    object.selected = true;
    isDragging = true;
    dragOffsetX = mouseX - object.x;
    dragOffsetY = mouseY - object.y;
    draw();
  }
});

drawCanvas.addEventListener("mousemove", function (e) {
  if (!isDragging || !object.selected) return;

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  object.x = mouseX - dragOffsetX;
  object.y = mouseY - dragOffsetY;

  draw();
});

window.addEventListener("mouseup", function () {
  if (isDragging || isResizing || isRotating) {
    saveState();
  }
  isDragging = false;
  isResizing = false;
  isRotating = false;
});


/* =========================
   REDIMENSIONNEMENT
========================= */

const resizeHandleSize = 10;
let isResizing = false;

function isOnResizeHandle(mouseX, mouseY) {
  return (
    mouseX >= object.x + object.width - resizeHandleSize &&
    mouseX <= object.x + object.width &&
    mouseY >= object.y + object.height - resizeHandleSize &&
    mouseY <= object.y + object.height
  );
}

// handle souris
drawCanvas.addEventListener("mousedown", function (e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (object.selected && isOnResizeHandle(mouseX, mouseY)) {
    isResizing = true;
    isDragging = false;
  }
});

drawCanvas.addEventListener("mousemove", function (e) {
  if (!isResizing) return;

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  object.width = Math.max(20, mouseX - object.x);
  object.height = Math.max(20, mouseY - object.y);

  draw();
});

window.addEventListener("mouseup", function () {
  isResizing = false;
});

/* =========================
   ROTATION
========================= */

let isRotating = false;

function isOnRotateHandle(mouseX, mouseY) {
  const cx = object.x + object.width / 2;
  const handleX = cx;
  const handleY = object.y - 15;

  const dx = mouseX - handleX;
  const dy = mouseY - handleY;

  return Math.sqrt(dx * dx + dy * dy) <= 8;
}

drawCanvas.addEventListener("mousedown", function (e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (object.selected && isOnRotateHandle(mouseX, mouseY)) {
    isRotating = true;
    isDragging = false;
    isResizing = false;
  }
});

drawCanvas.addEventListener("mousemove", function (e) {
  if (!isRotating) return;

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;

  object.rotation = Math.atan2(mouseY - cy, mouseX - cx);
  draw();
});

window.addEventListener("mouseup", function () {
  isRotating = false;
});
/* =========================
   SUPPRESSION + Z-INDEX SIMPLE
========================= */

// z-index simulé (préparation multi-objets)
let objects = [object];

// suppression clavier
window.addEventListener("keydown", function (e) {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (object.selected) {
      object.selected = false;
      objects = []; // plus d’objet
      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
  }
});
/* =========================
   UNDO (Ctrl + Z)
========================= */

window.addEventListener("keydown", function (e) {
  if (e.ctrlKey && e.key === "z") {
    // il faut au moins 2 états pour revenir en arrière
    if (undoStack.length > 1) {
      // état actuel → redo
      const current = undoStack.pop();
      redoStack.push(current);

      // état précédent → restauration
      const previous = undoStack[undoStack.length - 1];
      Object.assign(object, JSON.parse(previous));
      draw();
    }
  }
});
/* =========================
   REDO (Ctrl + Y)
========================= */

window.addEventListener("keydown", function (e) {
  if (e.ctrlKey && e.key === "y") {
    if (redoStack.length > 0) {
      const next = redoStack.pop();
      undoStack.push(next);

      Object.assign(object, JSON.parse(next));
      draw();
    }
  }
});
/* =========================
   ETAPE 7 — OUTIL LIGNE
========================= */

let lineStart = null;
let lineEnd = null;
drawCanvas.addEventListener("click", function (e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 1er clic → point de départ
  if (!lineStart) {
    lineStart = { x: mouseX, y: mouseY };
    return;
  }

  // 2e clic → point d’arrivée
  lineEnd = { x: mouseX, y: mouseY };

  drawLine();
});
function drawLine() {
  if (!lineStart || !lineEnd) return;

  const ctx = drawCanvas.getContext("2d");

  ctx.beginPath();
  ctx.moveTo(lineStart.x, lineStart.y);
  ctx.lineTo(lineEnd.x, lineEnd.y);
  ctx.strokeStyle = currentStyle.strokeColor;
  ctx.lineWidth = currentStyle.lineWidth;
  ctx.globalAlpha = currentStyle.opacity;
  ctx.stroke();
  ctx.globalAlpha = 1;


  // reset pour prochaine ligne
  lineStart = null;
  lineEnd = null;
}

/* =========================
   ETAPE 7 — OUTIL FLÈCHE
========================= */

let arrowStart = null;
let arrowEnd = null;
drawCanvas.addEventListener("contextmenu", function (e) {
  e.preventDefault();

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 1er clic droit → départ
  if (!arrowStart) {
    arrowStart = { x: mouseX, y: mouseY };
    return;
  }

  // 2e clic droit → arrivée
  arrowEnd = { x: mouseX, y: mouseY };
  drawArrow();
});
function drawArrow() {
  if (!arrowStart || !arrowEnd) return;

  const ctx = drawCanvas.getContext("2d");
  const headLength = 10;

  const dx = arrowEnd.x - arrowStart.x;
  const dy = arrowEnd.y - arrowStart.y;
  const angle = Math.atan2(dy, dx);

  // ligne principale
  ctx.beginPath();
  ctx.moveTo(arrowStart.x, arrowStart.y);
  ctx.lineTo(arrowEnd.x, arrowEnd.y);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  // pointe
  ctx.beginPath();
  ctx.moveTo(arrowEnd.x, arrowEnd.y);
  ctx.lineTo(
    arrowEnd.x - headLength * Math.cos(angle - Math.PI / 6),
    arrowEnd.y - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    arrowEnd.x - headLength * Math.cos(angle + Math.PI / 6),
    arrowEnd.y - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.lineTo(arrowEnd.x, arrowEnd.y);
  ctx.fillStyle = "black";
  ctx.fill();

  // reset
  arrowStart = null;
  arrowEnd = null;
}

/* =========================
   ETAPE 7 — OUTIL RECTANGLE
========================= */

let rectStart = null;
let rectEnd = null;
drawCanvas.addEventListener("click", function (e) {
  if (!e.shiftKey) return;

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 1er clic (Shift) → départ
  if (!rectStart) {
    rectStart = { x: mouseX, y: mouseY };
    return;
  }

  // 2e clic (Shift) → arrivée
  rectEnd = { x: mouseX, y: mouseY };
  drawRectangle();
});
function drawRectangle() {
  if (!rectStart || !rectEnd) return;

  const ctx = drawCanvas.getContext("2d");

  const x = Math.min(rectStart.x, rectEnd.x);
  const y = Math.min(rectStart.y, rectEnd.y);
  const w = Math.abs(rectEnd.x - rectStart.x);
  const h = Math.abs(rectEnd.y - rectStart.y);

  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // reset
  rectStart = null;
  rectEnd = null;
}

/* =========================
   ETAPE 7 — OUTIL CERCLE
========================= */

let circleCenter = null;
let circleRadius = 0;
drawCanvas.addEventListener("click", function (e) {
  if (!e.altKey) return;

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 1er clic (Alt) → centre
  if (!circleCenter) {
    circleCenter = { x: mouseX, y: mouseY };
    return;
  }

  // 2e clic (Alt) → rayon
  circleRadius = Math.hypot(
    mouseX - circleCenter.x,
    mouseY - circleCenter.y
  );

  drawCircle();
});
function drawCircle() {
  if (!circleCenter || circleRadius <= 0) return;

  const ctx = drawCanvas.getContext("2d");

  ctx.beginPath();
  ctx.arc(circleCenter.x, circleCenter.y, circleRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  // reset
  circleCenter = null;
  circleRadius = 0;
}
/* =========================
   ETAPE 7 — OUTIL TRIANGLE
========================= */

let trianglePoints = [];
drawCanvas.addEventListener("click", function (e) {
  if (!e.ctrlKey) return;

  const rect = drawCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  trianglePoints.push({ x: mouseX, y: mouseY });

  if (trianglePoints.length === 3) {
    drawTriangle();
  }
});
function drawTriangle() {
  if (trianglePoints.length !== 3) return;

  const ctx = drawCanvas.getContext("2d");

  ctx.beginPath();
  ctx.moveTo(trianglePoints[0].x, trianglePoints[0].y);
  ctx.lineTo(trianglePoints[1].x, trianglePoints[1].y);
  ctx.lineTo(trianglePoints[2].x, trianglePoints[2].y);
  ctx.closePath();

  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  // reset
  trianglePoints = [];
}



drawCanvas.addEventListener("dblclick", function (e) {
  const text = prompt("Texte à ajouter :");
  if (!text) return;

  const rect = drawCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  drawText(text, x, y);
});
function drawText(text, x, y) {
  const ctx = drawCanvas.getContext("2d");

  ctx.font = `${currentStyle.fontSize}px ${currentStyle.fontFamily}`;
ctx.fillStyle = currentStyle.fillColor;
ctx.globalAlpha = currentStyle.opacity;
ctx.fillText(text, x, y);
ctx.globalAlpha = 1;

}
/* =========================
   ETAPE 8 — STYLES GRAPHIQUES (CLAVIER)
   Ligne + Texte
========================= */

window.addEventListener("keydown", function (e) {
  const key = e.key.toLowerCase();

  /* =====================
     ÉPAISSEUR LIGNE
     [+] / [-]
  ===================== */
  if (key === "+") {
    currentStyle.lineWidth = Math.min(10, currentStyle.lineWidth + 1);
    return;
  }

  if (key === "-") {
    currentStyle.lineWidth = Math.max(1, currentStyle.lineWidth - 1);
    return;
  }

  /* =====================
     OPACITÉ
     [O] / [P]
  ===================== */
  if (key === "o") {
    currentStyle.opacity = Math.max(
      0.1,
      +(currentStyle.opacity - 0.1).toFixed(2)
    );
    return;
  }

  if (key === "p") {
    currentStyle.opacity = Math.min(
      1,
      +(currentStyle.opacity + 0.1).toFixed(2)
    );
    return;
  }

  /* =====================
     COULEUR LIGNE
     [1] [2] [3]
  ===================== */
  if (key === "1") {
    currentStyle.strokeColor = "#000000"; // noir DP
    return;
  }

  if (key === "2") {
    currentStyle.strokeColor = "#444444"; // gris foncé
    return;
  }

  if (key === "3") {
    currentStyle.strokeColor = "#888888"; // gris clair
    return;
  }

  /* =====================
     TAILLE TEXTE
     [T] / [Y]
  ===================== */
  if (key === "t") {
    currentStyle.fontSize = Math.max(10, currentStyle.fontSize - 1);
    return;
  }

  if (key === "y") {
    currentStyle.fontSize = Math.min(40, currentStyle.fontSize + 1);
    return;
  }
});
