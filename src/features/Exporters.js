import { EmbroideryEncoder } from './EmbroideryEncoder.js';

export class Exporters {
  constructor(camera, latticeGrid, partitionEngine, stitchPen, opticsEngine, multiProjectTabs) {
    this.camera = camera;
    this.latticeGrid = latticeGrid;
    this.partitionEngine = partitionEngine;
    this.stitchPen = stitchPen;
    this.opticsEngine = opticsEngine;
    this.multiProjectTabs = multiProjectTabs;

    this.initUI();
  }

  initUI() {
    const btnSvg = document.getElementById('btn-export-svg');
    const btnPng = document.getElementById('btn-export-png');
    const btnSave = document.getElementById('btn-save-sashiko');
    const btnDst = document.getElementById('btn-export-dst');
    const btnPes = document.getElementById('btn-export-pes');

    if (btnSvg) btnSvg.addEventListener('click', () => this.exportSVG());
    if (btnPng) btnPng.addEventListener('click', () => this.exportPNG());
    if (btnSave) btnSave.addEventListener('click', () => this.saveSashikoFile());
    if (btnDst) btnDst.addEventListener('click', () => this.exportDST());
    if (btnPes) btnPes.addEventListener('click', () => this.exportPES());
  }

  exportDST() {
    const preset = this.camera.artboardPreset || 'design';
    const filename = `sashiko_${preset}_${Date.now()}.dst`;
    const buffer = EmbroideryEncoder.generateDST(this.stitchPen.stitches, this.latticeGrid, 'SASHIKO CAD');
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    this.downloadBlob(blob, filename);
  }

  exportPES() {
    const preset = this.camera.artboardPreset || 'design';
    const filename = `sashiko_${preset}_${Date.now()}.pes`;
    const buffer = EmbroideryEncoder.generatePES(this.stitchPen.stitches, this.latticeGrid, 'SASHIKO CAD');
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    this.downloadBlob(blob, filename);
  }

  exportSVG() {
    const w = this.camera.artboardWidthPx || this.camera.cushionPx;
    const h = this.camera.artboardHeightPx || this.camera.cushionPx;
    const wInches = this.camera.artboardWidthMm ? (this.camera.artboardWidthMm / 25.4) : this.camera.cushionInches;
    const hInches = this.camera.artboardHeightMm ? (this.camera.artboardHeightMm / 25.4) : this.camera.cushionInches;
    const strokeColor = this.opticsEngine.isDark ? '#00ff44' : '#111111';
    const bgColor = this.opticsEngine.bgColor;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${wInches.toFixed(2)}in" height="${hInches.toFixed(2)}in" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bgColor}"/>
  <!-- Seam Allowance 0.75" -->
  <rect x="${0.75 * 96}" y="${0.75 * 96}" width="${Math.max(10, w - 1.5 * 96)}" height="${Math.max(10, h - 1.5 * 96)}" fill="none" stroke="#ffaa00" stroke-width="1.5" stroke-dasharray="8 6" opacity="0.5"/>
  <!-- Partitions -->
  <g id="partitions">
`;

    for (const p of this.partitionEngine.partitions) {
      if (!p.points || p.points.length < 3) continue;
      const pts = p.points.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
      svg += `    <polygon id="${p.id}" points="${pts}" fill="none" stroke="#666666" stroke-width="1" stroke-dasharray="4 4" opacity="0.4"/>\n`;
    }

    svg += `  </g>\n  <!-- Stitches -->\n  <g id="stitches" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round">\n`;

    for (const edge of this.stitchPen.stitches.values()) {
      const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
      svg += `    <line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke-dasharray="12 6"/>\n`;
    }

    svg += `  </g>\n</svg>`;

    const filename = `sashiko_${wInches.toFixed(1)}x${hInches.toFixed(1)}in.svg`;
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename);
  }

  exportPNG() {
    const w = this.camera.artboardWidthPx || this.camera.cushionPx;
    const h = this.camera.artboardHeightPx || this.camera.cushionPx;
    const wInches = this.camera.artboardWidthMm ? (this.camera.artboardWidthMm / 25.4) : this.camera.cushionInches;
    const hInches = this.camera.artboardHeightMm ? (this.camera.artboardHeightMm / 25.4) : this.camera.cushionInches;

    const maxDim = 3840; // 4K Resolution bounding limit
    const scale = maxDim / Math.max(w, h);
    const targetW = Math.round(w * scale);
    const targetH = Math.round(h * scale);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = targetW;
    offCanvas.height = targetH;
    const ctx = offCanvas.getContext('2d');

    // Fill background
    ctx.fillStyle = this.opticsEngine.bgColor;
    ctx.fillRect(0, 0, targetW, targetH);

    // Seam guide
    const seamX = 0.75 * 96 * scale;
    const seamY = 0.75 * 96 * scale;
    ctx.strokeStyle = 'rgba(255, 170, 0, 0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 20]);
    ctx.strokeRect(seamX, seamY, targetW - seamX * 2, targetH - seamY * 2);

    // Stitches
    ctx.strokeStyle = this.opticsEngine.stitchColor;
    ctx.lineWidth = Math.max(3, 5 * (scale / (3840 / 1728)));
    ctx.lineCap = 'round';
    ctx.setLineDash([24, 14]);
    ctx.beginPath();
    for (const edge of this.stitchPen.stitches.values()) {
      const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
      ctx.moveTo(p1.x * scale, p1.y * scale);
      ctx.lineTo(p2.x * scale, p2.y * scale);
    }
    ctx.stroke();

    offCanvas.toBlob((blob) => {
      if (blob) this.downloadBlob(blob, `sashiko_${wInches.toFixed(1)}x${hInches.toFixed(1)}_4K.png`);
    }, 'image/png');
  }

  saveSashikoFile() {
    const data = this.multiProjectTabs.serializeAll();
    const json = JSON.stringify(data, null, 2);
    this.downloadBlob(new Blob([json], { type: 'application/json' }), `sashiko_project_${Date.now()}.sashiko`);
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
