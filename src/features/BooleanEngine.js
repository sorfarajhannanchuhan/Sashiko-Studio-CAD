/**
 * Sashiko Studio CAD - Figma Boolean Operations Engine (Image SS 2)
 * Features:
 * - Union (Alt+Shift+U): Merges selected shapes/stitches into a single compound geometry
 * - Subtract (Alt+Shift+S): True 2D polygon-line clipping (discards stitch segments inside cutter polygon B)
 * - Intersect (Alt+Shift+I): True 2D polygon-line clipping (preserves only stitch segments inside cutter polygon B)
 * - Exclude (Alt+Shift+E): True 2D symmetric difference (XOR) between shapes
 * - Flatten (Alt+Shift+F): Converts boolean results into standard individual editable stitches
 * - Group (Ctrl+G) & Ungroup (Ctrl+Shift+G)
 * - Copy (Ctrl+C) & Paste (Ctrl+V)
 */

import { edgeKey } from '../core/LatticeGrid.js';
import { computeConvexHull } from './SubLabManager.js';

export class BooleanEngine {
  constructor(stitchPen, partitionEngine, latticeGrid, camera, historyManager) {
    this.stitchPen = stitchPen;
    this.partitionEngine = partitionEngine;
    this.latticeGrid = latticeGrid;
    this.camera = camera;
    this.historyManager = historyManager;
    this.clipboard = null; // Internal clipboard for stitches & shapes
  }

  /**
   * Helper to get edge bounding box in node space
   */
  getBounds(keys) {
    let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
    for (const k of keys) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        minI = Math.min(minI, e.u[0], e.v[0]);
        maxI = Math.max(maxI, e.u[0], e.v[0]);
        minJ = Math.min(minJ, e.u[1], e.v[1]);
        maxJ = Math.max(maxJ, e.u[1], e.v[1]);
      }
    }
    return { minI, maxI, minJ, maxJ, midI: (minI + maxI) / 2, midJ: (minJ + maxJ) / 2 };
  }

  /**
   * Finds topological connected components among a set of stitch keys.
   */
  findConnectedComponents(keys) {
    const adj = new Map(); // nodeKey -> Array of stitchKey
    for (const k of keys) {
      const e = this.stitchPen.stitches.get(k);
      if (!e) continue;
      const k1 = `${e.u[0]},${e.u[1]}`;
      const k2 = `${e.v[0]},${e.v[1]}`;
      if (!adj.has(k1)) adj.set(k1, []);
      if (!adj.has(k2)) adj.set(k2, []);
      adj.get(k1).push(k);
      adj.get(k2).push(k);
    }

    const visitedStitches = new Set();
    const components = [];

    for (const k of keys) {
      if (visitedStitches.has(k)) continue;
      const comp = [];
      const queue = [k];
      visitedStitches.add(k);

      while (queue.length > 0) {
        const currKey = queue.shift();
        comp.push(currKey);
        const e = this.stitchPen.stitches.get(currKey);
        if (!e) continue;

        const nodes = [`${e.u[0]},${e.u[1]}`, `${e.v[0]},${e.v[1]}`];
        for (const nKey of nodes) {
          const neighbors = adj.get(nKey) || [];
          for (const nbr of neighbors) {
            if (!visitedStitches.has(nbr)) {
              visitedStitches.add(nbr);
              queue.push(nbr);
            }
          }
        }
      }

      components.push(comp);
    }

    return components;
  }

  /**
   * Attempts to extract a clean closed boundary loop of ordered points from stitch edges.
   * Returns array of points [{x, y}] if the stitches form a single simple cycle, otherwise null.
   */
  extractClosedPathFromStitches(keys) {
    if (!keys || keys.length < 3) return null;

    const adj = new Map(); // nodeKey -> Array of neighborKey
    const ptMap = new Map(); // nodeKey -> { x, y }

    for (const k of keys) {
      const e = this.stitchPen.stitches.get(k);
      if (!e) continue;

      const p1 = this.latticeGrid.nodeToWorld(e.u[0], e.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(e.v[0], e.v[1]);

      const k1 = `${e.u[0]},${e.u[1]}`;
      const k2 = `${e.v[0]},${e.v[1]}`;

      if (!ptMap.has(k1)) ptMap.set(k1, p1);
      if (!ptMap.has(k2)) ptMap.set(k2, p2);

      if (!adj.has(k1)) adj.set(k1, []);
      if (!adj.has(k2)) adj.set(k2, []);

      adj.get(k1).push(k2);
      adj.get(k2).push(k1);
    }

    if (adj.size < 3) return null;

    // Check if graph is 2-regular (every vertex has degree 2)
    for (const neighbors of adj.values()) {
      if (neighbors.length !== 2) {
        return null;
      }
    }

    // Trace single simple cycle
    const startKey = adj.keys().next().value;
    const cycle = [];
    let prev = null;
    let curr = startKey;

    for (let step = 0; step < adj.size; step++) {
      cycle.push(ptMap.get(curr));
      const neighbors = adj.get(curr);
      const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
      if (!next) return null;
      if (next === startKey) {
        if (cycle.length === adj.size && cycle.length >= 3) {
          return cycle;
        }
        return null;
      }
      prev = curr;
      curr = next;
    }

    return null;
  }

  /**
   * Constructs cutter polygon geometry from a group of stitch keys:
   * 1. Check if associated with an existing partition or custom lab polygon.
   * 2. If stitches form a closed boundary cycle, extract ordered path points.
   * 3. Otherwise, compute the 2D convex hull of all endpoints.
   */
  getPolygonFromGroup(keys) {
    if (!keys || keys.length === 0) return null;

    // 1. Check if stitches belong to a custom lab or partition that defines points
    for (const k of keys) {
      const e = this.stitchPen.stitches.get(k);
      if (e && e.partitionId && e.partitionId !== 'p_full') {
        const part = this.partitionEngine?.partitions?.find(p => p.id === e.partitionId);
        if (part && part.points && part.points.length >= 3) {
          return part.points.map(p => ({ x: p.x, y: p.y }));
        }
      }
    }

    // 2. Extract closed path if stitches form a boundary cycle
    const closedPath = this.extractClosedPathFromStitches(keys);
    if (closedPath && closedPath.length >= 3) {
      return closedPath;
    }

    // 3. Construct convex polygon hull from all stitch endpoints
    const allPoints = [];
    for (const k of keys) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        allPoints.push(this.latticeGrid.nodeToWorld(e.u[0], e.u[1]));
        allPoints.push(this.latticeGrid.nodeToWorld(e.v[0], e.v[1]));
      }
    }

    if (allPoints.length < 3) return null;

    const hull = computeConvexHull(allPoints);
    return (hull && hull.length >= 3) ? hull : null;
  }

  /**
   * Robust Point-in-Polygon test using Jordan curve theorem (ray casting).
   */
  isPointInPolygon(pt, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Clips a single line segment S = [p1, p2] against polygon boundary edges.
   * Finds all intersection points along S, sorts them from p1 to p2,
   * and classifies each sub-segment by testing its midpoint against the polygon.
   */
  clipSegmentAgainstPolygon(p1, p2, polygon) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);

    if (len < 1e-6) {
      return [];
    }

    const ts = [0, 1];
    const n = polygon.length;

    for (let i = 0; i < n; i++) {
      const v1 = polygon[i];
      const v2 = polygon[(i + 1) % n];
      const edx = v2.x - v1.x;
      const edy = v2.y - v1.y;

      const denom = dx * edy - dy * edx;
      if (Math.abs(denom) < 1e-9) continue;

      const qx = v1.x - p1.x;
      const qy = v1.y - p1.y;

      const t = (qx * edy - qy * edx) / denom;
      const u = (qx * dy - qy * dx) / denom;

      if (t > 1e-5 && t < 1 - 1e-5 && u >= -1e-5 && u <= 1 + 1e-5) {
        ts.push(t);
      }
    }

    ts.sort((a, b) => a - b);

    // Deduplicate ts
    const cleanTs = [];
    for (let i = 0; i < ts.length; i++) {
      if (i === 0 || ts[i] - cleanTs[cleanTs.length - 1] > 1e-4) {
        cleanTs.push(ts[i]);
      }
    }

    const subSegments = [];
    for (let i = 0; i < cleanTs.length - 1; i++) {
      const tStart = cleanTs[i];
      const tEnd = cleanTs[i + 1];
      if (tEnd - tStart < 1e-4) continue;

      const tMid = (tStart + tEnd) / 2;
      const ptMid = {
        x: p1.x + tMid * dx,
        y: p1.y + tMid * dy
      };

      const isInside = this.isPointInPolygon(ptMid, polygon);

      subSegments.push({
        tStart,
        tEnd,
        isInside,
        ptStart: { x: p1.x + tStart * dx, y: p1.y + tStart * dy },
        ptEnd: { x: p1.x + tEnd * dx, y: p1.y + tEnd * dy }
      });
    }

    return subSegments;
  }

  /**
   * Clips all stitch segments in a group against a polygon.
   * If keepInside is true, retains sub-segments inside the polygon.
   * If keepInside is false, retains sub-segments outside the polygon.
   * Snaps all new intersection cut points to the grid via this.latticeGrid.snapToNode().
   */
  clipGroupAgainstPolygon(groupKeys, polygon, keepInside) {
    const resultingStitches = [];

    for (const k of groupKeys) {
      const edge = this.stitchPen.stitches.get(k);
      if (!edge) continue;

      const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);

      const subSegments = this.clipSegmentAgainstPolygon(p1, p2, polygon);

      for (const seg of subSegments) {
        if (seg.isInside !== keepInside) continue;

        // Snap start endpoint to lattice grid
        let uNode;
        if (seg.tStart === 0) {
          uNode = [edge.u[0], edge.u[1]];
        } else {
          const snapStart = this.latticeGrid.snapToNode(seg.ptStart);
          uNode = [snapStart.i, snapStart.j];
        }

        // Snap end endpoint to lattice grid
        let vNode;
        if (seg.tEnd === 1) {
          vNode = [edge.v[0], edge.v[1]];
        } else {
          const snapEnd = this.latticeGrid.snapToNode(seg.ptEnd);
          vNode = [snapEnd.i, snapEnd.j];
        }

        // Discard collapsed zero-length edges
        if (uNode[0] === vNode[0] && uNode[1] === vNode[1]) {
          continue;
        }

        resultingStitches.push({
          u: uNode,
          v: vNode,
          partitionId: edge.partitionId,
          layerId: edge.layerId,
          groupId: edge.groupId,
          lineStyle: edge.lineStyle
        });
      }
    }

    return resultingStitches;
  }

  /**
   * Partitions selected stitches into two clusters (Group A and Group B)
   * based on groups, partitionId, topological components, or spatial bisect.
   */
  clusterSelected(keys) {
    const arr = Array.from(keys);
    if (arr.length <= 1) return { groupA: arr, groupB: [] };

    // 1. Cluster by groupId if present or specific custom partition
    const groupMap = new Map();
    for (const k of arr) {
      const e = this.stitchPen.stitches.get(k);
      const gid = e?.groupId || (e?.partitionId && e.partitionId !== 'p_full' ? e.partitionId : null) || 'default';
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid).push(k);
    }
    const groups = Array.from(groupMap.values());
    if (groups.length >= 2) {
      return { groupA: groups[0], groupB: groups.slice(1).flat() };
    }

    // 2. Cluster by topological connected components
    const components = this.findConnectedComponents(arr);
    if (components.length >= 2) {
      let cutterIdx = -1;
      for (let i = components.length - 1; i >= 0; i--) {
        if (this.extractClosedPathFromStitches(components[i])) {
          cutterIdx = i;
          break;
        }
      }
      if (cutterIdx !== -1) {
        const cutter = components[cutterIdx];
        const others = components.filter((_, idx) => idx !== cutterIdx).flat();
        return { groupA: others, groupB: cutter };
      }
      return { groupA: components[0], groupB: components.slice(1).flat() };
    }

    // 3. Fallback: Spatial bisect along dominant axis
    const bounds = this.getBounds(arr);
    const splitHoriz = (bounds.maxI - bounds.minI) >= (bounds.maxJ - bounds.minJ);
    const groupA = [];
    const groupB = [];

    for (const k of arr) {
      const e = this.stitchPen.stitches.get(k);
      const mid = splitHoriz ? (e.u[0] + e.v[0]) / 2 : (e.u[1] + e.v[1]) / 2;
      const pivot = splitHoriz ? bounds.midI : bounds.midJ;
      if (mid <= pivot) groupA.push(k);
      else groupB.push(k);
    }

    return { groupA: groupA.length > 0 ? groupA : arr, groupB: groupB.length > 0 ? groupB : [] };
  }

  /**
   * Union (Alt+Shift+U): Merges all selected stitches into a continuous single group
   */
  union() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size < 2) return false;

    const unionGroupId = `group_union_${Date.now()}`;
    for (const k of sel) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        e.groupId = unionGroupId;
      }
    }
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Subtract (Alt+Shift+S): True 2D geometric polygon-line clipping.
   * Cuts out cutter polygon B from group A.
   * Discards sub-segments of group A inside polygon B; retains sub-segments outside polygon B.
   * Deletes cutter group B.
   */
  subtract() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size < 2) return false;

    const { groupA, groupB } = this.clusterSelected(sel);
    if (groupB.length === 0) return false;

    const polygonB = this.getPolygonFromGroup(groupB);
    if (!polygonB || polygonB.length < 3) return false;

    // Discard sub-segments whose midpoints are inside polygon B, retain outside
    const newStitchesA = this.clipGroupAgainstPolygon(groupA, polygonB, false);

    // Delete all original groupA and groupB stitches
    for (const k of groupA) {
      this.stitchPen.stitches.delete(k);
    }
    for (const k of groupB) {
      this.stitchPen.stitches.delete(k);
    }

    const newSel = new Set();
    for (const edge of newStitchesA) {
      const k = edgeKey(edge.u[0], edge.u[1], edge.v[0], edge.v[1]);
      this.stitchPen.stitches.set(k, edge);
      newSel.add(k);
    }

    this.stitchPen.selectedStitches = newSel;
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Intersect (Alt+Shift+I): True 2D geometric polygon-line clipping.
   * Retains only sub-segments of group A whose midpoints fall INSIDE cutter polygon B.
   * Discards sub-segments outside polygon B, and deletes cutter group B.
   */
  intersect() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size < 2) return false;

    const { groupA, groupB } = this.clusterSelected(sel);
    if (groupB.length === 0) return false;

    const polygonB = this.getPolygonFromGroup(groupB);
    if (!polygonB || polygonB.length < 3) return false;

    // Retain sub-segments whose midpoints are inside polygon B, discard outside
    const newStitchesA = this.clipGroupAgainstPolygon(groupA, polygonB, true);

    // Delete all original groupA and groupB stitches
    for (const k of groupA) {
      this.stitchPen.stitches.delete(k);
    }
    for (const k of groupB) {
      this.stitchPen.stitches.delete(k);
    }

    const newSel = new Set();
    for (const edge of newStitchesA) {
      const k = edgeKey(edge.u[0], edge.u[1], edge.v[0], edge.v[1]);
      this.stitchPen.stitches.set(k, edge);
      newSel.add(k);
    }

    this.stitchPen.selectedStitches = newSel;
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Exclude (Alt+Shift+E): True 2D geometric symmetric difference (XOR).
   * Retains sub-segments that are in either group but not in both.
   */
  exclude() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size < 2) return false;

    const { groupA, groupB } = this.clusterSelected(sel);
    if (groupB.length === 0) return false;

    const polygonB = this.getPolygonFromGroup(groupB);
    const polygonA = this.getPolygonFromGroup(groupA);

    let newStitchesA = [];
    let newStitchesB = [];

    // Clip group A against polygon B: retain sub-segments OUTSIDE polygon B
    if (polygonB && polygonB.length >= 3) {
      newStitchesA = this.clipGroupAgainstPolygon(groupA, polygonB, false);
    } else {
      for (const k of groupA) {
        const e = this.stitchPen.stitches.get(k);
        if (e) newStitchesA.push(e);
      }
    }

    // Clip group B against polygon A: retain sub-segments OUTSIDE polygon A
    if (polygonA && polygonA.length >= 3) {
      newStitchesB = this.clipGroupAgainstPolygon(groupB, polygonA, false);
    } else {
      for (const k of groupB) {
        const e = this.stitchPen.stitches.get(k);
        if (e) newStitchesB.push(e);
      }
    }

    // Delete all original groupA and groupB stitches
    for (const k of groupA) {
      this.stitchPen.stitches.delete(k);
    }
    for (const k of groupB) {
      this.stitchPen.stitches.delete(k);
    }

    const newSel = new Set();
    for (const edge of [...newStitchesA, ...newStitchesB]) {
      const k = edgeKey(edge.u[0], edge.u[1], edge.v[0], edge.v[1]);
      this.stitchPen.stitches.set(k, edge);
      newSel.add(k);
    }

    this.stitchPen.selectedStitches = newSel;
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Flatten (Alt+Shift+F): Disassembles all compound groupings into individual editable stitches
   */
  flatten() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size === 0) return false;

    for (const k of sel) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        delete e.groupId;
      }
    }
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Group (Ctrl+G): Combines selected stitches into a cohesive group
   */
  group() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size === 0) return false;

    const gid = `group_${Date.now()}`;
    for (const k of sel) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        e.groupId = gid;
      }
    }
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Ungroup (Ctrl+Shift+G): Dissolves group membership
   */
  ungroup() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size === 0) return false;

    for (const k of sel) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        delete e.groupId;
      }
    }
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }

  /**
   * Copy to internal clipboard (Ctrl+C)
   */
  copy() {
    const sel = this.stitchPen.selectedStitches;
    if (sel.size === 0) return false;

    this.clipboard = [];
    const b = this.getBounds(sel);

    for (const k of sel) {
      const e = this.stitchPen.stitches.get(k);
      if (e) {
        this.clipboard.push({
          relU: [e.u[0] - b.minI, e.u[1] - b.minJ],
          relV: [e.v[0] - b.minI, e.v[1] - b.minJ],
          partitionId: e.partitionId,
          layerId: e.layerId,
          groupId: e.groupId,
          lineStyle: e.lineStyle
        });
      }
    }
    return true;
  }

  /**
   * Paste from clipboard (Ctrl+V) offset by grid pitch
   */
  paste() {
    if (!this.clipboard || this.clipboard.length === 0) return false;

    // Calculate paste anchor: Center on current viewport focus instead of fixed coordinates
    let baseI = 6;
    let baseJ = 6;

    if (this.camera && this.latticeGrid) {
      const centerWorld = {
        x: (this.camera.screenWidth / 2 - this.camera.panX) / this.camera.zoom,
        y: (this.camera.screenHeight / 2 - this.camera.panY) / this.camera.zoom
      };
      const snapped = this.latticeGrid.snapToNode(centerWorld);
      if (snapped) {
        baseI = snapped.i;
        baseJ = snapped.j;
      }
    }

    const newKeys = new Set();
    const newGid = `group_paste_${Date.now()}`;

    for (const item of this.clipboard) {
      const uNew = [baseI + item.relU[0], baseJ + item.relU[1]];
      const vNew = [baseI + item.relV[0], baseJ + item.relV[1]];
      const k = edgeKey(uNew[0], uNew[1], vNew[0], vNew[1]);

      this.stitchPen.stitches.set(k, {
        u: uNew,
        v: vNew,
        partitionId: item.partitionId || 'p_full',
        layerId: item.layerId || this.stitchPen.layerManager?.activeLayerId || 'layer_main',
        groupId: item.groupId ? newGid : undefined,
        lineStyle: item.lineStyle
      });
      newKeys.add(k);
    }

    this.stitchPen.selectedStitches = newKeys;
    this.stitchPen.notifyChange();
    this.stitchPen.notifySelection();
    this.camera.requestRender();
    return true;
  }
}
