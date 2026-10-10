/**
 * Sashiko Studio CAD - Figma Smart Alignment Guides Engine (Image SS 1)
 * Detects horizontal & vertical axis alignment between anchor points,
 * snaps magnetically, and renders crisp red alignment lines and ⊗ crosshairs.
 */

export class SmartGuides {
  constructor(camera, latticeGrid, stitchPen) {
    this.camera = camera;
    this.latticeGrid = latticeGrid;
    this.stitchPen = stitchPen;
    this.activeGuides = [];
    this.tolerancePx = 4.5; // Snap tolerance in screen pixels
    this.enabled = true;
  }

  clearGuides() {
    this.activeGuides = [];
  }

  /**
   * Computes alignment guides between the currently hovering/dragged point and all other canvas anchors
   */
  computeGuides(currentSnapPt) {
    this.activeGuides = [];
    if (!this.enabled || !currentSnapPt) return;

    const zoom = this.camera?.zoom || 1;
    const tol = this.tolerancePx / zoom;
    const currentWorld = this.latticeGrid.nodeToWorld(currentSnapPt.i, currentSnapPt.j);

    // Collect all unique anchor points on canvas from stitches
    const anchors = [];
    const seen = new Set();
    const addPt = (i, j) => {
      const k = `${Number(i).toFixed(2)},${Number(j).toFixed(2)}`;
      if (seen.has(k)) return;
      seen.add(k);
      const w = this.latticeGrid.nodeToWorld(i, j);
      anchors.push({ i, j, x: w.x, y: w.y });
    };

    if (this.stitchPen && this.stitchPen.stitches) {
      for (const [k, edge] of this.stitchPen.stitches.entries()) {
        // If moving a selection, do not align against the moving selection itself
        if (this.stitchPen.isDraggingSelection && this.stitchPen.selectedStitches.has(k)) {
          continue;
        }
        addPt(edge.u[0], edge.u[1]);
        addPt(edge.v[0], edge.v[1]);
      }
    }

    // Also include artboard center point for smart symmetry alignment
    if (this.camera) {
      const artW = this.camera.artboardWidthPx;
      const artH = this.camera.artboardHeightPx;
      if (artW && artH) {
        anchors.push({ x: artW / 2, y: artH / 2, i: -999, j: -999 });
      }
    }

    let alignedX = null;
    let alignedY = null;

    for (const pt of anchors) {
      // Ignore if it's the exact same point
      if (Math.hypot(pt.x - currentWorld.x, pt.y - currentWorld.y) < 1.0) continue;

      // Vertical Alignment Check (Identical X coordinates)
      if (Math.abs(pt.x - currentWorld.x) <= tol) {
        if (!alignedX || Math.abs(pt.x - currentWorld.x) < Math.abs(alignedX.x - currentWorld.x)) {
          alignedX = {
            type: 'vertical',
            x: pt.x,
            y1: Math.min(pt.y, currentWorld.y),
            y2: Math.max(pt.y, currentWorld.y),
            ptA: pt,
            ptB: { x: pt.x, y: currentWorld.y, i: currentSnapPt.i, j: currentSnapPt.j }
          };
        }
      }

      // Horizontal Alignment Check (Identical Y coordinates)
      if (Math.abs(pt.y - currentWorld.y) <= tol) {
        if (!alignedY || Math.abs(pt.y - currentWorld.y) < Math.abs(alignedY.y - currentWorld.y)) {
          alignedY = {
            type: 'horizontal',
            y: pt.y,
            x1: Math.min(pt.x, currentWorld.x),
            x2: Math.max(pt.x, currentWorld.x),
            ptA: pt,
            ptB: { x: currentWorld.x, y: pt.y, i: currentSnapPt.i, j: currentSnapPt.j }
          };
        }
      }
    }

    if (alignedX) this.activeGuides.push(alignedX);
    if (alignedY) this.activeGuides.push(alignedY);
  }

  /**
   * Renders the red alignment lines and ⊗ crosshairs (SS 1 standard)
   */
  render(ctx, state) {
    if (!this.enabled || !this.activeGuides || this.activeGuides.length === 0) return;
    const zoom = state?.zoom || this.camera?.zoom || 1;

    ctx.save();
    const redColor = '#EF4444'; // Figma Red Alignment Guide
    ctx.strokeStyle = redColor;
    ctx.lineWidth = Math.max(1.0, 1.25 / zoom);

    for (const guide of this.activeGuides) {
      ctx.beginPath();
      if (guide.type === 'vertical') {
        ctx.moveTo(guide.x, guide.y1);
        ctx.lineTo(guide.x, guide.y2);
      } else {
        ctx.moveTo(guide.x1, guide.y);
        ctx.lineTo(guide.x2, guide.y);
      }
      ctx.stroke();

      // Render ⊗ crosshair marker at both endpoints (SS 1)
      this.renderCrosshairMarker(ctx, guide.ptA.x, guide.ptA.y, zoom, redColor);
      this.renderCrosshairMarker(ctx, guide.ptB.x, guide.ptB.y, zoom, redColor);
    }

    ctx.restore();
  }

  renderCrosshairMarker(ctx, x, y, zoom, color) {
    const r = Math.max(3.2, 4.2 / zoom);
    ctx.save();
    // Circular background
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.0, 1.2 / zoom);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner cross (⊗)
    const arm = r * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x - arm, y + arm);
    ctx.lineTo(x + arm, y - arm);
    ctx.stroke();
    ctx.restore();
  }
}
