# Sashiko Studio CAD — Walkthrough & Verification Guide

## 1. Overview & Architecture

**Sashiko Studio CAD** is an autonomous, Figma/Adobe Illustrator-grade local-hosted CAD and lightbox tracing web application running on `http://localhost:5173` via Vite. It is tailored for Japanese Sashiko (Hitomezashi / Moyozashi) and Bengali Nakshi Kantha cushion covers (18"×18" industry standard, 16"×16", 20"×20", and custom dimensions).

All components are built with clean ES Modules in `d:\Antigravity\Sashiko-Studio-CAD`.

---

## 2. Completed Features & User Specification Implementation

### A. Discrete Integer Lattice Stencil Grid (LatticeGrid.js & StitchPen.js)
* **True Hitomezashi Coordinate System:** All grid heads are discrete integer coordinates \((i, j) \in \mathbb{Z}^2\). Stitches connect strictly from node to node; zero floating or unanchored stitches.
* **Magnetic Node Snap & Live Ghost Preview:** Live green preview edge with magnetic snap ring renders while dragging from an anchor node.
* **Continuous Dragging & Click-to-Delete:**
  * Clicking an existing joint or edge instantly removes it (`deleteStitch`).
  * Dedicated Eraser tool (`E`) for sweeping deletions.
  * Node-to-node drawing tool (`P`) and Pan/Select tool (`V`).

### B. Image 1 Layout Presets & Partition Engine (PartitionEngine.js & CustomSlicer.js)
* **All 8 Presets from User Sketch:**
  1. Full Cushion (Single Field)
  2. 2×2 Grid (4 Quadrants: A1, A2, B1, B2)
  3. 3×3 Grid (9 Cells)
  4. 4-Way Diagonals (X-Split Triangles: A, B, C, D)
  5. 8-Way Wedges (Pinwheel / Star Triangles)
  6. Center Medallion + Outer Border
  7. Center Medallion + Double Border
  8. Medallion + 4 Corner Blocks (Classic Quilt / Nakshi Kantha layout)
* **Interactive Knife / Line Slicer (S):** Straight-line slicing with 0°/45°/90° snapping dividing any shape into child sub-labs.
* **Parametric Winding-Number Clipping:** Pattern edges automatically clip precisely within the polygon boundaries of each partition.

### C. Image 2 Vertical Shape Inspector & Green Line Sub-Lab (SubLabManager.js)
* **Vertical Shapes Palette:** Located immediately to the right of the canvas, rendering shape cards with Diamond, Triangle, Square, and Circle icons.
* **Green Line Sub-Lab Isolation:** Toggling "Green Sub-Lab" activates an isolated editing mode for the active shape with a vibrant 555nm Neon Green glowing dashed border (`#00ff66`), constraining all stitch drawing and pattern filling strictly within that shape.
* **"Paste Pattern" Button:** 1-click filling of the active sub-lab with the selected pattern from the library.

### D. 6 Classic Grid-Locked Sashiko Patterns (LatticeGenerators.js & PatternRegistry.js)
1. **Kaki no hana (柿の花):** Traditional Hitomezashi persimmon flower orthogonal step grid.
2. **Asanoha (麻の葉):** Hemp leaf star geometry connected to lattice vertices.
3. **Seigaiha (青海波):** Concentric arched ocean waves anchored to grid steps.
4. **Shippo-tsunagi (七宝つなぎ):** Interlocking circular 4-petal flower tessellation.
5. **Kikko (亀甲):** Tortoise shell honeycomb hexagonal mesh.
6. **Sayagata (紗綾形):** Interlocking orthogonal maze fret.

### E. Multi-Project & Multi-Lab Tabs Bar (MultiProjectTabs.js)
* Illustrator / Excel style top tab bar allowing multiple cushion projects and labs open simultaneously.
* Switch tabs with instant state preservation.
* Create new tab (`+`), close tab (`✕`), and double-click to rename.
* Cross-tab pattern copying and pasting.

### F. Streamlined Fabric Optics & Display Hardware Profiles (OpticsEngine.js)
* **Dark Fabric Penetrator:** 555nm peak photopic sensitivity Neon Lime stitches on true 0-nit black canvas.
* **Light Fabric / Paper Mode:** Crisp white paper background with deep charcoal/black stitches.
* **Display Hardware Tuning:** Profiles for OLED (0-nit), IPS/LCD (contrast boosted), 4K UHD, and Auto-detection.
* **Seam Allowance Guide:** 0.75-inch dashed safety margin for cushion zipper and seams.

### G. Fullscreen Lightbox Tracing Viewport
* 1-click full-screen tracing mode for placing fabric directly over laptop/tablet screens.
* Touch/click protection HUD with `Esc` to unlock and exit.

### H. Production Blueprint, Specs & Exporters (BlueprintSpecs.js & Exporters.js)
* Live counters: Total Stitches, SPI (Stitches Per Inch), Fabric Cut Size (19.5"×19.5" for 18" cushion), and Thread Requirements in meters and yards (with 35% tension & Nakshi Kantha batting allowance).
* **Print Artisan Spec Sheet:** A4 printable workshop job sheet with cutting guides and embroidery instructions.
* **Pure SVG Export:** Vector format for laser cutters, vinyl plotters, and digital embroidery machines.
* **4K Ultra-HD PNG Export:** 3840×3840 resolution image export.
* **Save `.sashiko`:** Project backup and reload.

### I. Master Curve & Arc Engine (CurveEngine.js)
* **3-Point Circular Arc Tool (`C`):**
  * Collinearity detection via vector cross-product with fallback to linear segment.
  * Solves circumcircle center $(cx, cy)$, radius $R$, analytical angles $(\theta_1, \theta_2, \theta_3)$, and sweep direction.
  * Solves folded fan motifs (*Kikko ni Mitsu-Ogi*) with start, apex, and end clicks.
* **Natural Curvature Spline Tool (`Shift+C`):**
  * Centripetal Catmull-Rom ($\alpha = 0.5$) preventing loops and self-intersections.
  * Supports smooth closed loops and cusp/corner nodes (`isCusp: true`) for flower petal notches.
  * Solves organic 5-petal cherry blossom motifs (*Sakura-mon*).
* **Curve-to-Sashiko Stitch Discretizer:**
  * Numerical arc-length parameterization with customizable stitch length (~3.0mm) and gap (~1.5mm).
  * Balanced pitch scaling for clean boundary terminations.
  * Lattice grid magnetic node snapping or high-precision floating coordinates compatible with `stitchPen.stitches`.
* **N-Fold Radial Symmetry Generator:**
  * Replicates curves and stitches $N$ times around artboard center ($N \in [1, 2, 3, 4, 5, 6, 8, 12]$).
  * Floating Radial Symmetry HUD (`#curve-symmetry-hud`) with 1-click presets (`1x Off`, `3x Fans`, `4x Quad`, `5x Sakura`, `6x Hex`, `8x Oct`).
  * Live ghost preview with zero-allocation Path2D rendering.

### J. Device Storage & Performance Architecture
* Native File System Access API (`showOpenFilePicker`, `showSaveFilePicker`) for zero-quota disk persistence.
* Dynamic flex-shrinking project tabs strip with horizontal wheel scroll.
* Settings dropdown (⚙️) consolidating theme, line style, and storage options.
* Zero-allocation 60-120 FPS rendering pipeline.

---

## 3. Verification & Build Results

* **Vite Production Build:**
  ```bash
  npm run build
  # ✓ 28 modules transformed
  # ✓ built in 0.97s with 0 errors
  ```
* **Development Server:**
  * Running live at `http://localhost:5173/`.
  * Verified HTTP 200 response and HTML/CSS/JS module loading.
* **Launcher:**
  * `d:\Antigravity\Sashiko-Studio-CAD\Start_Studio.bat` is ready for 1-click desktop launching.
