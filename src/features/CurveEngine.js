/**
 * Sashiko Studio CAD - Master Curve & Arc Engine
 * Computational Geometry Engine for Japanese Sashiko Embroidery
 * 
 * Capabilities:
 * 1. 3-Point Circular Arc Algorithm:
 *    - Strict collinearity detection via 2D cross-product (|v1 x v2| < epsilon).
 *    - Circumscribed circle center (cx, cy) & radius R.
 *    - Start, mid, end angles (theta1, theta2, theta3) and directional sweep (CW vs CCW).
 *    - Parametric sampling along circular path: P(theta) = (cx + R*cos(theta), cy + R*sin(theta)).
 * 
 * 2. Smooth Curvature Spline Algorithm (Centripetal Catmull-Rom):
 *    - Interpolates C^1 continuous cubic curves through all points.
 *    - Industry-standard centripetal parameterization (alpha = 0.5) to prevent loops & cusps.
 *    - Supports seamless periodic closed loops (e.g. Sakura 5-petal motifs).
 *    - Supports cusp / corner anchors (double-clicked nodes) where tangent continuity is severed.
 *    - Direct conversion to cubic Bezier segments for hardware-accelerated Canvas 2D rendering.
 * 
 * 3. Curve-to-Sashiko Stitch Discretizer (Running Stitch Engine):
 *    - Numerical arc-length parameterization via fine cumulative arc-length sampling.
 *    - Sashiko running stitch intervals: nominal stitch length (default 3.0mm ~ 12px), gap length (default 1.5mm ~ 6px).
 *    - Adaptive balanced pitch scaling so embroidery begins and ends cleanly at needle penetrations.
 *    - Lattice grid magnetic snapping to nearest lattice/sub-lattice nodes within tolerance, or high-precision coordinates.
 *    - Converts segments into standard stitch map entries compatible with stitchPen.stitches and edgeKey(u, v).
 * 
 * 4. N-Fold Radial Symmetry Generator:
 *    - Order N in [1, 2, 3, 4, 5, 6, 8, 12] for traditional Japanese Kamon crests and floral mandalas.
 *    - Replicates any curve, arc, or stitch set N times rotated by k * (2*pi / N).
 *    - Defaults to artboard center or selection center.
 * 
 * 5. Interactive Canvas Drafting & Live Ghost Preview:
 *    - Live ghost preview on canvas during drafting (dashed cyan line, control points, arc center reticle).
 *    - Real-time running stitch preview and live kaleidoscopic radial symmetry ghosting.
 */

import { edgeKey, formatCoord } from '../core/LatticeGrid.js';

// Default Sashiko physical specifications (at standard 96 PPI)
export const DEFAULT_STITCH_LENGTH_MM = 3.0; // Standard Sashiko thread pass length (mm)
export const DEFAULT_GAP_LENGTH_MM = 1.5;    // Standard Sashiko underside gap length (mm)
export const MM_PER_INCH = 25.4;
export const DEFAULT_PPI = 96;

export const DEFAULT_STITCH_LENGTH_PX = (DEFAULT_STITCH_LENGTH_MM / MM_PER_INCH) * DEFAULT_PPI; // ~11.34 px
export const DEFAULT_GAP_LENGTH_PX = (DEFAULT_GAP_LENGTH_MM / MM_PER_INCH) * DEFAULT_PPI;       // ~5.67 px

export const SYMMETRY_ORDERS = [1, 2, 3, 4, 5, 6, 8, 12];

// =============================================================================
// SECTION 1: Pure Geometric & Vector Math Helpers
// =============================================================================

/**
 * Computes Euclidean distance between two 2D points.
 */
export function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * 2D vector cross product: (v1.x * v2.y - v1.y * v2.x).
 * Magnitude equals twice the area of triangle formed by vectors.
 */
export function crossProduct2D(v1, v2) {
  return v1.x * v2.y - v1.y * v2.x;
}

/**
 * Rotates a 2D point around an origin center by angle in radians.
 */
export function rotatePoint(pt, center, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

/**
 * Normalizes an angle into [0, 2*PI).
 */
export function normalizeAngle2PI(angle) {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

/**
 * Converts millimeters to canvas pixels at given PPI.
 */
export function mmToPixels(mm, ppi = DEFAULT_PPI) {
  return (mm / MM_PER_INCH) * ppi;
}

/**
 * Converts canvas pixels to millimeters at given PPI.
 */
export function pixelsToMm(px, ppi = DEFAULT_PPI) {
  return (px / ppi) * MM_PER_INCH;
}

// =============================================================================
// SECTION 2: 3-Point Circular Arc Algorithm
// =============================================================================

/**
 * Computes a circular arc uniquely defined by three points:
 * P1 (start point), P2 (through / apex point), P3 (end point).
 * 
 * If points are collinear (|P1P2 x P2P3| < epsilon), falls back to straight line P1 -> P3.
 * 
 * @param {{x: number, y: number}} p1 Start point
 * @param {{x: number, y: number}} p2 Through / peak point
 * @param {{x: number, y: number}} p3 End point
 * @param {number} [epsilon=1e-7] Numerical collinearity threshold
 * @returns {Object} Arc definition object with circumcenter, radius, angles, and sampling methods
 */
export function compute3PointArc(p1, p2, p3, epsilon = 1e-7) {
  const d12 = distance(p1, p2);
  const d23 = distance(p2, p3);
  const d13 = distance(p1, p3);

  // Vector 1: P1 -> P2, Vector 2: P2 -> P3
  const v12 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const v23 = { x: p3.x - p2.x, y: p3.y - p2.y };

  // Determinant D = 2 * (v12 x v23)
  const cross = crossProduct2D(v12, v23);
  const det = 2 * cross;

  // Collinearity or coincident point check
  if (Math.abs(det) < epsilon || d12 < epsilon || d23 < epsilon || d13 < epsilon) {
    const len = d13;
    return {
      isCollinear: true,
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p3.x, y: p3.y },
      center: { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2 },
      radius: Infinity,
      startAngle: 0,
      midAngle: 0,
      endAngle: 0,
      sweepAngle: 0,
      isClockwise: false,
      length: len,
      pointAt(t) {
        const clampedT = Math.max(0, Math.min(1, t));
        return {
          x: p1.x + clampedT * (p3.x - p1.x),
          y: p1.y + clampedT * (p3.y - p1.y)
        };
      },
      tangentAt(_t) {
        if (len < 1e-9) return { x: 1, y: 0 };
        return { x: (p3.x - p1.x) / len, y: (p3.y - p1.y) / len };
      },
      samplePoints(numSamples = 32) {
        const pts = [];
        const n = Math.max(2, numSamples);
        for (let i = 0; i < n; i++) {
          pts.push(this.pointAt(i / (n - 1)));
        }
        return pts;
      }
    };
  }

  // Linear system for perpendicular bisectors intersection:
  // dx1 * cx + dy1 * cy = B1
  // dx2 * cx + dy2 * cy = B2
  const b1 = ((p2.x * p2.x + p2.y * p2.y) - (p1.x * p1.x + p1.y * p1.y)) / 2;
  const b2 = ((p3.x * p3.x + p3.y * p3.y) - (p2.x * p2.x + p2.y * p2.y)) / 2;

  const cx = (b1 * v23.y - b2 * v12.y) / cross;
  const cy = (v12.x * b2 - v23.x * b1) / cross;

  const radius = Math.hypot(p1.x - cx, p1.y - cy);

  // Angular coordinates
  const theta1 = Math.atan2(p1.y - cy, p1.x - cx);
  const theta2 = Math.atan2(p2.y - cy, p2.x - cx);
  const theta3 = Math.atan2(p3.y - cy, p3.x - cx);

  // Counter-clockwise angular distance from theta1
  const delta12 = normalizeAngle2PI(theta2 - theta1);
  const delta13 = normalizeAngle2PI(theta3 - theta1);

  // Determine sweep direction (passing through P2)
  let isClockwise = false;
  let sweepAngle = 0;

  if (delta12 > 0 && delta12 < delta13) {
    // CCW path from theta1 to theta3 passes through theta2
    isClockwise = false;
    sweepAngle = delta13;
  } else {
    // CW path from theta1 to theta3 passes through theta2
    isClockwise = true;
    sweepAngle = -(Math.PI * 2 - delta13);
  }

  const arcLength = radius * Math.abs(sweepAngle);

  return {
    isCollinear: false,
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    p3: { x: p3.x, y: p3.y },
    center: { x: cx, y: cy },
    radius,
    startAngle: theta1,
    midAngle: theta2,
    endAngle: theta3,
    sweepAngle,
    isClockwise,
    length: arcLength,

    /**
     * Samples a point parametrically along the circular path:
     * P(theta(t)) = (cx + R*cos(theta), cy + R*sin(theta)) for t in [0, 1].
     */
    pointAt(t) {
      const clampedT = Math.max(0, Math.min(1, t));
      const theta = theta1 + clampedT * sweepAngle;
      return {
        x: cx + radius * Math.cos(theta),
        y: cy + radius * Math.sin(theta)
      };
    },

    /**
     * Returns normalized tangent vector at parameter t in [0, 1].
     */
    tangentAt(t) {
      const clampedT = Math.max(0, Math.min(1, t));
      const theta = theta1 + clampedT * sweepAngle;
      const dir = sweepAngle >= 0 ? 1 : -1;
      return {
        x: -Math.sin(theta) * dir,
        y: Math.cos(theta) * dir
      };
    },

    /**
     * Samples points evenly spaced along the arc.
     */
    samplePoints(numSamples = 32) {
      const pts = [];
      const n = Math.max(2, numSamples);
      for (let i = 0; i < n; i++) {
        pts.push(this.pointAt(i / (n - 1)));
      }
      return pts;
    }
  };
}

/**
 * Samples a 3-point arc parametrically.
 */
export function sample3PointArc(arcDef, numSamples = 32) {
  if (!arcDef || typeof arcDef.samplePoints !== 'function') {
    return [];
  }
  return arcDef.samplePoints(numSamples);
}

// =============================================================================
// SECTION 3: Smooth Curvature Spline Algorithm (Centripetal Catmull-Rom)
// =============================================================================

/**
 * Centripetal Catmull-Rom Spline interpolator.
 * 
 * Guarantees C^1 continuous cubic curves through all points, without self-intersections
 * or overshoot loops (alpha = 0.5). Supports closed loops (Sakura flower petals)
 * and sharp cusp/corner anchors (double-clicked nodes) where tangent continuity is severed.
 */
export class CentripetalSpline {
  /**
   * @param {Array<{x: number, y: number, isCusp?: boolean, isCorner?: boolean}>} points Control points
   * @param {Object} [options] Spline options
   * @param {boolean} [options.closed=false] Whether the spline forms a closed loop
   * @param {number} [options.alpha=0.5] Knot parameterization: 0.5 = centripetal, 0.0 = uniform, 1.0 = chordal
   */
  constructor(points = [], options = {}) {
    this.rawPoints = (points || []).map(p => ({
      x: Number(p.x),
      y: Number(p.y),
      isCusp: Boolean(p.isCusp || p.isCorner)
    }));
    this.closed = Boolean(options.closed);
    this.alpha = typeof options.alpha === 'number' ? options.alpha : 0.5;

    this.bezierSegments = [];
    this.arcLengthTable = null;
    this.totalLength = 0;

    this.computeSpline();
  }

  /**
   * Rebuilds the spline cubic Bezier segments and arc-length parameterization.
   */
  computeSpline() {
    this.bezierSegments = [];
    const pts = this.rawPoints;
    const n = pts.length;

    if (n < 2) {
      this.totalLength = 0;
      this.arcLengthTable = null;
      return;
    }

    if (n === 2) {
      // Degenerate 2-point spline -> single straight Bezier segment
      const p0 = pts[0];
      const p1 = pts[1];
      const c1 = { x: p0.x + (p1.x - p0.x) / 3, y: p0.y + (p1.y - p0.y) / 3 };
      const c2 = { x: p1.x - (p1.x - p0.x) / 3, y: p1.y - (p1.y - p0.y) / 3 };
      this.bezierSegments.push({ p0, c1, c2, p1 });
      this.buildArcLengthTable();
      return;
    }

    // Partition points by cusps / corner anchors
    if (!this.closed) {
      this.computeOpenSplineWithCusps();
    } else {
      this.computeClosedSplineWithCusps();
    }

    this.buildArcLengthTable();
  }

  /**
   * Computes open spline handling interior cusps by partitioning into sub-chains.
   */
  computeOpenSplineWithCusps() {
    const pts = this.rawPoints;
    const n = pts.length;

    // Partition into sub-chains split at cusps
    const subChains = [];
    let currentChain = [pts[0]];

    for (let i = 1; i < n; i++) {
      const p = pts[i];
      currentChain.push(p);
      if (p.isCusp && i < n - 1) {
        subChains.push(currentChain);
        currentChain = [p];
      }
    }
    subChains.push(currentChain);

    // Build segments for each sub-chain
    for (const chain of subChains) {
      if (chain.length < 2) continue;
      if (chain.length === 2) {
        const pA = chain[0];
        const pB = chain[1];
        const c1 = { x: pA.x + (pB.x - pA.x) / 3, y: pA.y + (pB.y - pA.y) / 3 };
        const c2 = { x: pB.x - (pB.x - pA.x) / 3, y: pB.y - (pB.y - pA.y) / 3 };
        this.bezierSegments.push({ p0: pA, c1, c2, p1: pB });
        continue;
      }

      const m = chain.length;
      for (let i = 0; i < m - 1; i++) {
        const p0 = i === 0 ? { x: 2 * chain[0].x - chain[1].x, y: 2 * chain[0].y - chain[1].y } : chain[i - 1];
        const p1 = chain[i];
        const p2 = chain[i + 1];
        const p3 = i + 2 < m ? chain[i + 2] : { x: 2 * chain[m - 1].x - chain[m - 2].x, y: 2 * chain[m - 1].y - chain[m - 2].y };

        const seg = this.catmullToBezierSegment(p0, p1, p2, p3);
        this.bezierSegments.push(seg);
      }
    }
  }

  /**
   * Computes closed spline handling cusps or fully periodic smooth loop.
   */
  computeClosedSplineWithCusps() {
    const pts = this.rawPoints;
    const n = pts.length;

    const cuspIndices = [];
    for (let i = 0; i < n; i++) {
      if (pts[i].isCusp) cuspIndices.push(i);
    }

    if (cuspIndices.length === 0) {
      // Fully smooth periodic closed loop (e.g. continuous organic petals / circles)
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];

        const seg = this.catmullToBezierSegment(p0, p1, p2, p3);
        this.bezierSegments.push(seg);
      }
      return;
    }

    // Closed loop with 1 or more cusps:
    // Sub-chains between consecutive cusps around the loop
    const kCount = cuspIndices.length;
    for (let k = 0; k < kCount; k++) {
      const idxA = cuspIndices[k];
      const idxB = cuspIndices[(k + 1) % kCount];

      const chain = [];
      let curr = idxA;
      while (true) {
        chain.push(pts[curr]);
        if (curr === idxB) break;
        curr = (curr + 1) % n;
      }

      if (chain.length === 2) {
        const pA = chain[0];
        const pB = chain[1];
        const c1 = { x: pA.x + (pB.x - pA.x) / 3, y: pA.y + (pB.y - pA.y) / 3 };
        const c2 = { x: pB.x - (pB.x - pA.x) / 3, y: pB.y - (pB.y - pA.y) / 3 };
        this.bezierSegments.push({ p0: pA, c1, c2, p1: pB });
      } else {
        const m = chain.length;
        for (let i = 0; i < m - 1; i++) {
          const p0 = i === 0 ? { x: 2 * chain[0].x - chain[1].x, y: 2 * chain[0].y - chain[1].y } : chain[i - 1];
          const p1 = chain[i];
          const p2 = chain[i + 1];
          const p3 = i + 2 < m ? chain[i + 2] : { x: 2 * chain[m - 1].x - chain[m - 2].x, y: 2 * chain[m - 1].y - chain[m - 2].y };

          const seg = this.catmullToBezierSegment(p0, p1, p2, p3);
          this.bezierSegments.push(seg);
        }
      }
    }
  }

  /**
   * Converts 4 control points P0, P1, P2, P3 into cubic Bezier control points for segment P1 -> P2.
   * Utilizes centripetal knot sequence t0, t1, t2, t3.
   */
  catmullToBezierSegment(p0, p1, p2, p3) {
    const alpha = this.alpha;

    const d01 = Math.max(1e-6, Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const d12 = Math.max(1e-6, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    const d23 = Math.max(1e-6, Math.hypot(p3.x - p2.x, p3.y - p2.y));

    const dt0 = Math.pow(d01, alpha);
    const dt1 = Math.pow(d12, alpha);
    const dt2 = Math.pow(d23, alpha);

    // Tangent T1 at P1
    const t1x = (p1.x - p0.x) / dt0 - (p2.x - p0.x) / (dt0 + dt1) + (p2.x - p1.x) / dt1;
    const t1y = (p1.y - p0.y) / dt0 - (p2.y - p0.y) / (dt0 + dt1) + (p2.y - p1.y) / dt1;

    // Tangent T2 at P2
    const t2x = (p2.x - p1.x) / dt1 - (p3.x - p1.x) / (dt1 + dt2) + (p3.x - p2.x) / dt2;
    const t2y = (p2.y - p1.y) / dt1 - (p3.y - p1.y) / (dt1 + dt2) + (p3.y - p2.y) / dt2;

    // Cubic Bezier control points C1, C2
    const c1 = {
      x: p1.x + (dt1 / 3) * t1x,
      y: p1.y + (dt1 / 3) * t1y
    };
    const c2 = {
      x: p2.x - (dt1 / 3) * t2x,
      y: p2.y - (dt1 / 3) * t2y
    };

    return { p0: p1, c1, c2, p1: p2 };
  }

  /**
   * Precomputes fine arc length table across all Bezier segments for O(log M) sampling.
   */
  buildArcLengthTable() {
    const segments = this.bezierSegments;
    if (segments.length === 0) {
      this.arcLengthTable = null;
      this.totalLength = 0;
      return;
    }

    const samplesPerSeg = 32;
    const points = [];
    const cumulative = [0];
    let runningDist = 0;

    let prevPt = this.evaluateBezierSegment(segments[0], 0);
    points.push(prevPt);

    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      const seg = segments[sIdx];
      for (let i = 1; i <= samplesPerSeg; i++) {
        const u = i / samplesPerSeg;
        const pt = this.evaluateBezierSegment(seg, u);
        const d = distance(prevPt, pt);
        runningDist += d;
        cumulative.push(runningDist);
        points.push(pt);
        prevPt = pt;
      }
    }

    this.totalLength = runningDist;
    this.arcLengthTable = { points, cumulative, totalLength: runningDist };
  }

  /**
   * Evaluates cubic Bezier segment at parameter u in [0, 1].
   */
  evaluateBezierSegment(seg, u) {
    const uClamped = Math.max(0, Math.min(1, u));
    const invU = 1 - uClamped;
    const invU2 = invU * invU;
    const invU3 = invU2 * invU;
    const u2 = uClamped * uClamped;
    const u3 = u2 * uClamped;

    const b0 = invU3;
    const b1 = 3 * invU2 * uClamped;
    const b2 = 3 * invU * u2;
    const b3 = u3;

    return {
      x: b0 * seg.p0.x + b1 * seg.c1.x + b2 * seg.c2.x + b3 * seg.p1.x,
      y: b0 * seg.p0.y + b1 * seg.c1.y + b2 * seg.c2.y + b3 * seg.p1.y
    };
  }

  /**
   * Evaluates point at cumulative arc distance s in [0, totalLength].
   */
  getPointAtDistance(dist) {
    if (!this.arcLengthTable || this.arcLengthTable.points.length === 0) {
      return { x: 0, y: 0 };
    }

    const { points, cumulative, totalLength } = this.arcLengthTable;
    if (totalLength < 1e-9) return points[0];

    const targetDist = Math.max(0, Math.min(totalLength, dist));

    // Binary search for cumulative interval
    let low = 0;
    let high = cumulative.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (cumulative[mid] <= targetDist) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx = Math.max(1, Math.min(cumulative.length - 1, low));
    const s0 = cumulative[idx - 1];
    const s1 = cumulative[idx];
    const span = s1 - s0;

    const t = span > 1e-7 ? (targetDist - s0) / span : 0;
    const pA = points[idx - 1];
    const pB = points[idx];

    return {
      x: pA.x + t * (pB.x - pA.x),
      y: pA.y + t * (pB.y - pA.y)
    };
  }

  /**
   * Samples points evenly along the spline.
   */
  samplePoints(numSamples = 64) {
    if (!this.arcLengthTable || this.totalLength < 1e-9) {
      return this.rawPoints.map(p => ({ x: p.x, y: p.y }));
    }
    const pts = [];
    const n = Math.max(2, numSamples);
    for (let i = 0; i < n; i++) {
      const dist = (i / (n - 1)) * this.totalLength;
      pts.push(this.getPointAtDistance(dist));
    }
    return pts;
  }
}

/**
 * Functional helper to compute a centripetal spline.
 */
export function computeCentripetalSpline(points, options = {}) {
  return new CentripetalSpline(points, options);
}

// =============================================================================
// SECTION 4: Curve-to-Sashiko Running Stitch Discretizer
// =============================================================================

/**
 * Discretizes any curve (3-point arc or spline) into discrete Sashiko running stitches:
 * - Thread segments [A_k, B_k] (length ~ L_stitch)
 * - Underside gaps between B_k and A_{k+1} (length ~ L_gap)
 * - Adaptive pitch balancing so embroidery starts and ends cleanly at needle penetrations.
 * - Optional lattice grid snapping to nearest lattice/sub-lattice nodes within tolerance.
 * - Converts segments into standard stitch map entries compatible with stitchPen.stitches and edgeKey.
 * 
 * @param {Object|CentripetalSpline} curve Curve or spline instance (must have getPointAtDistance and totalLength)
 * @param {Object} [options]
 * @param {number} [options.stitchLengthMm=3.0] Target stitch length in mm
 * @param {number} [options.gapLengthMm=1.5] Target gap length in mm
 * @param {number} [options.stitchLengthPx] Optional override stitch length in pixels
 * @param {number} [options.gapLengthPx] Optional override gap length in pixels
 * @param {boolean} [options.balanced=true] Proportionally scale pitch so curve starts/ends cleanly on needle penetrations
 * @param {boolean} [options.isClosed=false] Whether path is closed
 * @param {boolean} [options.snapToGrid=true] Snap stitch needle drops to nearest lattice grid nodes
 * @param {Object} [options.latticeGrid=null] LatticeGrid instance for node conversions and snapping
 * @param {number} [options.ppi=96] Pixels per inch for metric conversions
 * @param {string} [options.partitionId='p_full'] Partition ID for stitch attribution
 * @param {string} [options.layerId='layer_main'] Layer ID for stitch attribution
 * @returns {{ segments: Array, stitchMap: Map, totalStitches: number, threadLengthMm: number }}
 */
export function discretizeCurveToStitches(curve, options = {}) {
  const ppi = typeof options.ppi === 'number' ? options.ppi : DEFAULT_PPI;

  const stitchLenPx = typeof options.stitchLengthPx === 'number'
    ? options.stitchLengthPx
    : mmToPixels(typeof options.stitchLengthMm === 'number' ? options.stitchLengthMm : DEFAULT_STITCH_LENGTH_MM, ppi);

  const gapLenPx = typeof options.gapLengthPx === 'number'
    ? options.gapLengthPx
    : mmToPixels(typeof options.gapLengthMm === 'number' ? options.gapLengthMm : DEFAULT_GAP_LENGTH_MM, ppi);

  const balanced = options.balanced !== false;
  const isClosed = Boolean(options.isClosed || curve.closed);
  const snapToGrid = Boolean(options.snapToGrid && options.latticeGrid);
  const latticeGrid = options.latticeGrid || null;
  const partitionId = options.partitionId || 'p_full';
  const layerId = options.layerId || 'layer_main';

  // Extract cumulative distance sampler
  let totalLength = 0;
  let pointAtDistFn = null;

  if (typeof curve.getPointAtDistance === 'function') {
    totalLength = curve.totalLength || (curve.arcLengthTable ? curve.arcLengthTable.totalLength : 0);
    pointAtDistFn = (s) => curve.getPointAtDistance(s);
  } else if (typeof curve.pointAt === 'function' && typeof curve.length === 'number') {
    totalLength = curve.length;
    pointAtDistFn = (s) => {
      const t = totalLength > 1e-9 ? Math.max(0, Math.min(1, s / totalLength)) : 0;
      return curve.pointAt(t);
    };
  } else {
    console.warn('discretizeCurveToStitches: unsupported curve format.');
    return { segments: [], stitchMap: new Map(), totalStitches: 0, threadLengthMm: 0 };
  }

  if (totalLength < 1e-3) {
    return { segments: [], stitchMap: new Map(), totalStitches: 0, threadLengthMm: 0 };
  }

  // Calculate stitch intervals [s_start, s_end] along cumulative arc length
  const stitchIntervals = [];

  if (totalLength <= stitchLenPx) {
    // Shorter than 1 stitch -> single full segment
    stitchIntervals.push([0, totalLength]);
  } else if (!balanced) {
    // Nominal fixed pitch mode
    let s = 0;
    while (s < totalLength) {
      const sEnd = Math.min(totalLength, s + stitchLenPx);
      stitchIntervals.push([s, sEnd]);
      s = sEnd + gapLenPx;
    }
  } else {
    // Balanced adaptive pitch mode
    if (isClosed) {
      const cycle = stitchLenPx + gapLenPx;
      const kCount = Math.max(3, Math.round(totalLength / cycle));
      const scale = totalLength / (kCount * cycle);
      const effStitch = stitchLenPx * scale;
      const effGap = gapLenPx * scale;

      for (let k = 0; k < kCount; k++) {
        const sStart = k * (effStitch + effGap);
        const sEnd = sStart + effStitch;
        stitchIntervals.push([sStart, sEnd]);
      }
    } else {
      const cycle = stitchLenPx + gapLenPx;
      const kCount = Math.max(1, Math.round((totalLength + gapLenPx) / cycle));
      const nominalTotal = kCount * stitchLenPx + (kCount - 1) * gapLenPx;
      const scale = nominalTotal > 1e-7 ? totalLength / nominalTotal : 1.0;
      const effStitch = stitchLenPx * scale;
      const effGap = gapLenPx * scale;

      for (let k = 0; k < kCount; k++) {
        const sStart = k * (effStitch + effGap);
        const sEnd = k === kCount - 1 ? totalLength : (sStart + effStitch);
        stitchIntervals.push([sStart, sEnd]);
      }
    }
  }

  // Sample points and generate stitch map
  const stepX = latticeGrid ? latticeGrid.getStepXPx() : 1;
  const stepY = latticeGrid ? latticeGrid.getStepYPx() : 1;

  const segments = [];
  const stitchMap = new Map();
  let totalThreadPx = 0;

  for (const [sStart, sEnd] of stitchIntervals) {
    const rawA = pointAtDistFn(sStart);
    const rawB = pointAtDistFn(sEnd);

    let nodeA = null;
    let nodeB = null;

    if (snapToGrid && latticeGrid) {
      const snapA = latticeGrid.snapToNode(rawA);
      const snapB = latticeGrid.snapToNode(rawB);

      nodeA = snapA.snapped
        ? { i: snapA.i, j: snapA.j, x: snapA.x, y: snapA.y }
        : { i: Number(formatCoord(rawA.x / stepX)), j: Number(formatCoord(rawA.y / stepY)), x: rawA.x, y: rawA.y };

      nodeB = snapB.snapped
        ? { i: snapB.i, j: snapB.j, x: snapB.x, y: snapB.y }
        : { i: Number(formatCoord(rawB.x / stepX)), j: Number(formatCoord(rawB.y / stepY)), x: rawB.x, y: rawB.y };
    } else {
      // High-precision coordinates converted to lattice index representation
      nodeA = {
        i: Number(formatCoord(rawA.x / stepX)),
        j: Number(formatCoord(rawA.y / stepY)),
        x: rawA.x,
        y: rawA.y
      };
      nodeB = {
        i: Number(formatCoord(rawB.x / stepX)),
        j: Number(formatCoord(rawB.y / stepY)),
        x: rawB.x,
        y: rawB.y
      };
    }

    // Skip degenerate zero-length stitches
    if (nodeA.i === nodeB.i && nodeA.j === nodeB.j) {
      continue;
    }

    const key = edgeKey(nodeA.i, nodeA.j, nodeB.i, nodeB.j);
    const segLen = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
    totalThreadPx += segLen;

    const edgeObj = {
      u: [nodeA.i, nodeA.j],
      v: [nodeB.i, nodeB.j],
      partitionId,
      layerId
    };

    stitchMap.set(key, edgeObj);
    segments.push({
      key,
      a: nodeA,
      b: nodeB,
      lengthPx: segLen,
      lengthMm: pixelsToMm(segLen, ppi)
    });
  }

  return {
    segments,
    stitchMap,
    totalStitches: segments.length,
    threadLengthMm: pixelsToMm(totalThreadPx, ppi)
  };
}

// =============================================================================
// SECTION 5: N-Fold Radial Symmetry Generator
// =============================================================================

/**
 * Replicates any curve, arc, point sequence, or stitch set N times rotated by k * (2*PI / N).
 * Order N in [1, 2, 3, 4, 5, 6, 8, 12].
 * 
 * @param {Object|Array|Map} source Input geometry (Arc definition, Spline, Point array, or Stitch Map)
 * @param {number} [order=1] Order of radial symmetry N
 * @param {{x: number, y: number}} [center=null] Center of rotation (defaults to artboard or selection centroid)
 * @param {Object} [options] Conversion options
 * @returns {Array|Map} Replicated geometry collection or merged stitch map
 */
export function generateRadialSymmetry(source, order = 1, center = null, options = {}) {
  const N = Math.max(1, Math.round(order));
  const rotCenter = center || { x: 0, y: 0 };

  if (N === 1) {
    if (source instanceof Map) return new Map(source);
    if (Array.isArray(source)) return [...source];
    return [source];
  }

  const angleStep = (Math.PI * 2) / N;

  // Case A: Stitch Map (Map<string, { u: [i, j], v: [i, j], ... }>)
  if (source instanceof Map) {
    const latticeGrid = options.latticeGrid;
    const stepX = latticeGrid ? latticeGrid.getStepXPx() : 1;
    const stepY = latticeGrid ? latticeGrid.getStepYPx() : 1;
    const mergedMap = new Map();

    for (let k = 0; k < N; k++) {
      const phi = k * angleStep;
      for (const edge of source.values()) {
        const ptA = { x: edge.u[0] * stepX, y: edge.u[1] * stepY };
        const ptB = { x: edge.v[0] * stepX, y: edge.v[1] * stepY };

        const rotA = rotatePoint(ptA, rotCenter, phi);
        const rotB = rotatePoint(ptB, rotCenter, phi);

        let finalA = { i: Number(formatCoord(rotA.x / stepX)), j: Number(formatCoord(rotA.y / stepY)) };
        let finalB = { i: Number(formatCoord(rotB.x / stepX)), j: Number(formatCoord(rotB.y / stepY)) };

        if (options.snapToGrid && latticeGrid) {
          const snapA = latticeGrid.snapToNode(rotA);
          const snapB = latticeGrid.snapToNode(rotB);
          if (snapA.snapped) finalA = { i: snapA.i, j: snapA.j };
          if (snapB.snapped) finalB = { i: snapB.i, j: snapB.j };
        }

        if (finalA.i === finalB.i && finalA.j === finalB.j) continue;

        const kKey = edgeKey(finalA.i, finalA.j, finalB.i, finalB.j);
        mergedMap.set(kKey, {
          u: [finalA.i, finalA.j],
          v: [finalB.i, finalB.j],
          partitionId: edge.partitionId || 'p_full',
          layerId: edge.layerId || 'layer_main'
        });
      }
    }
    return mergedMap;
  }

  // Case B: 3-Point Arc definition { p1, p2, p3 }
  if (source && source.p1 && source.p2 && source.p3) {
    const replicatedArcs = [];
    for (let k = 0; k < N; k++) {
      const phi = k * angleStep;
      const rP1 = rotatePoint(source.p1, rotCenter, phi);
      const rP2 = rotatePoint(source.p2, rotCenter, phi);
      const rP3 = rotatePoint(source.p3, rotCenter, phi);
      replicatedArcs.push(compute3PointArc(rP1, rP2, rP3));
    }
    return replicatedArcs;
  }

  // Case C: Spline definition (instance of CentripetalSpline or { points, closed })
  if (source && (source instanceof CentripetalSpline || Array.isArray(source.rawPoints) || Array.isArray(source.points))) {
    const rawPts = source.rawPoints || source.points;
    const closed = Boolean(source.closed);
    const alpha = source.alpha || 0.5;

    const replicatedSplines = [];
    for (let k = 0; k < N; k++) {
      const phi = k * angleStep;
      const rotatedPts = rawPts.map(p => ({
        ...rotatePoint(p, rotCenter, phi),
        isCusp: Boolean(p.isCusp || p.isCorner)
      }));
      replicatedSplines.push(new CentripetalSpline(rotatedPts, { closed, alpha }));
    }
    return replicatedSplines;
  }

  // Case D: Point Array
  if (Array.isArray(source)) {
    const replicatedSets = [];
    for (let k = 0; k < N; k++) {
      const phi = k * angleStep;
      replicatedSets.push(source.map(pt => rotatePoint(pt, rotCenter, phi)));
    }
    return replicatedSets;
  }

  return [source];
}

// =============================================================================
// SECTION 6: CurveEngine Controller & Canvas Drafting Interactive Preview
// =============================================================================

/**
 * Sashiko Studio CAD CurveEngine interactive controller.
 * Integrates 3-point arcs, centripetal splines, stitch discretization, and live preview.
 */
export class CurveEngine {
  constructor(canvasEl, camera, latticeGrid, stitchPen = null, historyManager = null) {
    this.canvas = canvasEl;
    this.camera = camera;
    this.latticeGrid = latticeGrid;
    this.stitchPen = stitchPen;
    this.historyManager = historyManager;

    // Tool state: 'idle' | 'arc' | 'spline'
    this.activeTool = 'idle';

    // 3-Point Arc drafting points: [P1, P2] -> cursor is candidate P3
    this.draftArcPoints = [];

    // Spline drafting points: [P0, P1, P2...] -> cursor is candidate
    this.draftSplinePoints = [];
    this.splineClosed = false;

    // Symmetry Configuration
    this.symmetryOrder = 1; // 1, 2, 3, 4, 5, 6, 8, 12
    this.symmetryCenter = null; // defaults to artboard center

    // Sashiko Running Stitch Configuration
    this.stitchLengthMm = DEFAULT_STITCH_LENGTH_MM;
    this.gapLengthMm = DEFAULT_GAP_LENGTH_MM;
    this.snapToGrid = true;
    this.balancedStitches = true;

    // Cursor tracking
    this.currentCursor = null;

    // Callbacks
    this.onStitchesCommitted = null;

    this.bindEvents();
  }

  /**
   * Binds pointer and keyboard event listeners to canvas and window.
   */
  bindEvents() {
    if (!this.canvas) return;

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.activeTool === 'idle' || e.button !== 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const worldPt = this.camera
        ? this.camera.screenToWorld(e.clientX, e.clientY)
        : { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (this.handlePointerDown(worldPt, e)) {
        e.stopPropagation();
      }
    }, true);

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.activeTool === 'idle') return;
      const rect = this.canvas.getBoundingClientRect();
      const worldPt = this.camera
        ? this.camera.screenToWorld(e.clientX, e.clientY)
        : { x: e.clientX - rect.left, y: e.clientY - rect.top };

      this.handlePointerMove(worldPt);
    });

    this.canvas.addEventListener('dblclick', (e) => {
      if (this.activeTool === 'idle') return;
      const rect = this.canvas.getBoundingClientRect();
      const worldPt = this.camera
        ? this.camera.screenToWorld(e.clientX, e.clientY)
        : { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (this.handleDoubleClick(worldPt)) {
        e.stopPropagation();
      }
    }, true);

    window.addEventListener('keydown', (e) => {
      if (this.activeTool === 'idle') return;
      if (this.handleKeyDown(e)) {
        e.stopPropagation();
      }
    });
  }

  /**
   * Programmatically creates and commits a 3-point arc.
   */
  createArc(p1, p2, p3, options = {}) {
    const arc = compute3PointArc(p1, p2, p3);
    const order = options.symmetryOrder || this.symmetryOrder;
    const center = options.symmetryCenter || this.getResolvedSymmetryCenter();

    const res = discretizeCurveToStitches(arc, {
      stitchLengthMm: options.stitchLengthMm || this.stitchLengthMm,
      gapLengthMm: options.gapLengthMm || this.gapLengthMm,
      snapToGrid: options.snapToGrid !== undefined ? options.snapToGrid : this.snapToGrid,
      latticeGrid: this.latticeGrid,
      balanced: options.balanced !== undefined ? options.balanced : this.balancedStitches,
      partitionId: options.partitionId || 'p_full',
      layerId: options.layerId || 'layer_main',
      ppi: this.camera?.ppi || DEFAULT_PPI
    });

    const finalStitchMap = generateRadialSymmetry(res.stitchMap, order, center, {
      latticeGrid: this.latticeGrid,
      snapToGrid: options.snapToGrid !== undefined ? options.snapToGrid : this.snapToGrid
    });

    this.injectStitches(finalStitchMap);
    return { arc, stitchMap: finalStitchMap, result: res };
  }

  /**
   * Programmatically creates and commits a spline.
   */
  createSpline(points, options = {}) {
    const closed = Boolean(options.closed !== undefined ? options.closed : false);
    const spline = new CentripetalSpline(points, { closed, alpha: options.alpha || 0.5 });
    const order = options.symmetryOrder || this.symmetryOrder;
    const center = options.symmetryCenter || this.getResolvedSymmetryCenter();

    const res = discretizeCurveToStitches(spline, {
      stitchLengthMm: options.stitchLengthMm || this.stitchLengthMm,
      gapLengthMm: options.gapLengthMm || this.gapLengthMm,
      snapToGrid: options.snapToGrid !== undefined ? options.snapToGrid : this.snapToGrid,
      latticeGrid: this.latticeGrid,
      balanced: options.balanced !== undefined ? options.balanced : this.balancedStitches,
      isClosed: closed,
      partitionId: options.partitionId || 'p_full',
      layerId: options.layerId || 'layer_main',
      ppi: this.camera?.ppi || DEFAULT_PPI
    });

    const finalStitchMap = generateRadialSymmetry(res.stitchMap, order, center, {
      latticeGrid: this.latticeGrid,
      snapToGrid: options.snapToGrid !== undefined ? options.snapToGrid : this.snapToGrid
    });

    this.injectStitches(finalStitchMap);
    return { spline, stitchMap: finalStitchMap, result: res };
  }

  /**
   * Creates an authentic 5-petal Japanese Sakura blossom at given center with radius.
   */
  createSakuraBlossom(center, radius = 80, options = {}) {
    const cx = center.x;
    const cy = center.y;
    const r = radius;

    // Single petal points: tip at (cx, cy - r), curving outward, notched tip
    const petalPoints = [
      { x: cx, y: cy - r * 0.25, isCusp: true },            // Base notch
      { x: cx - r * 0.35, y: cy - r * 0.65, isCusp: false }, // Left petal belly
      { x: cx - r * 0.15, y: cy - r, isCusp: true },         // Left petal lobe tip
      { x: cx, y: cy - r * 0.88, isCusp: true },             // Center notch indent
      { x: cx + r * 0.15, y: cy - r, isCusp: true },         // Right petal lobe tip
      { x: cx + r * 0.35, y: cy - r * 0.65, isCusp: false }  // Right petal belly
    ];

    return this.createSpline(petalPoints, {
      ...options,
      closed: true,
      symmetryOrder: 5,
      symmetryCenter: center
    });
  }

  /**
   * Sets active drafting tool mode ('idle' | 'arc' | 'spline').
   */
  setTool(tool) {
    this.activeTool = tool || 'idle';
    this.cancelDrafting();
    if (this.camera) this.camera.requestRender();
  }

  /**
   * Alias for setTool supporting 'curve' / 'spline' / 'arc' / 'idle'.
   */
  setMode(mode) {
    if (mode === 'curve' || mode === 'spline') {
      this.setTool('spline');
    } else if (mode === 'arc') {
      this.setTool('arc');
    } else {
      this.setTool('idle');
    }
  }

  /**
   * Alias to cancel drafting.
   */
  cancel() {
    this.cancelDrafting();
  }

  /**
   * Sets N-fold radial symmetry order (1, 2, 3, 4, 5, 6, 8, 12).
   */
  setSymmetryOrder(n) {
    this.symmetryOrder = Math.max(1, Math.min(12, Math.round(n)));
    if (this.camera) this.camera.requestRender();
  }

  /**
   * Alias for setSymmetryOrder.
   */
  setRadialSymmetry(n) {
    this.setSymmetryOrder(n);
  }

  /**
   * Sets explicit symmetry origin center. If null, auto-calculates artboard center.
   */
  setSymmetryCenter(centerPt) {
    this.symmetryCenter = centerPt ? { x: centerPt.x, y: centerPt.y } : null;
    if (this.camera) this.camera.requestRender();
  }

  /**
   * Resolves active symmetry origin center (defaults to physical artboard center).
   */
  getResolvedSymmetryCenter() {
    if (this.symmetryCenter) return this.symmetryCenter;
    if (this.camera) {
      const w = this.camera.artboardWidthPx || this.camera.cushionPx || 1000;
      const h = this.camera.artboardHeightPx || this.camera.cushionPx || 1000;
      return { x: w / 2, y: h / 2 };
    }
    return { x: 0, y: 0 };
  }

  /**
   * Cancels current active drafting and clears scratch points.
   */
  cancelDrafting() {
    this.draftArcPoints = [];
    this.draftSplinePoints = [];
    this.splineClosed = false;
    this.currentCursor = null;
    if (this.camera) this.camera.requestRender();
  }

  /**
   * Handles pointerdown event from canvas stage.
   */
  handlePointerDown(worldPt, e) {
    if (this.activeTool === 'idle' || e.button !== 0) return false;

    // Magnetic snap if grid active
    const targetPt = (this.snapToGrid && this.latticeGrid)
      ? this.latticeGrid.snapToNode(worldPt)
      : worldPt;

    const pt = { x: targetPt.x, y: targetPt.y };

    if (this.activeTool === 'arc') {
      this.handleArcClick(pt);
      return true;
    }

    if (this.activeTool === 'spline') {
      this.handleSplineClick(pt, e);
      return true;
    }

    return false;
  }

  /**
   * Handles 3-point arc click sequence:
   * Click 1 -> P1 (Start)
   * Click 2 -> P2 (Through/Apex)
   * Click 3 -> P3 (End) -> Commits Arc!
   */
  handleArcClick(pt) {
    this.draftArcPoints.push(pt);

    if (this.draftArcPoints.length === 3) {
      const [p1, p2, p3] = this.draftArcPoints;
      this.commitArc(p1, p2, p3);
      this.draftArcPoints = [];
    }

    if (this.camera) this.camera.requestRender();
  }

  /**
   * Handles spline click sequence:
   * Click -> Appends control point.
   * Clicking near start point P0 -> Closes loop and commits!
   */
  handleSplineClick(pt, e) {
    // Check if clicking near start point to close loop
    if (this.draftSplinePoints.length >= 3) {
      const p0 = this.draftSplinePoints[0];
      const snapDist = (this.latticeGrid?.snapRadiusPx || 16) / (this.camera?.zoom || 1);
      if (distance(pt, p0) <= snapDist) {
        this.splineClosed = true;
        this.commitSpline();
        return;
      }
    }

    // Add point with cusp flag if Alt/Option pressed
    const isCusp = Boolean(e && (e.altKey || e.shiftKey));
    this.draftSplinePoints.push({ ...pt, isCusp });

    if (this.camera) this.camera.requestRender();
  }

  /**
   * Handles double click on canvas (finishes open spline or toggles cusp on anchor).
   */
  handleDoubleClick(worldPt) {
    if (this.activeTool === 'spline' && this.draftSplinePoints.length >= 2) {
      // Finish open spline on double click
      this.splineClosed = false;
      this.commitSpline();
      return true;
    }
    return false;
  }

  /**
   * Handles pointer move event for live ghost cursor preview.
   */
  handlePointerMove(worldPt) {
    if (this.activeTool === 'idle') return;

    const snapPt = (this.snapToGrid && this.latticeGrid)
      ? this.latticeGrid.snapToNode(worldPt)
      : worldPt;

    this.currentCursor = { x: snapPt.x, y: snapPt.y };
    if (this.camera) this.camera.requestRender();
  }

  /**
   * Handles keydown event (Enter to commit, Escape to cancel, Backspace to undo point).
   */
  handleKeyDown(e) {
    if (this.activeTool === 'idle') return false;

    if (e.key === 'Escape') {
      this.cancelDrafting();
      return true;
    }

    if (e.key === 'Enter') {
      if (this.activeTool === 'spline' && this.draftSplinePoints.length >= 2) {
        this.commitSpline();
        return true;
      }
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.activeTool === 'spline' && this.draftSplinePoints.length > 0) {
        this.draftSplinePoints.pop();
        if (this.camera) this.camera.requestRender();
        return true;
      }
      if (this.activeTool === 'arc' && this.draftArcPoints.length > 0) {
        this.draftArcPoints.pop();
        if (this.camera) this.camera.requestRender();
        return true;
      }
    }

    return false;
  }

  /**
   * Commits a 3-point arc, generates stitches with N-fold symmetry, and commits to stitchPen.
   */
  commitArc(p1, p2, p3) {
    const arc = compute3PointArc(p1, p2, p3);
    const center = this.getResolvedSymmetryCenter();

    // Discretize single arc
    const res = discretizeCurveToStitches(arc, {
      stitchLengthMm: this.stitchLengthMm,
      gapLengthMm: this.gapLengthMm,
      snapToGrid: this.snapToGrid,
      latticeGrid: this.latticeGrid,
      balanced: this.balancedStitches,
      ppi: this.camera?.ppi || DEFAULT_PPI
    });

    // Apply N-Fold Symmetry
    const finalStitchMap = generateRadialSymmetry(res.stitchMap, this.symmetryOrder, center, {
      latticeGrid: this.latticeGrid,
      snapToGrid: this.snapToGrid
    });

    this.injectStitches(finalStitchMap);
  }

  /**
   * Commits current drafted spline, generates stitches with N-fold symmetry, and commits to stitchPen.
   */
  commitSpline() {
    if (this.draftSplinePoints.length < 2) {
      this.cancelDrafting();
      return;
    }

    const spline = new CentripetalSpline(this.draftSplinePoints, { closed: this.splineClosed });
    const center = this.getResolvedSymmetryCenter();

    const res = discretizeCurveToStitches(spline, {
      stitchLengthMm: this.stitchLengthMm,
      gapLengthMm: this.gapLengthMm,
      snapToGrid: this.snapToGrid,
      latticeGrid: this.latticeGrid,
      balanced: this.balancedStitches,
      isClosed: this.splineClosed,
      ppi: this.camera?.ppi || DEFAULT_PPI
    });

    // Apply N-Fold Symmetry
    const finalStitchMap = generateRadialSymmetry(res.stitchMap, this.symmetryOrder, center, {
      latticeGrid: this.latticeGrid,
      snapToGrid: this.snapToGrid
    });

    this.injectStitches(finalStitchMap);
    this.cancelDrafting();
  }

  /**
   * Injects discretized stitches into active layer and stitchPen with history snapshot.
   */
  injectStitches(newStitchMap) {
    if (!this.stitchPen) return;

    let addedCount = 0;
    for (const [k, edge] of newStitchMap.entries()) {
      this.stitchPen.stitches.set(k, edge);
      addedCount++;
    }

    if (addedCount > 0) {
      this.stitchPen.notifyChange();
      if (this.stitchPen.camera) this.stitchPen.camera.requestRender();
      if (typeof this.onStitchesCommitted === 'function') {
        this.onStitchesCommitted(newStitchMap);
      }
    }
  }

  // ===========================================================================
  // SECTION 7: Interactive Live Ghost Canvas Rendering
  // ===========================================================================

  /**
   * Renders live ghost preview on canvas during drafting:
   * - Dashed cyan arc / spline curve
   * - Control point anchors & cusp indicators
   * - Circumcenter reticle and radius badge
   * - Discretized running stitch tick marks
   * - Real-time N-fold radial symmetry ghost mandala
   */
  render(ctx, state) {
    if (this.activeTool === 'idle') return;

    ctx.save();

    const zoom = state?.zoom || this.camera?.zoom || 1;
    const invZoom = 1 / zoom;

    const center = this.getResolvedSymmetryCenter();
    const cursor = this.currentCursor;

    // --- Render Mode A: 3-Point Arc ---
    if (this.activeTool === 'arc') {
      this.renderArcPreview(ctx, cursor, center, invZoom);
    }

    // --- Render Mode B: Spline ---
    if (this.activeTool === 'spline') {
      this.renderSplinePreview(ctx, cursor, center, invZoom);
    }

    // Render symmetry center indicator if N > 1
    if (this.symmetryOrder > 1) {
      this.renderSymmetryCenterRosette(ctx, center, invZoom);
    }

    ctx.restore();
  }

  /**
   * Renders 3-point arc live ghost preview and live radial symmetry.
   */
  renderArcPreview(ctx, cursor, center, invZoom) {
    const pts = this.draftArcPoints;

    // State 1: 1 point placed -> dashed straight line to cursor
    if (pts.length === 1 && cursor) {
      this.drawDashedLine(ctx, pts[0], cursor, '#00E5FF', 1.8 * invZoom);
      this.drawAnchorDot(ctx, pts[0], '#00E5FF', 'P1', invZoom);
      this.drawCursorTarget(ctx, cursor, '#00E5FF', invZoom);
      return;
    }

    // State 2: 2 points placed -> live 3-point arc through cursor
    if (pts.length === 2 && cursor) {
      const arc = compute3PointArc(pts[0], pts[1], cursor);

      // Render N-Fold symmetry ghost copies
      if (this.symmetryOrder > 1) {
        const symArcs = generateRadialSymmetry(arc, this.symmetryOrder, center);
        for (let i = 1; i < symArcs.length; i++) {
          this.drawArcPath(ctx, symArcs[i], 'rgba(0, 229, 255, 0.35)', 1.4 * invZoom, [6, 4]);
        }
      }

      // Render primary active arc
      this.drawArcPath(ctx, arc, '#00E5FF', 2.0 * invZoom, [5, 4]);

      // Render circumcenter reticle & radius guide if not collinear
      if (!arc.isCollinear && arc.radius < 5000) {
        this.drawCenterReticle(ctx, arc.center, '#00E5FF', invZoom);
        this.drawDashedLine(ctx, arc.center, pts[1], 'rgba(0, 229, 255, 0.45)', 1.0 * invZoom, [3, 3]);

        // HUD radius badge
        const rMm = pixelsToMm(arc.radius, this.camera?.ppi || DEFAULT_PPI);
        const deg = Math.abs(arc.sweepAngle * (180 / Math.PI));
        const badgeText = `R: ${rMm.toFixed(1)} mm  |  θ: ${deg.toFixed(0)}°`;
        this.drawHudPill(ctx, arc.center.x, arc.center.y - 14 * invZoom, badgeText, invZoom);
      }

      // Draw anchor pins
      this.drawAnchorDot(ctx, pts[0], '#00E5FF', 'P1', invZoom);
      this.drawAnchorDot(ctx, pts[1], '#10B981', 'Apex', invZoom);
      this.drawCursorTarget(ctx, cursor, '#00E5FF', invZoom);
    }
  }

  /**
   * Renders centripetal spline live ghost preview and live radial symmetry.
   */
  renderSplinePreview(ctx, cursor, center, invZoom) {
    const pts = [...this.draftSplinePoints];
    if (cursor) {
      pts.push({ x: cursor.x, y: cursor.y, isCusp: false });
    }

    if (pts.length < 2) {
      if (pts.length === 1) {
        this.drawAnchorDot(ctx, pts[0], '#00E5FF', 'P0', invZoom);
      }
      return;
    }

    const spline = new CentripetalSpline(pts, { closed: this.splineClosed });

    // Render N-Fold symmetry ghost copies
    if (this.symmetryOrder > 1) {
      const symSplines = generateRadialSymmetry(spline, this.symmetryOrder, center);
      for (let i = 1; i < symSplines.length; i++) {
        this.drawSplinePath(ctx, symSplines[i], 'rgba(0, 229, 255, 0.35)', 1.4 * invZoom, [6, 4]);
      }
    }

    // Render primary active spline
    this.drawSplinePath(ctx, spline, '#00E5FF', 2.0 * invZoom, [5, 4]);

    // Draw control point anchors
    for (let i = 0; i < this.draftSplinePoints.length; i++) {
      const p = this.draftSplinePoints[i];
      if (p.isCusp) {
        this.drawCuspDiamond(ctx, p, '#F59E0B', `C${i}`, invZoom);
      } else {
        this.drawAnchorDot(ctx, p, '#00E5FF', `P${i}`, invZoom);
      }
    }

    // Cursor indicator
    if (cursor) {
      // Check if cursor is hovering near start point P0 (closing loop)
      const p0 = this.draftSplinePoints[0];
      const snapDist = (this.latticeGrid?.snapRadiusPx || 16) * invZoom;
      const isClosing = this.draftSplinePoints.length >= 3 && distance(cursor, p0) <= snapDist;

      if (isClosing) {
        this.drawClosingRing(ctx, p0, '#10B981', invZoom);
        this.drawHudPill(ctx, p0.x, p0.y - 16 * invZoom, 'Close Loop', invZoom);
      } else {
        this.drawCursorTarget(ctx, cursor, '#00E5FF', invZoom);
      }
    }
  }

  // --- Canvas Primitive Draw Helpers ---

  drawDashedLine(ctx, p1, p2, color, width, dash = [5, 4]) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  drawArcPath(ctx, arc, color, width, dash = null) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);

    if (arc.isCollinear) {
      ctx.beginPath();
      ctx.moveTo(arc.p1.x, arc.p1.y);
      ctx.lineTo(arc.p3.x, arc.p3.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.isClockwise);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSplinePath(ctx, spline, color, width, dash = null) {
    if (!spline.bezierSegments || spline.bezierSegments.length === 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);

    ctx.beginPath();
    const first = spline.bezierSegments[0];
    ctx.moveTo(first.p0.x, first.p0.y);

    for (const seg of spline.bezierSegments) {
      ctx.bezierCurveTo(seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.p1.x, seg.p1.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawAnchorDot(ctx, pt, color, label, invZoom) {
    ctx.save();
    const r = 4.5 * invZoom;
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * invZoom;

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (label) {
      ctx.fillStyle = color;
      ctx.font = `${Math.round(10 * invZoom)}px sans-serif`;
      ctx.fillText(label, pt.x + 7 * invZoom, pt.y - 7 * invZoom);
    }
    ctx.restore();
  }

  drawCuspDiamond(ctx, pt, color, label, invZoom) {
    ctx.save();
    const s = 6 * invZoom;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5 * invZoom;

    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y - s);
    ctx.lineTo(pt.x + s, pt.y);
    ctx.lineTo(pt.x, pt.y + s);
    ctx.lineTo(pt.x - s, pt.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (label) {
      ctx.fillStyle = color;
      ctx.font = `${Math.round(10 * invZoom)}px sans-serif`;
      ctx.fillText(label, pt.x + 8 * invZoom, pt.y - 8 * invZoom);
    }
    ctx.restore();
  }

  drawCursorTarget(ctx, pt, color, invZoom) {
    ctx.save();
    const r = 5 * invZoom;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * invZoom;

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2 * invZoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawClosingRing(ctx, pt, color, invZoom) {
    ctx.save();
    const r = 9 * invZoom;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * invZoom;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawCenterReticle(ctx, pt, color, invZoom) {
    ctx.save();
    const arm = 7 * invZoom;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 1.2 * invZoom;

    ctx.beginPath();
    ctx.moveTo(pt.x - arm, pt.y);
    ctx.lineTo(pt.x + arm, pt.y);
    ctx.moveTo(pt.x, pt.y - arm);
    ctx.lineTo(pt.x, pt.y + arm);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.5 * invZoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawSymmetryCenterRosette(ctx, pt, invZoom) {
    ctx.save();
    const r = 12 * invZoom;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.lineWidth = 1.2 * invZoom;
    ctx.setLineDash([2, 2]);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // Small radial spokes
    const n = this.symmetryOrder;
    for (let k = 0; k < n; k++) {
      const angle = k * ((Math.PI * 2) / n);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x + r * Math.cos(angle), pt.y + r * Math.sin(angle));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHudPill(ctx, x, y, text, invZoom) {
    ctx.save();
    ctx.font = `${Math.round(11 * invZoom)}px monospace`;
    const metrics = ctx.measureText(text);
    const pad = 5 * invZoom;
    const w = metrics.width + pad * 2;
    const h = 16 * invZoom;

    ctx.fillStyle = 'rgba(18, 19, 22, 0.85)';
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 1 * invZoom;

    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 4 * invZoom);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#00E5FF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}
