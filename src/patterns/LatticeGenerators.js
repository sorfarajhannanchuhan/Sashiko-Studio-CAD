/**
 * Sashiko Studio CAD - Lattice Pattern Generators
 * Every pattern is mathematically generated as discrete integer edges
 * connecting Stencil Grid Nodes (i1, j1) to (i2, j2).
 * Zero floating/unanchored stitches.
 */

import { edgeKey } from '../core/LatticeGrid.js';

export const PATTERN_KEYS = {
  KAKI_NO_HANA: 'kaki_no_hana',
  ASANOHA: 'asanoha',
  SEIGAIHA: 'seigaiha',
  SHIPPO: 'shippo',
  KIKKO: 'kikko',
  SAYAGATA: 'sayagata',
  JUJI_ZASHI: 'juji_zashi',
  HISHI_MOYO: 'hishi_moyo',
  DHEU_WAVE: 'dheu_wave',
  DHANER_SHISH: 'dhaner_shish'
};

/**
 * 1. Kaki no hana (Persimmon Flower - Traditional Hitomezashi)
 * Alternating horizontal and vertical stitches forming square flower grids.
 */
export function generateKakiNoHana(minI, minJ, maxI, maxJ) {
  const edges = new Map();

  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const modJ = ((j % 4) + 4) % 4;
      const modI = ((i % 4) + 4) % 4;

      // Horizontal stitches
      if (modJ === 0 || modJ === 2) {
        if ((modJ === 0 && (modI === 0 || modI === 2)) ||
            (modJ === 2 && (modI === 1 || modI === 3))) {
          if (i + 1 <= maxI) {
            const k = edgeKey(i, j, i + 1, j);
            edges.set(k, { u: [i, j], v: [i + 1, j] });
          }
        }
      }

      // Vertical stitches
      if (modI === 0 || modI === 2) {
        if ((modI === 0 && (modJ === 1 || modJ === 3)) ||
            (modI === 2 && (modJ === 0 || modJ === 2))) {
          if (j + 1 <= maxJ) {
            const k = edgeKey(i, j, i, j + 1);
            edges.set(k, { u: [i, j], v: [i, j + 1] });
          }
        }
      }
    }
  }

  return edges;
}

/**
 * 2. Authentic Hexagonal Asanoha (Hemp Leaf / 麻の葉)
 * Traditional p6m hexagonal wallpaper geometry:
 * An equilateral triangular lattice where every triangle is partitioned
 * from its vertices to its centroid, creating six 60°–120° rhombic petals
 * with central leaf veins radiating from every star center.
 */
export function generateAsanoha(minI, minJ, maxI, maxJ) {
  const edges = new Map();
  // L is the side length of the equilateral triangle in grid units
  const L = 6;
  const H = L * (Math.sqrt(3) / 2); // ~5.19615

  const addEdge = (x1, y1, x2, y2) => {
    const rx1 = Math.round(x1 * 1000) / 1000;
    const ry1 = Math.round(y1 * 1000) / 1000;
    const rx2 = Math.round(x2 * 1000) / 1000;
    const ry2 = Math.round(y2 * 1000) / 1000;

    if (rx1 === rx2 && ry1 === ry2) return;

    const tol = 0.5;
    if (Math.min(rx1, rx2) < minI - tol || Math.max(rx1, rx2) > maxI + tol ||
        Math.min(ry1, ry2) < minJ - tol || Math.max(ry1, ry2) > maxJ + tol) {
      return;
    }

    const k = edgeKey(rx1, ry1, rx2, ry2);
    if (!edges.has(k)) {
      edges.set(k, { u: [rx1, ry1], v: [rx2, ry2] });
    }
  };

  const rMin = Math.floor((minJ - H) / H);
  const rMax = Math.ceil((maxJ + H) / H);
  const cMin = Math.floor((minI - L) / L);
  const cMax = Math.ceil((maxI + L) / L);

  const getVertex = (c, r) => {
    const x = c * L + (r % 2 !== 0 ? L * 0.5 : 0);
    const y = r * H;
    return { x, y };
  };

  const addTriangle = (v1, v2, v3) => {
    // 3 outer edges
    addEdge(v1.x, v1.y, v2.x, v2.y);
    addEdge(v2.x, v2.y, v3.x, v3.y);
    addEdge(v3.x, v3.y, v1.x, v1.y);

    // Centroid
    const mx = (v1.x + v2.x + v3.x) / 3;
    const my = (v1.y + v2.y + v3.y) / 3;

    // 3 internal spokes
    addEdge(v1.x, v1.y, mx, my);
    addEdge(v2.x, v2.y, mx, my);
    addEdge(v3.x, v3.y, mx, my);
  };

  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const vTopLeft = getVertex(c, r);
      const vTopRight = getVertex(c + 1, r);
      const vBottomLeft = getVertex(c, r + 1);
      const vBottomRight = getVertex(c + 1, r + 1);

      if (r % 2 === 0) {
        addTriangle(vTopLeft, vTopRight, vBottomLeft);
        addTriangle(vTopRight, vBottomRight, vBottomLeft);
      } else {
        addTriangle(vTopLeft, vBottomLeft, vBottomRight);
        addTriangle(vTopLeft, vTopRight, vBottomRight);
      }
    }
  }

  return edges;
}

/**
 * 3. Seigaiha (Blue Ocean Waves / 青海波)
 * Concentric wave arches traced across lattice steps.
 */
export function generateSeigaiha(minI, minJ, maxI, maxJ) {
  const edges = new Map();
  const span = 4;

  const startI = Math.floor(minI / span) * span;
  const startJ = Math.floor(minJ / 2) * 2;

  const addEdge = (x1, y1, x2, y2) => {
    if (x1 >= minI && x1 <= maxI && y1 >= minJ && y1 <= maxJ &&
        x2 >= minI && x2 <= maxI && y2 >= minJ && y2 <= maxJ) {
      const k = edgeKey(x1, y1, x2, y2);
      edges.set(k, { u: [x1, y1], v: [x2, y2] });
    }
  };

  for (let j = startJ; j <= maxJ; j += 2) {
    const rowOffset = ((j / 2) % 2 === 0) ? 0 : span / 2;
    for (let i = startI - span; i <= maxI + span; i += span) {
      const cx = i + rowOffset;
      const cy = j;

      // Inner Arch
      addEdge(cx - 1, cy, cx, cy - 1);
      addEdge(cx, cy - 1, cx + 1, cy);

      // Outer Arch
      addEdge(cx - 2, cy, cx - 1, cy - 1);
      addEdge(cx - 1, cy - 1, cx, cy - 2);
      addEdge(cx, cy - 2, cx + 1, cy - 1);
      addEdge(cx + 1, cy - 1, cx + 2, cy);
    }
  }

  return edges;
}

/**
 * 4. Shippo-tsunagi (Seven Treasures / 七宝つなぎ)
 * Interlocking 4-petal lattice circles.
 */
export function generateShippo(minI, minJ, maxI, maxJ) {
  const edges = new Map();
  const step = 4;

  const startI = Math.floor(minI / step) * step;
  const startJ = Math.floor(minJ / step) * step;

  const addEdge = (x1, y1, x2, y2) => {
    if (x1 >= minI && x1 <= maxI && y1 >= minJ && y1 <= maxJ &&
        x2 >= minI && x2 <= maxI && y2 >= minJ && y2 <= maxJ) {
      const k = edgeKey(x1, y1, x2, y2);
      edges.set(k, { u: [x1, y1], v: [x2, y2] });
    }
  };

  for (let j = startJ; j <= maxJ; j += step) {
    for (let i = startI; i <= maxI; i += step) {
      const cx = i + 2;
      const cy = j + 2;

      // Circular ring segmented into 8 lattice edges around (cx, cy)
      addEdge(cx, cy - 2, cx + 1, cy - 1);
      addEdge(cx + 1, cy - 1, cx + 2, cy);
      addEdge(cx + 2, cy, cx + 1, cy + 1);
      addEdge(cx + 1, cy + 1, cx, cy + 2);
      addEdge(cx, cy + 2, cx - 1, cy + 1);
      addEdge(cx - 1, cy + 1, cx - 2, cy);
      addEdge(cx - 2, cy, cx - 1, cy - 1);
      addEdge(cx - 1, cy - 1, cx, cy - 2);
    }
  }

  return edges;
}

/**
 * 5. Kikko (Tortoise Shell Hexagons / 亀甲)
 * Regular hexagonal honeycomb mesh.
 */
export function generateKikko(minI, minJ, maxI, maxJ) {
  const edges = new Map();
  const widthStep = 4;
  const heightStep = 2;

  const startI = Math.floor(minI / widthStep) * widthStep;
  const startJ = Math.floor(minJ / heightStep) * heightStep;

  const addEdge = (x1, y1, x2, y2) => {
    if (x1 >= minI && x1 <= maxI && y1 >= minJ && y1 <= maxJ &&
        x2 >= minI && x2 <= maxI && y2 >= minJ && y2 <= maxJ) {
      const k = edgeKey(x1, y1, x2, y2);
      edges.set(k, { u: [x1, y1], v: [x2, y2] });
    }
  };

  for (let j = startJ; j <= maxJ; j += heightStep * 2) {
    for (let i = startI; i <= maxI; i += widthStep) {
      // Row 1 Hexagon
      addEdge(i, j, i + 2, j);
      addEdge(i + 2, j, i + 3, j + 1);
      addEdge(i + 3, j + 1, i + 2, j + 2);
      addEdge(i + 2, j + 2, i, j + 2);
      addEdge(i, j + 2, i - 1, j + 1);
      addEdge(i - 1, j + 1, i, j);

      // Staggered Row 2 Hexagon
      const i2 = i + 2;
      const j2 = j + 2;
      addEdge(i2, j2, i2 + 2, j2);
      addEdge(i2 + 2, j2, i2 + 3, j2 + 1);
      addEdge(i2 + 3, j2 + 1, i2 + 2, j2 + 2);
      addEdge(i2 + 2, j2 + 2, i2, j2 + 2);
      addEdge(i2, j2 + 2, i2 - 1, j2 + 1);
      addEdge(i2 - 1, j2 + 1, i2, j2);
    }
  }

  return edges;
}

/**
 * 6. Sayagata (Key Fret / 紗綾形)
 * Traditional interlocking orthogonal maze fret.
 */
export function generateSayagata(minI, minJ, maxI, maxJ) {
  const edges = new Map();
  const step = 4;

  const startI = Math.floor(minI / step) * step;
  const startJ = Math.floor(minJ / step) * step;

  const addEdge = (x1, y1, x2, y2) => {
    if (x1 >= minI && x1 <= maxI && y1 >= minJ && y1 <= maxJ &&
        x2 >= minI && x2 <= maxI && y2 >= minJ && y2 <= maxJ) {
      const k = edgeKey(x1, y1, x2, y2);
      edges.set(k, { u: [x1, y1], v: [x2, y2] });
    }
  };

  for (let j = startJ; j <= maxJ; j += step) {
    for (let i = startI; i <= maxI; i += step) {
      // Interlocking fret hook
      addEdge(i, j, i + 2, j);
      addEdge(i + 2, j, i + 2, j + 1);
      addEdge(i + 2, j + 1, i + 1, j + 1);
      addEdge(i + 1, j + 1, i + 1, j + 3);
      addEdge(i + 1, j + 3, i + 3, j + 3);
      addEdge(i + 3, j + 3, i + 3, j + 2);
      addEdge(i + 3, j + 2, i + 4, j + 2);
    }
  }

  return edges;
}

/**
 * 7. Juji-zashi (Japanese 10-Cross Lattice / 十字刺し)
 * Protective cross stitches arranged at alternate integer lattice coordinates.
 */
export function generateJujiZashi(minI, minJ, maxI, maxJ) {
  const edges = new Map();

  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      if ((i + j) % 2 === 0) {
        // Horizontal arm
        if (i - 1 >= minI) {
          const k1 = edgeKey(i - 1, j, i, j);
          edges.set(k1, { u: [i - 1, j], v: [i, j] });
        }
        if (i + 1 <= maxI) {
          const k2 = edgeKey(i, j, i + 1, j);
          edges.set(k2, { u: [i, j], v: [i + 1, j] });
        }
        // Vertical arm
        if (j - 1 >= minJ) {
          const k3 = edgeKey(i, j - 1, i, j);
          edges.set(k3, { u: [i, j - 1], v: [i, j] });
        }
        if (j + 1 <= maxJ) {
          const k4 = edgeKey(i, j, i, j + 1);
          edges.set(k4, { u: [i, j], v: [i, j + 1] });
        }
      }
    }
  }

  return edges;
}

/**
 * 8. Hishi-moyo (Interlocking Diamond Lattice / 菱文様)
 * Diagonal lozenges forming continuous diamond fields.
 */
export function generateHishiMoyo(minI, minJ, maxI, maxJ) {
  const edges = new Map();

  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      // Diagonal Down-Right
      if ((i + j) % 3 === 0 && i + 1 <= maxI && j + 1 <= maxJ) {
        const k1 = edgeKey(i, j, i + 1, j + 1);
        edges.set(k1, { u: [i, j], v: [i + 1, j + 1] });
      }
      // Diagonal Down-Left
      if (((i - j) % 3 + 3) % 3 === 0 && i - 1 >= minI && j + 1 <= maxJ) {
        const k2 = edgeKey(i, j, i - 1, j + 1);
        edges.set(k2, { u: [i, j], v: [i - 1, j + 1] });
      }
    }
  }

  return edges;
}

/**
 * 9. Dheu Wave (Bengali Nakshi Kantha River Waves / ঢেউ)
 * Rhythmic sinusoidal waves running horizontally across fabric partitions.
 */
export function generateDheuWave(minI, minJ, maxI, maxJ) {
  const edges = new Map();

  for (let j = minJ; j <= maxJ; j += 2) {
    for (let i = minI; i < maxI; i++) {
      const phase = (i % 4);
      let targetJ = j;
      if (phase === 0) targetJ = j - 1;
      else if (phase === 1) targetJ = j;
      else if (phase === 2) targetJ = j + 1;
      else if (phase === 3) targetJ = j;

      let nextJ = targetJ;
      const nextPhase = ((i + 1) % 4);
      if (nextPhase === 0) nextJ = j - 1;
      else if (nextPhase === 1) nextJ = j;
      else if (nextPhase === 2) nextJ = j + 1;
      else if (nextPhase === 3) nextJ = j;

      if (targetJ >= minJ && targetJ <= maxJ && nextJ >= minJ && nextJ <= maxJ) {
        const k = edgeKey(i, targetJ, i + 1, nextJ);
        edges.set(k, { u: [i, targetJ], v: [i + 1, nextJ] });
      }
    }
  }

  return edges;
}

/**
 * 10. Dhaner Shish (Bengali & Japanese Rice Grain Stalk / 稲穂・ধানের শীষ)
 * Interlocking chevron stalks forming agricultural abundance borders.
 */
export function generateDhanerShish(minI, minJ, maxI, maxJ) {
  const edges = new Map();

  for (let j = minJ; j <= maxJ; j += 2) {
    for (let i = minI; i <= maxI; i++) {
      // Central grain axis
      if (i + 1 <= maxI) {
        const kCenter = edgeKey(i, j, i + 1, j);
        edges.set(kCenter, { u: [i, j], v: [i + 1, j] });
      }
      // Top grain angle
      if (i + 1 <= maxI && j - 1 >= minJ && i % 2 === 0) {
        const kTop = edgeKey(i, j, i + 1, j - 1);
        edges.set(kTop, { u: [i, j], v: [i + 1, j - 1] });
      }
      // Bottom grain angle
      if (i + 1 <= maxI && j + 1 <= maxJ && i % 2 === 1) {
        const kBottom = edgeKey(i, j, i + 1, j + 1);
        edges.set(kBottom, { u: [i, j], v: [i + 1, j + 1] });
      }
    }
  }

  return edges;
}

export function generatePattern(patternKey, minI, minJ, maxI, maxJ) {
  switch (patternKey) {
    case PATTERN_KEYS.KAKI_NO_HANA:
      return generateKakiNoHana(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.ASANOHA:
      return generateAsanoha(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.SEIGAIHA:
      return generateSeigaiha(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.SHIPPO:
      return generateShippo(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.KIKKO:
      return generateKikko(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.SAYAGATA:
      return generateSayagata(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.JUJI_ZASHI:
      return generateJujiZashi(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.HISHI_MOYO:
      return generateHishiMoyo(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.DHEU_WAVE:
      return generateDheuWave(minI, minJ, maxI, maxJ);
    case PATTERN_KEYS.DHANER_SHISH:
      return generateDhanerShish(minI, minJ, maxI, maxJ);
    default:
      return generateKakiNoHana(minI, minJ, maxI, maxJ);
  }
}
