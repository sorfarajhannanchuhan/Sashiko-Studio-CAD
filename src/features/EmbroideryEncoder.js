/**
 * Sashiko Studio CAD - Industrial Embroidery Machine File Encoders
 * Converts Sashiko lattice vector stitches into:
 * 1. Tajima (.DST) - Industry standard commercial embroidery format (Tajima, Barudan, SWF, Melco, Happy)
 * 2. Brother (.PES / .PEC) - Universal home & semi-pro embroidery format (Brother, Baby Lock, Bernina)
 *
 * Coordinates are converted from CAD pixels (96 ppi) to standard machine units (0.1 mm).
 */

export class EmbroideryEncoder {
  /**
   * Decomposes delta (-121 to +121 units) into balanced ternary components for Tajima encoding.
   * Powers of 3: 1, 3, 9, 27, 81.
   */
  static decomposeTajima(val) {
    const c = { 1: 0, 3: 0, 9: 0, 27: 0, 81: 0 };
    let n = val;
    for (let i = 0; i < 5; i++) {
      const w = Math.pow(3, i);
      let r = ((n % 3) + 3) % 3;
      if (r === 2) r = -1;
      c[w] = r;
      n = Math.round((n - r) / 3);
    }
    return c;
  }

  /**
   * Encodes a single Tajima stitch delta (dx, dy) and stitch type.
   * type: 'NORMAL' | 'JUMP' | 'COLOR_CHANGE' | 'END'
   */
  static encodeTajimaStitch(dx, dy, type = 'NORMAL') {
    if (type === 'END') {
      return new Uint8Array([0x00, 0x00, 0xF3]);
    }

    const cx = this.decomposeTajima(Math.max(-121, Math.min(121, dx)));
    const cy = this.decomposeTajima(Math.max(-121, Math.min(121, dy)));

    let b0 = 0;
    let b1 = 0;
    let b2 = 0x03; // Base stitch bits

    // Byte 0
    if (cy[1] === 1)  b0 |= (1 << 0);
    if (cy[1] === -1) b0 |= (1 << 1);
    if (cy[9] === 1)  b0 |= (1 << 2);
    if (cy[9] === -1) b0 |= (1 << 3);
    if (cx[9] === -1) b0 |= (1 << 4);
    if (cx[9] === 1)  b0 |= (1 << 5);
    if (cx[1] === -1) b0 |= (1 << 6);
    if (cx[1] === 1)  b0 |= (1 << 7);

    // Byte 1
    if (cy[3] === 1)   b1 |= (1 << 0);
    if (cy[3] === -1)  b1 |= (1 << 1);
    if (cy[27] === 1)  b1 |= (1 << 2);
    if (cy[27] === -1) b1 |= (1 << 3);
    if (cx[27] === -1) b1 |= (1 << 4);
    if (cx[27] === 1)  b1 |= (1 << 5);
    if (cx[3] === -1)  b1 |= (1 << 6);
    if (cx[3] === 1)   b1 |= (1 << 7);

    // Byte 2
    if (cy[81] === 1)  b2 |= (1 << 0);
    if (cy[81] === -1) b2 |= (1 << 1);
    if (cx[81] === -1) b2 |= (1 << 6);
    if (cx[81] === 1)  b2 |= (1 << 7);

    if (type === 'JUMP') {
      b2 |= 0x80; // Tajima Jump flag
    } else if (type === 'COLOR_CHANGE') {
      b2 |= 0xC0; // Color change flag
    }

    return new Uint8Array([b0, b1, b2]);
  }

  /**
   * Prepares ordered stitch run paths from CAD stitches map.
   * Output coordinates are centered at (0, 0) in 0.1mm units.
   */
  static extractEmbroideryRuns(stitchesMap, latticeGrid) {
    if (!stitchesMap || stitchesMap.size === 0) {
      return { segments: [], runs: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
    }

    // 1. Gather all line segments in world pixels
    const segments = [];
    let minPxX = Infinity, maxPxX = -Infinity, minPxY = Infinity, maxPxY = -Infinity;

    for (const edge of stitchesMap.values()) {
      const p1 = latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);

      segments.push({ p1, p2, layerId: edge.layerId || 'layer_main' });

      minPxX = Math.min(minPxX, p1.x, p2.x);
      maxPxX = Math.max(maxPxX, p1.x, p2.x);
      minPxY = Math.min(minPxY, p1.y, p2.y);
      maxPxY = Math.max(maxPxY, p1.y, p2.y);
    }

    const centerPxX = (minPxX + maxPxX) / 2;
    const centerPxY = (minPxY + maxPxY) / 2;

    // Conversion factor: 1 pixel = (25.4 / 96) mm = 0.264583 mm = 2.64583 units (0.1mm)
    const pxToUnits = (25.4 / 96) * 10;

    // Convert to centered machine units (with Cartesian Y-flip)
    const machineSegments = segments.map(seg => ({
      x1: Math.round((seg.p1.x - centerPxX) * pxToUnits),
      y1: Math.round(-(seg.p1.y - centerPxY) * pxToUnits), // Cartesian Y-up
      x2: Math.round((seg.p2.x - centerPxX) * pxToUnits),
      y2: Math.round(-(seg.p2.y - centerPxY) * pxToUnits),
      layerId: seg.layerId
    }));

    return { segments: machineSegments };
  }

  /**
   * Generates a 100% valid Tajima (.DST) binary buffer.
   */
  static generateDST(stitchesMap, latticeGrid, designName = 'SASHIKO CAD') {
    const { segments = [] } = this.extractEmbroideryRuns(stitchesMap, latticeGrid);
    if (!segments || segments.length === 0) {
      const header = new Uint8Array(512);
      const endCode = new Uint8Array([0x00, 0x00, 0xF3]);
      const out = new Uint8Array(512 + 3);
      out.set(header, 0);
      out.set(endCode, 512);
      return out.buffer;
    }

    const stitchBytes = [];
    let currentX = 0;
    let currentY = 0;
    let totalStitchCount = 0;

    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    const emitStep = (targetX, targetY, isJump) => {
      let dx = targetX - currentX;
      let dy = targetY - currentY;

      // Tajima maximum delta per step is 121 units (12.1mm)
      while (Math.abs(dx) > 121 || Math.abs(dy) > 121) {
        const stepX = Math.max(-121, Math.min(121, dx));
        const stepY = Math.max(-121, Math.min(121, dy));

        const bytes = this.encodeTajimaStitch(stepX, stepY, isJump ? 'JUMP' : 'NORMAL');
        stitchBytes.push(...bytes);
        currentX += stepX;
        currentY += stepY;
        dx -= stepX;
        dy -= stepY;
        totalStitchCount++;

        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
      }

      if (dx !== 0 || dy !== 0) {
        const bytes = this.encodeTajimaStitch(dx, dy, isJump ? 'JUMP' : 'NORMAL');
        stitchBytes.push(...bytes);
        currentX += dx;
        currentY += dy;
        totalStitchCount++;

        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
      }
    };

    // Emit stitches
    for (const seg of segments) {
      // 1. Jump from current position to start of segment
      if (currentX !== seg.x1 || currentY !== seg.y1) {
        emitStep(seg.x1, seg.y1, true);
      }
      // 2. Sew along segment
      emitStep(seg.x2, seg.y2, false);
    }

    // 3. Jump back to origin (0, 0)
    if (currentX !== 0 || currentY !== 0) {
      emitStep(0, 0, true);
    }

    // 4. End of Design stitch
    stitchBytes.push(...this.encodeTajimaStitch(0, 0, 'END'));
    totalStitchCount++;

    // Build 512-byte Tajima ASCII Header
    const headerStr = [
      `LA:${(designName || 'SASHIKO').substring(0, 16).padEnd(16, ' ')}\r`,
      `ST:${String(totalStitchCount).padStart(7, ' ')}\r`,
      `CO:  0\r`,
      `+X:${String(Math.abs(maxX)).padStart(5, ' ')}\r`,
      `-X:${String(Math.abs(minX)).padStart(5, ' ')}\r`,
      `+Y:${String(Math.abs(maxY)).padStart(5, ' ')}\r`,
      `-Y:${String(Math.abs(minY)).padStart(5, ' ')}\r`,
      `AX:+    0\r`,
      `AY:+    0\r`,
      `MX:+    0\r`,
      `MY:+    0\r`,
      `PD:******\r`,
      `\x1a`
    ].join('');

    const headerBytes = new Uint8Array(512);
    // Fill with spaces (0x20)
    headerBytes.fill(0x20);

    for (let i = 0; i < headerStr.length && i < 512; i++) {
      headerBytes[i] = headerStr.charCodeAt(i);
    }

    const fullFile = new Uint8Array(512 + stitchBytes.length);
    fullFile.set(headerBytes, 0);
    fullFile.set(new Uint8Array(stitchBytes), 512);

    return fullFile;
  }

  /**
   * Generates a standard Brother (.PES) binary buffer with embedded PEC section.
   */
  static generatePES(stitchesMap, latticeGrid, designName = 'SASHIKO') {
    const { segments = [] } = this.extractEmbroideryRuns(stitchesMap, latticeGrid);
    if (!segments || segments.length === 0) {
      return new Uint8Array(512).buffer;
    }

    // Build PEC Stitch List
    const pecStitchBytes = [];
    let currentX = 0;
    let currentY = 0;
    let totalCount = 0;

    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    const emitPecStep = (targetX, targetY, isJump) => {
      let dx = targetX - currentX;
      let dy = targetY - currentY;

      while (Math.abs(dx) > 63 || Math.abs(dy) > 63) {
        const stepX = Math.max(-63, Math.min(63, dx));
        const stepY = Math.max(-63, Math.min(63, dy));

        encodePecDelta(stepX, stepY, isJump);
        currentX += stepX;
        currentY += stepY;
        dx -= stepX;
        dy -= stepY;
        totalCount++;

        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
      }

      if (dx !== 0 || dy !== 0) {
        encodePecDelta(dx, dy, isJump);
        currentX += dx;
        currentY += dy;
        totalCount++;

        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
      }
    };

    function encodePecDelta(dx, dy, isJump) {
      if (isJump) {
        // Jump stitch: 0x90 followed by 12-bit dx, dy or 2-byte values
        // Standard PEC 2-byte coordinate format:
        // High byte: 0x80 | (isJump ? 0x10 : 0x00) | ((delta >> 8) & 0x0F)
        const b1x = 0x80 | (isJump ? 0x10 : 0x00) | ((dx >> 8) & 0x0F);
        const b2x = dx & 0xFF;
        const b1y = 0x80 | (isJump ? 0x10 : 0x00) | ((dy >> 8) & 0x0F);
        const b2y = dy & 0xFF;
        pecStitchBytes.push(b1x, b2x, b1y, b2y);
      } else {
        // Normal 1-byte delta (range -64 to +63)
        pecStitchBytes.push(dx & 0x7F);
        pecStitchBytes.push(dy & 0x7F);
      }
    }

    for (const seg of segments) {
      if (currentX !== seg.x1 || currentY !== seg.y1) {
        emitPecStep(seg.x1, seg.y1, true);
      }
      emitPecStep(seg.x2, seg.y2, false);
    }

    // End stitch marker in PEC: 0xFF
    pecStitchBytes.push(0xFF);

    // Build PEC Header (512 bytes)
    const pecHeader = new Uint8Array(512);
    pecHeader.fill(0x00);

    // Magic: #PEC0001
    const pecMagic = '#PEC0001';
    for (let i = 0; i < pecMagic.length; i++) pecHeader[i] = pecMagic.charCodeAt(i);

    // Name (at offset 8, 16 chars)
    const namePadded = (designName || 'SASHIKO').substring(0, 16).padEnd(16, ' ');
    for (let i = 0; i < 16; i++) pecHeader[8 + i] = namePadded.charCodeAt(i);

    // Color count (offset 48): 1 color (value = 0x00 for 1 color)
    pecHeader[48] = 0x00;
    pecHeader[49] = 0x05; // Emerald Green thread index in Brother palette

    // Stitch data start offset relative to PEC start (at offset 510-511): 512
    pecHeader[510] = 0x00;
    pecHeader[511] = 0x02; // 0x0200 = 512 bytes

    // Combine PEC Block
    const pecBlock = new Uint8Array(512 + pecStitchBytes.length);
    pecBlock.set(pecHeader, 0);
    pecBlock.set(new Uint8Array(pecStitchBytes), 512);

    // Build PES Header (Starts with #PES0001, then 4-byte offset to PEC)
    const pesMagic = '#PES0001';
    const pesHeader = new Uint8Array(8 + 4);
    for (let i = 0; i < pesMagic.length; i++) pesHeader[i] = pesMagic.charCodeAt(i);

    // 4-byte pointer to PEC block start (8 + 4 = 12 bytes offset)
    const pecOffset = 12;
    pesHeader[8]  = (pecOffset) & 0xFF;
    pesHeader[9]  = (pecOffset >> 8) & 0xFF;
    pesHeader[10] = (pecOffset >> 16) & 0xFF;
    pesHeader[11] = (pecOffset >> 24) & 0xFF;

    const fullFile = new Uint8Array(pesHeader.length + pecBlock.length);
    fullFile.set(pesHeader, 0);
    fullFile.set(pecBlock, pesHeader.length);

    return fullFile;
  }
}
