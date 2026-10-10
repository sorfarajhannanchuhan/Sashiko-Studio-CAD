/**
 * Sashiko Studio CAD - Precision Rotary Knife Slicer Tool
 * Slices intersecting stitches on the canvas without leaving permanent partition marks.
 */

import { edgeKey, formatCoord } from '../core/LatticeGrid.js';

export class CustomSlicer {
  constructor(canvasEl, camera, partitionEngine, subLabManager, historyManager, stitchPen = null, latticeGrid = null) {
    this.canvas = canvasEl;
    this.camera = camera;
    this.partitionEngine = partitionEngine;
    this.subLabManager = subLabManager;
    this.historyManager = historyManager;
    this.stitchPen = stitchPen;
    this.latticeGrid = latticeGrid;

    this.isSlicing = false;
    this.sliceStart = null;
    this.sliceEnd = null;
    this.enabled = false;

    this.onSliced = null;

    this.bindEvents();
  }

  setContext(stitchPen, latticeGrid) {
    this.stitchPen = stitchPen;
    this.latticeGrid = latticeGrid;
  }

  setEnabled(val) {
    this.enabled = val;
    this.cancelSlice();
  }

  cancelSlice() {
    this.isSlicing = false;
    this.sliceStart = null;
    this.sliceEnd = null;
    if (this.camera) this.camera.requestRender();
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      const worldPt = this.camera.screenToWorld(e.clientX, e.clientY);
      this.isSlicing = true;
      this.sliceStart = worldPt;
      this.sliceEnd = worldPt;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.isSlicing) return;
      let worldPt = this.camera.screenToWorld(e.clientX, e.clientY);

      // Snap to 0, 45, 90 degrees if Shift is pressed
      if (e.shiftKey && this.sliceStart) {
        worldPt = this.snapAngle(this.sliceStart, worldPt);
      }

      this.sliceEnd = worldPt;
      this.camera.requestRender();
    });

    window.addEventListener('pointerup', () => {
      if (!this.enabled || !this.isSlicing) return;
      if (this.sliceStart && this.sliceEnd) {
        const dist = Math.hypot(this.sliceEnd.x - this.sliceStart.x, this.sliceEnd.y - this.sliceStart.y);
        if (dist > 15) {
          this.executeSlice(this.sliceStart, this.sliceEnd);
        }
      }
      this.isSlicing = false;
      this.sliceStart = null;
      this.sliceEnd = null;
      this.camera.requestRender();
    });

    window.addEventListener('pointercancel', () => {
      if (this.isSlicing) {
        this.isSlicing = false;
        this.sliceStart = null;
        this.sliceEnd = null;
        this.camera.requestRender();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isSlicing) {
        this.isSlicing = false;
        this.sliceStart = null;
        this.sliceEnd = null;
        this.camera.requestRender();
      }
    });
  }

  snapAngle(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4; // 45 degrees
    const snappedAngle = Math.round(angle / step) * step;
    const len = Math.hypot(dx, dy);
    return {
      x: start.x + len * Math.cos(snappedAngle),
      y: start.y + len * Math.sin(snappedAngle)
    };
  }

  executeSlice(pA, pB) {
    try {
      if (!this.stitchPen || !this.latticeGrid) return;

      let slicedCount = 0;
      const stitchesToDelete = [];
      const stitchesToAdd = [];

      // 2.5mm physical visible cut severance gap
      const gapMm = 2.5;
      const ppi = this.camera?.ppi || 96;
      const halfGapPx = (gapMm / (2 * 25.4)) * ppi;

      const stepX = this.latticeGrid.getStepXPx();
      const stepY = this.latticeGrid.getStepYPx();

      for (const [k, edge] of this.stitchPen.stitches.entries()) {
        // Locked layer check
        if (this.stitchPen.layerManager && this.stitchPen.layerManager.isLayerLocked(edge.layerId)) {
          continue;
        }

        const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
        const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);

        const hit = this.segmentSegmentIntersection(p1, p2, pA, pB);
        if (hit) {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-4) continue;

          const dirX = dx / len;
          const dirY = dy / len;
          const dHit = hit.u * len;

          stitchesToDelete.push(k);

          // Sub-stitch 1 (towards p1)
          const dA = dHit - halfGapPx;
          if (dA >= 3) {
            const ptA = { x: p1.x + dA * dirX, y: p1.y + dA * dirY };
            const snapA = this.latticeGrid.snapToNode(ptA);
            const snapHit = this.latticeGrid.snapToNode(hit);

            let nodeA;
            // Snap to adjacent sub-node if distinct from hit cut, else use trimmed coordinate
            if (snapA.snapped && (snapA.i !== snapHit.i || snapA.j !== snapHit.j)) {
              nodeA = [snapA.i, snapA.j];
            } else {
              nodeA = [Number(formatCoord(ptA.x / stepX)), Number(formatCoord(ptA.y / stepY))];
            }

            if (nodeA[0] !== edge.u[0] || nodeA[1] !== edge.u[1]) {
              stitchesToAdd.push({
                u: [edge.u[0], edge.u[1]],
                v: nodeA,
                partitionId: edge.partitionId,
                layerId: edge.layerId,
                groupId: edge.groupId,
                lineStyle: edge.lineStyle
              });
            }
          }

          // Sub-stitch 2 (towards p2)
          const dB = dHit + halfGapPx;
          if (len - dB >= 3) {
            const ptB = { x: p1.x + dB * dirX, y: p1.y + dB * dirY };
            const snapB = this.latticeGrid.snapToNode(ptB);
            const snapHit = this.latticeGrid.snapToNode(hit);

            let nodeB;
            // Snap to adjacent sub-node if distinct from hit cut, else use trimmed coordinate
            if (snapB.snapped && (snapB.i !== snapHit.i || snapB.j !== snapHit.j)) {
              nodeB = [snapB.i, snapB.j];
            } else {
              nodeB = [Number(formatCoord(ptB.x / stepX)), Number(formatCoord(ptB.y / stepY))];
            }

            if (nodeB[0] !== edge.v[0] || nodeB[1] !== edge.v[1]) {
              stitchesToAdd.push({
                u: nodeB,
                v: [edge.v[0], edge.v[1]],
                partitionId: edge.partitionId,
                layerId: edge.layerId,
                groupId: edge.groupId,
                lineStyle: edge.lineStyle
              });
            }
          }

          slicedCount++;
        }
      }

      if (slicedCount > 0) {
        for (const k of stitchesToDelete) {
          this.stitchPen.stitches.delete(k);
        }
        for (const edge of stitchesToAdd) {
          const k = edgeKey(edge.u[0], edge.u[1], edge.v[0], edge.v[1]);
          this.stitchPen.stitches.set(k, edge);
        }
        this.stitchPen.notifyChange();
        if (typeof this.onSliced === 'function') {
          this.onSliced();
        }
      }
    } finally {
      // Completely reset slice line state so NO phantom line or cutting scar remains
      this.sliceStart = null;
      this.sliceEnd = null;
      this.isSlicing = false;
      if (this.camera) {
        this.camera.requestRender();
      }
    }
  }

  segmentSegmentIntersection(p1, p2, p3, p4) {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-6) return null;

    const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

    if (u >= 0.02 && u <= 0.98 && v >= 0 && v <= 1) {
      return {
        x: p1.x + u * (p2.x - p1.x),
        y: p1.y + u * (p2.y - p1.y),
        u,
        v
      };
    }
    return null;
  }

  render(ctx) {
    if (!this.enabled || !this.isSlicing || !this.sliceStart || !this.sliceEnd) return;

    ctx.save();
    ctx.strokeStyle = '#F87171'; // Clean surgical cutter red line during drag
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(this.sliceStart.x, this.sliceStart.y);
    ctx.lineTo(this.sliceEnd.x, this.sliceEnd.y);
    ctx.stroke();

    ctx.fillStyle = '#F87171';
    ctx.beginPath();
    ctx.arc(this.sliceStart.x, this.sliceStart.y, 3, 0, Math.PI * 2);
    ctx.arc(this.sliceEnd.x, this.sliceEnd.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
