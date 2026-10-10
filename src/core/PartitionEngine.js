/**
 * Sashiko Studio CAD - Partition & Polygon Slicing Engine
 * Implements Image 1 layout presets (2x2, 3x3, Diagonals, 8-Wedges, Medallions, Corners)
 * and robust parametric polygon clipping with winding-number validation.
 */

export class PartitionEngine {
  constructor(camera) {
    this.camera = camera;
    this.activePreset = 'full';
    this.partitions = []; // Array of { id, name, type, points: [{x, y}], color }

    this.createFullPreset();
  }

  createFullPreset() {
    const w = this.camera.artboardWidthPx || this.camera.cushionPx || 1587.4;
    const h = this.camera.artboardHeightPx || this.camera.cushionPx || 1587.4;
    this.partitions = [
      {
        id: 'p_full',
        name: 'Full Artboard',
        type: 'square',
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h }
        ]
      }
    ];
  }

  applyPreset(presetKey) {
    this.activePreset = presetKey;
    const w = this.camera.artboardWidthPx || this.camera.cushionPx || 1587.4;
    const h = this.camera.artboardHeightPx || this.camera.cushionPx || 1587.4;
    const midX = w / 2;
    const midY = h / 2;

    switch (presetKey) {
      case 'full':
        this.createFullPreset();
        break;

      // 2. 2x2 Grid (4 Quadrants: A1, A2, B1, B2)
      case 'grid-2x2':
        this.partitions = [
          { id: 'q1', name: 'Quadrant A1', type: 'square', points: [{ x: 0, y: 0 }, { x: midX, y: 0 }, { x: midX, y: midY }, { x: 0, y: midY }] },
          { id: 'q2', name: 'Quadrant A2', type: 'square', points: [{ x: midX, y: 0 }, { x: w, y: 0 }, { x: w, y: midY }, { x: midX, y: midY }] },
          { id: 'q3', name: 'Quadrant B1', type: 'square', points: [{ x: 0, y: midY }, { x: midX, y: midY }, { x: midX, y: h }, { x: 0, y: h }] },
          { id: 'q4', name: 'Quadrant B2', type: 'square', points: [{ x: midX, y: midY }, { x: w, y: midY }, { x: w, y: h }, { x: midX, y: h }] }
        ];
        break;

      // 3. 3x3 Grid (9 Master Blocks: A1..C3 - Image 3)
      case 'grid-3x3': {
        const dx = w / 3;
        const dy = h / 3;
        this.partitions = [];
        const blockDefs = [
          { id: 'A1', label: 'A1', name: 'A1 (Top-Left)', r: 0, c: 0 },
          { id: 'A2', label: 'A2', name: 'A2 (Top-Center)', r: 0, c: 1 },
          { id: 'A3', label: 'A3', name: 'A3 (Top-Right)', r: 0, c: 2 },
          { id: 'B1', label: 'B1', name: 'B1 (Mid-Left)', r: 1, c: 0 },
          { id: 'B2', label: 'B2', name: 'B2 (Center Medallion)', r: 1, c: 1 },
          { id: 'B3', label: 'B3', name: 'B3 (Mid-Right)', r: 1, c: 2 },
          { id: 'C1', label: 'C1', name: 'C1 (Bottom-Left)', r: 2, c: 0 },
          { id: 'C2', label: 'C2', name: 'C2 (Bottom-Center)', r: 2, c: 1 },
          { id: 'C3', label: 'C3', name: 'C3 (Bottom-Right)', r: 2, c: 2 }
        ];
        this.partitions = blockDefs.map(b => ({
          id: b.id,
          name: b.name,
          label: b.label,
          type: 'square',
          row: b.r,
          col: b.c,
          rotation: 0,
          points: [
            { x: b.c * dx, y: b.r * dy },
            { x: (b.c + 1) * dx, y: b.r * dy },
            { x: (b.c + 1) * dx, y: (b.r + 1) * dy },
            { x: b.c * dx, y: (b.r + 1) * dy }
          ]
        }));
        break;
      }

      // 4. 4-Way Diagonals (X-Split Triangles: A, B, C, D)
      case 'diag-4':
        this.partitions = [
          { id: 'tri_top', name: 'Triangle B (Top)', type: 'triangle', points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: midX, y: midY }] },
          { id: 'tri_right', name: 'Triangle C (Right)', type: 'triangle', points: [{ x: w, y: 0 }, { x: w, y: h }, { x: midX, y: midY }] },
          { id: 'tri_bottom', name: 'Triangle D (Bottom)', type: 'triangle', points: [{ x: w, y: h }, { x: 0, y: h }, { x: midX, y: midY }] },
          { id: 'tri_left', name: 'Triangle A (Left)', type: 'triangle', points: [{ x: 0, y: h }, { x: 0, y: 0 }, { x: midX, y: midY }] }
        ];
        break;

      // 5. 8-Way Wedges (Pinwheel / Star Triangles)
      case 'wedges-8': {
        const b = [
          { x: 0, y: 0 }, { x: midX, y: 0 }, { x: w, y: 0 },
          { x: w, y: midY }, { x: w, y: h }, { x: midX, y: h },
          { x: 0, y: h }, { x: 0, y: midY }
        ];
        this.partitions = [];
        const labels = ['A1', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'A2'];
        for (let i = 0; i < 8; i++) {
          this.partitions.push({
            id: `wedge_${i + 1}`,
            name: `Wedge ${labels[i]}`,
            type: 'triangle',
            points: [b[i], b[(i + 1) % 8], { x: midX, y: midY }]
          });
        }
        break;
      }

      // 6. Center Medallion + Outer Border (Image 1 Row 3)
      case 'medallion-border': {
        const m = w * 0.22;
        this.partitions = [
          {
            id: 'medallion_center',
            name: 'Center Medallion',
            type: 'square',
            points: [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }]
          },
          {
            id: 'border_top',
            name: 'Border Top',
            type: 'diamond',
            points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w - m, y: m }, { x: m, y: m }]
          },
          {
            id: 'border_right',
            name: 'Border Right',
            type: 'diamond',
            points: [{ x: w, y: 0 }, { x: w, y: h }, { x: w - m, y: h - m }, { x: w - m, y: m }]
          },
          {
            id: 'border_bottom',
            name: 'Border Bottom',
            type: 'diamond',
            points: [{ x: w, y: h }, { x: 0, y: h }, { x: m, y: h - m }, { x: w - m, y: h - m }]
          },
          {
            id: 'border_left',
            name: 'Border Left',
            type: 'diamond',
            points: [{ x: 0, y: h }, { x: 0, y: 0 }, { x: m, y: m }, { x: m, y: h - m }]
          }
        ];
        break;
      }

      // 7. Double Border Concentric Frames
      case 'double-border': {
        const m1 = w * 0.12;
        const m2 = w * 0.25;
        this.partitions = [
          {
            id: 'med_inner',
            name: 'Inner Medallion',
            type: 'square',
            points: [{ x: m2, y: m2 }, { x: w - m2, y: m2 }, { x: w - m2, y: h - m2 }, { x: m2, y: h - m2 }]
          },
          {
            id: 'frame_mid',
            name: 'Middle Frame',
            type: 'diamond',
            points: [{ x: m1, y: m1 }, { x: w - m1, y: m1 }, { x: w - m1, y: h - m1 }, { x: m1, y: h - m1 }]
          },
          {
            id: 'frame_outer',
            name: 'Outer Border',
            type: 'diamond',
            points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
          }
        ];
        break;
      }

      // 8. Medallion + 4 Corner Blocks (Image 1 Row 4 - Classic Quilt/Nakshi Layout)
      case 'medallion-corners': {
        const c = w * 0.22;
        this.partitions = [
          { id: 'c_nw', name: 'Corner NW', type: 'square', points: [{ x: 0, y: 0 }, { x: c, y: 0 }, { x: c, y: c }, { x: 0, y: c }] },
          { id: 'c_ne', name: 'Corner NE', type: 'square', points: [{ x: w - c, y: 0 }, { x: w, y: 0 }, { x: w, y: c }, { x: w - c, y: c }] },
          { id: 'c_se', name: 'Corner SE', type: 'square', points: [{ x: w - c, y: h - c }, { x: w, y: h - c }, { x: w, y: h }, { x: w - c, y: h }] },
          { id: 'c_sw', name: 'Corner SW', type: 'square', points: [{ x: 0, y: h - c }, { x: c, y: h - c }, { x: c, y: h }, { x: 0, y: h }] },
          { id: 'med_center', name: 'Center Medallion', type: 'square', points: [{ x: c, y: c }, { x: w - c, y: c }, { x: w - c, y: h - c }, { x: c, y: h - c }] }
        ];
        break;
      }
    }
  }

  // Winding Number algorithm for point-in-polygon test
  isPointInside(p, polygonPoints) {
    let wn = 0;
    const n = polygonPoints.length;
    for (let i = 0; i < n; i++) {
      const p1 = polygonPoints[i];
      const p2 = polygonPoints[(i + 1) % n];

      if (p1.y <= p.y) {
        if (p2.y > p.y && this.isLeft(p1, p2, p) > 0) wn++;
      } else {
        if (p2.y <= p.y && this.isLeft(p1, p2, p) < 0) wn--;
      }
    }
    return wn !== 0;
  }

  isLeft(p0, p1, p2) {
    return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  }

  // Segment clipping against arbitrary polygon
  clipSegmentToPolygon(p1, p2, polygonPoints) {
    const ts = [0, 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const n = polygonPoints.length;

    for (let i = 0; i < n; i++) {
      const v1 = polygonPoints[i];
      const v2 = polygonPoints[(i + 1) % n];
      const edx = v2.x - v1.x;
      const edy = v2.y - v1.y;

      const denom = dx * edy - dy * edx;
      if (Math.abs(denom) < 1e-9) continue;

      const qx = v1.x - p1.x;
      const qy = v1.y - p1.y;
      const t = (qx * edy - qy * edx) / denom;
      const u = (qx * dy - qy * dx) / denom;

      if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) {
        ts.push(t);
      }
    }

    ts.sort((a, b) => a - b);
    const valid = [];

    for (let i = 0; i < ts.length - 1; i++) {
      const tStart = ts[i];
      const tEnd = ts[i + 1];
      if (tEnd - tStart < 1e-4) continue;

      const mid = {
        x: p1.x + ((tStart + tEnd) / 2) * dx,
        y: p1.y + ((tStart + tEnd) / 2) * dy
      };

      if (this.isPointInside(mid, polygonPoints)) {
        valid.push({
          x1: p1.x + tStart * dx,
          y1: p1.y + tStart * dy,
          x2: p1.x + tEnd * dx,
          y2: p1.y + tEnd * dy
        });
      }
    }

    return valid;
  }
}
