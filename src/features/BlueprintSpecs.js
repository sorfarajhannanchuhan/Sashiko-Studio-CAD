/**
 * Sashiko Studio CAD - Blueprint Metrics & Artisan Spec Sheet Generator
 * Real-time calculation of stitches, thread meters, SPI, and fabric cut dimensions.
 */

export class BlueprintSpecs {
  constructor(camera, latticeGrid, stitchPen, subLabManager = null) {
    this.camera = camera;
    this.latticeGrid = latticeGrid;
    this.stitchPen = stitchPen;
    this.subLabManager = subLabManager;

    this.initUI();
  }

  initUI() {
    const btnPrint = document.getElementById('btn-print-artisan-sheet');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        this.printArtisanSheet();
      });
    }

    const btnTiled = document.getElementById('btn-print-tiled-stencil');
    if (btnTiled) {
      btnTiled.addEventListener('click', () => {
        this.printTiledStencil();
      });
    }

    const inputPitch = document.getElementById('input-stitch-pitch');
    const valPitch = document.getElementById('val-stitch-pitch');
    if (inputPitch && valPitch) {
      inputPitch.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        valPitch.textContent = `${val.toFixed(1)}mm`;
        this.latticeGrid.pitchMm = val;
        this.camera.requestRender();
        this.updateMetrics();
      });
    }
  }

  updateMetrics() {
    const stitchCount = this.stitchPen.stitches.size;
    const pitchMm = this.latticeGrid.pitchMm;
    const cushionInches = this.camera.cushionInches;

    // Stitches per inch
    const spi = (25.4 / pitchMm).toFixed(1);

    // Thread consumption: stitch length + back transit + 35% tension & Nakshi batting allowance
    const stitchLengthMm = pitchMm;
    const totalThreadMeters = ((stitchCount * stitchLengthMm * 1.35) / 1000).toFixed(1);

    // 40-meter skein requirement & artisan hand hours (140 stitches/hr)
    const skeins = Math.max(1, Math.ceil(parseFloat(totalThreadMeters) / 40));
    const hours = (stitchCount / 140).toFixed(1);

    // Fabric cut size: Cushion size + 2 x 0.75" seam margin
    const seamAllowanceInches = 0.75;
    const cutInches = cushionInches + seamAllowanceInches * 2;
    const cutStr = `${cutInches.toFixed(1)}"×${cutInches.toFixed(1)}"`;

    // DOM update
    const elStitches = document.getElementById('spec-stitch-count');
    const elThread = document.getElementById('spec-thread-meters');
    const elSkeins = document.getElementById('spec-skeins');
    const elHours = document.getElementById('spec-hours');
    const elSpi = document.getElementById('spec-spi');
    const elCut = document.getElementById('spec-cut-size');

    if (elStitches) elStitches.textContent = stitchCount.toLocaleString();
    if (elThread) elThread.textContent = `${totalThreadMeters}m`;
    if (elSkeins) elSkeins.textContent = `${skeins} skeins`;
    if (elHours) elHours.textContent = `${hours}h`;
    if (elSpi) elSpi.textContent = `~${spi}`;
    if (elCut) elCut.textContent = cutStr;

    const elCuttingSchedule = document.getElementById('cutting-schedule-container');
    if (elCuttingSchedule) {
      const cuttingList = this.generateCuttingList();
      if (cuttingList.length > 0) {
        elCuttingSchedule.innerHTML = `
          <table class="cad-mini-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Finished</th>
                <th>Cut (+0.5")</th>
              </tr>
            </thead>
            <tbody>
              ${cuttingList.map(item => `
                <tr>
                  <td><strong>${item.label}</strong></td>
                  <td>${item.finishedIn}</td>
                  <td><strong style="color:var(--accent-green, #38BDF8)">${item.cutIn}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else {
        elCuttingSchedule.innerHTML = `<div style="padding:6px 8px;font-size:10px;color:var(--text-muted)">Single 1-piece cushion: ${cutStr} (with 0.75" perimeter seam)</div>`;
      }
    }
  }

  generateCuttingList() {
    if (!this.subLabManager || !this.subLabManager.partitions) return [];
    const ppi = this.camera.ppi || 96;
    const seamMarginInches = 0.5; // Standard 1/2" seam allowance

    return this.subLabManager.partitions.map(p => {
      const pts = p.points || [];
      if (pts.length < 3) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      pts.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      });

      const finishedWIn = (maxX - minX) / ppi;
      const finishedHIn = (maxY - minY) / ppi;
      const cutWIn = finishedWIn + seamMarginInches * 2;
      const cutHIn = finishedHIn + seamMarginInches * 2;

      return {
        id: p.id,
        label: p.label || p.id,
        name: p.name || p.id,
        fabricColor: p.fabricColor || 'Base Canvas',
        finishedIn: `${finishedWIn.toFixed(2)}" × ${finishedHIn.toFixed(2)}"`,
        finishedCm: `${(finishedWIn * 2.54).toFixed(1)} × ${(finishedHIn * 2.54).toFixed(1)} cm`,
        cutIn: `${cutWIn.toFixed(2)}" × ${cutHIn.toFixed(2)}"`,
        cutCm: `${(cutWIn * 2.54).toFixed(1)} × ${(cutHIn * 2.54).toFixed(1)} cm`
      };
    }).filter(Boolean);
  }

  printArtisanSheet() {
    this.updateMetrics();
    const sheetEl = document.getElementById('printable-artisan-sheet');
    if (!sheetEl) return;

    const stitchCount = this.stitchPen.stitches.size;
    const pitchMm = this.latticeGrid.pitchMm;
    const spi = (25.4 / pitchMm).toFixed(1);
    const cushionInches = this.camera.cushionInches;
    const cutInches = (cushionInches + 1.5).toFixed(1);
    const threadM = ((stitchCount * pitchMm * 1.35) / 1000).toFixed(1);
    const threadYds = (parseFloat(threadM) * 1.0936).toFixed(1);

    const cuttingList = this.generateCuttingList();
    const cuttingRowsHtml = cuttingList.length > 0
      ? cuttingList.map(item => `
          <tr>
            <td><strong>${item.label}</strong></td>
            <td>${item.name}</td>
            <td><span style="display:inline-block;width:12px;height:12px;vertical-align:middle;margin-right:6px;border-radius:2px;background:${item.fabricColor.startsWith('#') ? item.fabricColor : '#334155'};"></span>${item.fabricColor}</td>
            <td>${item.finishedIn} (${item.finishedCm})</td>
            <td><strong>${item.cutIn} (${item.cutCm})</strong></td>
          </tr>
        `).join('')
      : `<tr><td colspan="5">Full 1-piece cushion: ${cutInches}" × ${cutInches}" (with 0.75" perimeter seam margin)</td></tr>`;

    const now = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    sheetEl.innerHTML = `
      <div class="artisan-print-page">
        <div class="print-header">
          <div class="brand">
            <h1>SASHIKO STUDIO CAD</h1>
            <p>Japanese Sashiko &amp; Geometric Patchwork Cushion Blueprint</p>
          </div>
          <div class="date-meta">
            <span>Date: ${now}</span>
            <span>Scale: 1:1 Production Spec</span>
          </div>
        </div>

        <div class="print-divider"></div>

        <div class="print-grid-2">
          <div class="print-card">
            <h3>PHYSICAL FABRIC SPECIFICATIONS</h3>
            <table class="print-table">
              <tr><td>Finished Cushion Size:</td><td><strong>${cushionInches}" × ${cushionInches}"</strong> (${(cushionInches * 2.54).toFixed(1)}cm)</td></tr>
              <tr><td>Raw Fabric Cut Size:</td><td><strong>${cutInches}" × ${cutInches}"</strong></td></tr>
              <tr><td>Seam Allowance Margin:</td><td>0.75" (1.9 cm) perimeter / 0.5" internal patchwork</td></tr>
              <tr><td>Recommended Fabric:</td><td>Heavy Linen, Cotton Twill, Indigo Canvas</td></tr>
              <tr><td>Stabilizer / Batting:</td><td>Lightweight Fusible Interfacing</td></tr>
            </table>
          </div>

          <div class="print-card">
            <h3>STITCH &amp; THREAD METRICS</h3>
            <table class="print-table">
              <tr><td>Total Stitches:</td><td><strong>${stitchCount.toLocaleString()} stitches</strong></td></tr>
              <tr><td>Stitch Pitch:</td><td>${pitchMm.toFixed(1)} mm (~${spi} SPI)</td></tr>
              <tr><td>Estimated Thread Required:</td><td><strong>${threadM} meters</strong> (${threadYds} yards)</td></tr>
              <tr><td>Recommended Thread:</td><td>20/4 or 20/6 Sashiko Cotton / DMC Pearl #8</td></tr>
              <tr><td>Needle Type:</td><td>Traditional Long Sashiko Needle</td></tr>
            </table>
          </div>
        </div>

        <div class="print-card full-width mt-3">
          <h3>CUSHION PATCHWORK CUTTING SCHEDULE (0.5" SEAM ALLOWANCE INCLUDED)</h3>
          <table class="print-table">
            <thead>
              <tr style="background: rgba(0,0,0,0.04); font-weight: bold;">
                <th>Part</th>
                <th>Description</th>
                <th>Fabric / Color</th>
                <th>Finished Size</th>
                <th>Cut Size (+0.5" Seam)</th>
              </tr>
            </thead>
            <tbody>
              ${cuttingRowsHtml}
            </tbody>
          </table>
        </div>

        <div class="print-card full-width mt-3">
          <h3>ARTISAN WORKSHOP EXECUTION GUIDELINES</h3>
          <ul class="artisan-notes">
            <li><strong>Seam Allowance Safety:</strong> The outer 0.75-inch perimeter is reserved for zipper insertion and cushion seam closure. Do not extend embroidery into the seam margin.</li>
            <li><strong>Interfacing Application:</strong> Press lightweight fusible interfacing to the reverse fabric prior to stitching to lock weave tension and prevent fabric puckering.</li>
            <li><strong>Thread Tension:</strong> Maintain relaxed hand tension. Leave slight thread slack at corners to accommodate cushion stuffing expansion.</li>
          </ul>
        </div>

        <div class="print-footer">
          <span>Generated with Sashiko Studio CAD • Localhost High-Precision Textile Suite</span>
        </div>
      </div>
    `;

    window.print();
  }

  printTiledStencil() {
    this.updateMetrics();
    const sheetEl = document.getElementById('printable-artisan-sheet');
    if (!sheetEl) return;

    const cushionInches = this.camera.cushionInches;
    const cushionPx = this.camera.cushionPx;
    const halfPx = cushionPx / 2;
    const pitchMm = this.latticeGrid.pitchMm;
    const spi = (25.4 / pitchMm).toFixed(1);
    const stitchCount = this.stitchPen.stitches.size;
    const overlapPx = 48; // 0.5" overlap for registration taping

    const tiles = [
      {
        row: 1,
        col: 1,
        name: 'Top-Left Quadrant',
        minX: 0,
        minY: 0,
        maxX: halfPx + overlapPx,
        maxY: halfPx + overlapPx,
        alignNote: 'Right edge overlaps Tile [1, 2] by 0.5" • Bottom edge overlaps Tile [2, 1] by 0.5"'
      },
      {
        row: 1,
        col: 2,
        name: 'Top-Right Quadrant',
        minX: halfPx - overlapPx,
        minY: 0,
        maxX: cushionPx,
        maxY: halfPx + overlapPx,
        alignNote: 'Left edge overlaps Tile [1, 1] by 0.5" • Bottom edge overlaps Tile [2, 2] by 0.5"'
      },
      {
        row: 2,
        col: 1,
        name: 'Bottom-Left Quadrant',
        minX: 0,
        minY: halfPx - overlapPx,
        maxX: halfPx + overlapPx,
        maxY: cushionPx,
        alignNote: 'Top edge overlaps Tile [1, 1] by 0.5" • Right edge overlaps Tile [2, 2] by 0.5"'
      },
      {
        row: 2,
        col: 2,
        name: 'Bottom-Right Quadrant',
        minX: halfPx - overlapPx,
        minY: halfPx - overlapPx,
        maxX: cushionPx,
        maxY: cushionPx,
        alignNote: 'Top edge overlaps Tile [1, 2] by 0.5" • Left edge overlaps Tile [2, 1] by 0.5"'
      }
    ];

    // Pre-extract all stitch lines
    const stitchLines = [];
    for (const stitch of this.stitchPen.stitches.values()) {
      const p1 = this.latticeGrid.nodeToWorld(stitch.u[0], stitch.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(stitch.v[0], stitch.v[1]);
      stitchLines.push({ p1, p2 });
    }

    // Pre-extract Sub-Lab partitions
    const partitionPolys = [];
    if (this.stitchPen.subLabManager && this.stitchPen.subLabManager.partitions) {
      for (const partition of this.stitchPen.subLabManager.partitions.values()) {
        if (partition.points && partition.points.length >= 3) {
          partitionPolys.push(partition.points);
        }
      }
    }

    let pagesHtml = '';

    tiles.forEach((tile, idx) => {
      const vw = tile.maxX - tile.minX;
      const vh = tile.maxY - tile.minY;

      // Filter stitches in this tile's bbox
      const visibleStitches = stitchLines.filter(({ p1, p2 }) => {
        const inX = (p1.x >= tile.minX - 10 && p1.x <= tile.maxX + 10) || (p2.x >= tile.minX - 10 && p2.x <= tile.maxX + 10);
        const inY = (p1.y >= tile.minY - 10 && p1.y <= tile.maxY + 10) || (p2.y >= tile.minY - 10 && p2.y <= tile.maxY + 10);
        return inX && inY;
      });

      const stitchesSvg = visibleStitches.map(({ p1, p2 }) =>
        `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="7,4" />`
      ).join('');

      const partitionsSvg = partitionPolys.map((pts) => {
        const ptsStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        return `<polygon points="${ptsStr}" fill="none" stroke="#059669" stroke-width="1.5" stroke-dasharray="6,4" />`;
      }).join('');

      pagesHtml += `
        <div class="tiled-stencil-page">
          <div class="stencil-header">
            <span class="tile-title">SASHIKO STUDIO CAD — 1:1 STENCIL TILE [${tile.row}, ${tile.col}] of 2×2</span>
            <div class="tile-meta">
              <span>Quadrant: ${tile.name}</span>
              <span>Cushion: ${cushionInches}"×${cushionInches}"</span>
              <span>Pitch: ${pitchMm.toFixed(1)}mm (~${spi} SPI)</span>
            </div>
          </div>

          <div class="stencil-sub-header">
            <div class="stencil-instructions">
              <strong>Artisan Assembly Instructions:</strong><br/>
              1. Verify 1.0" calibration box at right with ruler (Print at 100% / Actual Size).<br/>
              2. ${tile.alignNote}.<br/>
              3. Tape along red registration crosshairs (+) before tracing onto fabric.
            </div>
            <div class="calibration-box">
              <span>CALIBRATION</span>
              <strong>1.0" × 1.0"</strong>
              <span>(25.4mm × 25.4mm)</span>
            </div>
          </div>

          <div class="stencil-viewport">
            <svg viewBox="${tile.minX} ${tile.minY} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">
              <!-- Fabric Outer Edge (Grey) -->
              <rect x="0" y="0" width="${cushionPx}" height="${cushionPx}" fill="none" stroke="#9CA3AF" stroke-width="1.5" stroke-dasharray="8,6" />
              <!-- Seam Margin (0.75" inside) -->
              <rect x="72" y="72" width="${cushionPx - 144}" height="${cushionPx - 144}" fill="none" stroke="#E5E7EB" stroke-width="1" stroke-dasharray="4,4" />

              <!-- Center Alignment Axis Lines (Red Dashed) -->
              <line x1="${halfPx}" y1="0" x2="${halfPx}" y2="${cushionPx}" stroke="#EF4444" stroke-width="1.2" stroke-dasharray="6,4" />
              <line x1="0" y1="${halfPx}" x2="${cushionPx}" y2="${halfPx}" stroke="#EF4444" stroke-width="1.2" stroke-dasharray="6,4" />

              <!-- Center Crosshair Marker -->
              <path d="M ${halfPx - 24} ${halfPx} L ${halfPx + 24} ${halfPx} M ${halfPx} ${halfPx - 24} L ${halfPx} ${halfPx + 24}" stroke="#EF4444" stroke-width="2" />
              <circle cx="${halfPx}" cy="${halfPx}" r="12" fill="none" stroke="#EF4444" stroke-width="1.5" />

              <!-- Sub-Lab Partition Outlines -->
              ${partitionsSvg}

              <!-- 1:1 Stitches -->
              ${stitchesSvg}
            </svg>
          </div>

          <div class="stencil-footer">
            <span>Page ${idx + 1} of 4 • Tile [${tile.row}, ${tile.col}]</span>
            <span>Total Cushion Stitches: ${stitchCount.toLocaleString()}</span>
            <span>Sashiko Studio CAD • High-Precision Textile Stencil Generator</span>
          </div>
        </div>
      `;
    });

    sheetEl.innerHTML = pagesHtml;
    window.print();
  }
}

