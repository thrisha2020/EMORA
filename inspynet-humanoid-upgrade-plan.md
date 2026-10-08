# Inspynet Humanoid AI Visual Upgrade Plan

## Top-Level Overview

The user's goal is to replace the current Canvas 2D drawn humanoid in `frontend/components/ai_core.py` with a significantly more premium, visually convincing portrait that communicates photorealistic CGI quality — not programmer-drawn shapes.

The existing component is a well-structured Canvas 2D render loop that draws geometric approximations of a human face (bezier curves for face outline, ellipses for eyes, etc.). While functional and animated, it reads as "hand-coded" rather than "photorealistic CGI". The upgrade must stay within the same Streamlit inline CCv2 component architecture (no backend changes, no new Python packages, no Three.js/WebGL library CDN loads blocked by CSP).

The solution is a **deep rewrite of the JavaScript drawing layer** inside `_JS` in `ai_core.py`, upgrading every visual subsystem — face anatomy, skin shading, hair, eyes, environment, lighting — to the maximum fidelity achievable in Canvas 2D using advanced techniques: layered radial gradients, multi-pass compositing, photorealistic skin subsurface scattering simulation, detailed iris rendering, realistic hair strand groups, and a richer cybersecurity environment (more HUD rings, data particles, holographic depth layers). The component Python API (`ai_core()` function signature) stays 100% unchanged so no call sites need updating.

**Scope:** `frontend/components/ai_core.py` only — JS rewrite inside `_JS` string.  
**No changes to:** `views/`, `hud.py`, `app.py`, `theme.css`, backend, or any other file.

---

## Sub-Tasks

---

### Sub-Task 1 — Face Anatomy & Skin Shading Overhaul

**Intent**  
The current face is a single linear gradient fill on a bezier oval. Real skin is not flat — it has warm/cool variation zones, subsurface scatter (reddish/orange glow where skin is thin like ears, nose bridge, lips), specular highlights (forehead, nose tip, cheekbones), and contact shadows (under brows, nasolabial folds, under chin). This sub-task rebuilds the head from scratch with layered radial and linear gradients that simulate these photographic qualities.

**Expected Outcomes**
- Face reads as lit by a cool (cyan) key light from the front and a warm fill from slightly below
- Subtle orange-pink subsurface tint on cheeks, nose bridge, and temples
- Soft contact shadows under the brow ridge, along the nasolabial creases, and under the chin
- Forehead specular highlight is convincing and not "painted on"
- Overall face feels 3D and lit, not flat

**Todo List**
1. Replace single `createLinearGradient` skin fill with a base radial gradient from face-center outward (warm center → cooler edges)
2. Add a second pass: subsurface scatter layer — soft radial `rgba(220,130,100,0.18)` centered over cheeks and nose bridge, composited with `source-atop` clipped to face path
3. Add specular highlight pass: tight radial gradient on upper forehead and nose tip (`rgba(255,248,240,0.35)`)
4. Add shadow pass for brow ridge (top of eye socket), nasolabial region, and chin-jaw transition using soft elongated radials at low opacity
5. Keep cinematic cyan rim light on the left edge of the face (simulating edge lighting from cybersecurity screens)
6. Ensure all layers are clipped to `facePath()` except the rim light

**Relevant Context**
- [`drawHead()`](frontend/components/ai_core.py:260) — current head drawing function to fully replace
- [`facePath()`](frontend/components/ai_core.py:118) — bezier face outline, reuse as-is (shape is fine)
- Skin constants `SKIN_HI`, `SKIN_MID`, `SKIN_LO`, `SKIN_SHADOW` — upgrade to richer palette (add subsurface warm tone)

**Status:** [ ] pending

---

### Sub-Task 2 — Eye & Brow Realism Upgrade

**Intent**  
The current eyes use a single radial gradient iris with a pupil ellipse and two specular dots. Real photorealistic eyes have: a dark limbal ring at the iris edge, depth in the iris (layered gradients to simulate corneal depth), a more convincing lower sclera shadow, subtle redness at inner/outer canthi, eyelid skin that wraps around the eye, thicker lash definition, and an under-eye shadow. This sub-task upgrades the eye rendering to achieve near-CGI quality.

**Expected Outcomes**
- Iris has three depth layers: limbal ring → colored iris fibres (radial lines pattern via multiple thin radial fills) → bright inner ring → pupil
- Specular reflections are more complex: one large diffuse corneal glint + one sharp pinpoint
- Eyelid crease is more defined with a proper eyelid fold shadow
- Lashes are multi-stroke (not just one ellipse stroke) — several individual curved lash strokes
- Brow is thicker, feathered (multiple semi-transparent strokes of varying width), with a slight arch that conveys calm intelligence
- Inner canthus (tear duct) has a pink/flesh tint
- Under-eye has a subtle shadow that adds 3D depth

**Todo List**
1. Rewrite `drawEye()` — add limbal ring as a dark annular gradient at iris perimeter
2. Add simulated iris fibre texture: 8–12 thin radial gradient "spokes" from iris center outward at very low opacity
3. Add bright iris inner ring (lighter zone around the pupil border)
4. Upgrade specular: large soft corneal glint (elliptical, tilted) + small sharp pinpoint separate
5. Add inner canthus: small flesh/pink filled ellipse at inner eye corner
6. Rewrite eyelid rendering: upper lid has a layered shadow (two passes — eyelid skin fold above lashline, crease shadow above that)
7. Replace single lash-stroke with 5–7 individual curved lash strokes per eye, varying length and angle
8. Rewrite `drawBrows()` — 3 overlapping strokes of varying opacity and width; slight arch shape

**Relevant Context**
- [`drawEye()`](frontend/components/ai_core.py:323) — full replacement
- [`drawBrows()`](frontend/components/ai_core.py:391) — full replacement
- Eye position calculations in [`frame()`](frontend/components/ai_core.py:563) — `eyeY`, `eyeDX`, `eyeW` — keep these same so eyes stay in correct position

**Status:** [ ] pending

---

### Sub-Task 3 — Hair Rendering Upgrade

**Intent**  
Current hair is two dark filled bezier shapes with a single gradient sheen. Realistic hair requires multiple overlapping strand groups with directional highlights, gradient transitions from root to tip, strand-level specular, and depth variation. The upgrade uses a multi-layer approach: base dark fill → midtone gradient → multiple thin highlight strokes representing hair group reflections.

**Expected Outcomes**
- Hair reads as sleek, dark, straight (or slightly swept) — fitting the cyberpunk intelligence aesthetic
- Two or three visible highlight bands (the classic double-specular on dark hair)
- Hair falls naturally around the face and onto the shoulders
- Edge of hair against the background is soft, not a hard bezier line

**Todo List**
1. Keep the same base bezier shapes for `drawHairBack()` and `drawHairFront()` (they correctly frame the face)
2. Add a second hair base layer in dark graphite (`rgb(22,18,22)`) slightly wider than the first, for soft edge
3. Replace the single sheen gradient with two highlight bands: primary (thin, bright, near the crown) and secondary (wider, softer, mid-section) — both using linear gradients aligned to the hair direction
4. Add 6–8 individual "strand highlight" strokes in `drawHairFront()`: thin bezier curves following the hair direction, `rgba(160,140,160,0.25)` at varying opacity
5. Soften the hair-background edge by drawing a narrow blurred shadow (feather effect via several near-transparent wide strokes) just outside the hair outline

**Relevant Context**
- [`drawHairBack()`](frontend/components/ai_core.py:237) — add layers
- [`drawHairFront()`](frontend/components/ai_core.py:491) — add strand strokes

**Status:** [ ] pending

---

### Sub-Task 4 — Suit & Collar Premium Redesign

**Intent**  
The current suit is a simple trapezoid fill with two V-lines and two dots for the collar. A premium dark metallic suit with cybernetic elements needs: a more anatomically shaped body silhouette (shoulder curves, not a flat trapezoid), multi-layer metallic shading on the shoulders, a proper high collar that wraps up behind the neck, multiple cyan circuit seams on the chest panel, and glowing LED-like accent nodes at the collar tips and chest center.

**Expected Outcomes**
- Shoulder silhouette is gently curved — reads as a structured futuristic jacket
- Metallic shading on shoulders uses a three-stop gradient (highlight → midtone → deep shadow) to simulate a slightly convex surface
- High collar rises behind the character's jawline with a thin glowing inner edge
- Two or three thin parallel cyan seams on the chest panel
- Three or four glowing stud nodes on the collar seams with soft glow halos

**Todo List**
1. Replace the flat trapezoid in `drawSuit()` with a body shape using bezier curves: slightly curved shoulder lines, narrower at neck, widening at the bottom of frame
2. Add a metallic highlight pass on each shoulder: tight linear gradient from light graphite at the top edge to dark at center mass
3. Draw the high collar as a separate shape: a curved form rising from both sides of the neck to just below the jaw, filled with suit color plus an inner glowing rim stroke
4. Replace two V-seam lines with three parallel seams — slightly narrower separation, more circuit-like, with small connector nodes at intersections
5. Draw 4 glowing stud nodes along the collar with radial glow halos (`rgba(0,220,255,0.8)` core, outer glow)
6. Add a chest center detail: small hexagonal or diamond panel shape with cyan outline and inner glow

**Relevant Context**
- [`drawSuit()`](frontend/components/ai_core.py:194) — full replacement

**Status:** [ ] pending

---

### Sub-Task 5 — Environment & HUD Depth Upgrade

**Intent**  
The current background is good conceptually (dark navy + nodes + dust) but lacks depth layers and premium feel. The upgrade adds: a foreground depth vignette (darkening edges strongly), a mid-ground data-lattice grid at perspective, more varied node types (larger hub nodes vs smaller relay nodes), richer threat indicator rings, additional HUD elements (tick marks on the outer ring, data readout lines radiating from the character, a secondary inner ring), and a subtle holographic depth haze around the face.

**Expected Outcomes**  
- Background has clear near/mid/far depth — not just floating dots on black
- HUD outer ring has evenly-spaced tick marks (like a targeting reticle)
- Two concentric HUD rings (outer larger, inner tighter around the face)
- Node network has 3 sizes of nodes: hub (larger, brighter), relay (medium), sensor (tiny)
- Threat nodes have a double-ripple ring animation
- Faint perspective grid lines (very dark) in the lower background create ground plane depth
- Holographic face-halo is more distinct — uses a soft edge-only ring glow rather than a flat radial fill

**Todo List**
1. In `drawBackdrop()`, add a perspective grid: 6–8 horizontal lines and 5–6 vanishing-point lines from center-bottom, all `rgba(0,212,255,0.04)`, drawn before nodes
2. Upgrade node spawn to include `size: "hub" | "relay" | "sensor"` classification (10% hub, 30% relay, 60% sensor), with different radii and brightness levels
3. Upgrade threat node animation: draw two expanding ripple rings (one at 0 phase, one at 0.5 phase offset) for a double-ring pulse effect
4. In `drawHUD()`, add tick marks on the outer HUD ring: 48 short radial lines evenly spaced, alternating long/short like a clock face, `rgba(0,212,255,0.25)`
5. Add a second inner HUD ring at `u * 0.38` with slightly different opacity and a dashed stroke (every π/24 segment alternating draw/skip)
6. Replace the flat halo radial fill behind the face with a ring-shaped glow: two concentric arcs filled with a narrow annular gradient
7. Add strong edge vignette: after all drawing, fill a radial gradient `rgba(0,0,0,0)` center → `rgba(2,4,10,0.85)` at edges as a final overlay pass

**Relevant Context**
- [`drawBackdrop()`](frontend/components/ai_core.py:129) — extend with grid + upgraded nodes
- [`drawHUD()`](frontend/components/ai_core.py:526) — add tick marks, second ring, replace halo
- Node spawn in [`spawn()`](frontend/components/ai_core.py:84) — add size classification

**Status:** [ ] pending

---

### Sub-Task 6 — Cybernetic Element Enhancement & Nose Realism

**Intent**  
The current cybernetic overlay (temple modules + faint cheek lines) is minimal. The upgrade adds more detailed circuitry: branching circuit lines on the temples that terminate in micro-node dots, a subtle data-stream visual on the cheekbones (very faint vertical scan lines or stipple pattern), enhanced ear/temple modules with a concentric ring detail, and a faint holographic data readout floating to one side of the face. Also improve the nose, which currently renders very faint.

**Expected Outcomes**
- Temple modules have an outer concentric ring + inner bright dot, reads as an active sensor implant
- Circuit lines on temples are slightly more branched (main stem + 2 short branches per side)
- Nose has clear bridge definition with realistic nostril shadow depth and a tip highlight that reads correctly at the component's display size
- A faint vertical scan line passes over the face occasionally (every ~6 seconds), with a very subtle cyan tint — adds the "being scanned" effect

**Todo List**
1. Rewrite `drawCyber()` temple module: outer ring (stroke), middle ring (fill at low opacity), inner bright dot — 3 layers per module
2. Add branching to cheek/temple circuit lines: from the main bezier stroke, add 2 short sub-strokes that fork off at the terminal end
3. Upgrade `drawNose()`: increase nose bridge line weight slightly, add a stronger shadow on the underside of the nose tip, add a second nostril ellipse highlight on the underside of each nostril
4. Add face scan effect in `frame()`: a horizontal scan line that moves from top to bottom of the face every 6 seconds, very low opacity cyan fill (`rgba(0,220,255,0.04)`) in a 4px tall strip — clip to face path
5. Add a faint data readout element: 3–4 short horizontal lines of varying width to the left of the face, as if text data is being displayed, `rgba(0,212,255,0.18)`

**Relevant Context**
- [`drawCyber()`](frontend/components/ai_core.py:462) — rewrite
- [`drawNose()`](frontend/components/ai_core.py:403) — upgrade
- [`frame()`](frontend/components/ai_core.py:563) — add scan time tracker

**Status:** [ ] pending

---

## Implementation Notes

- All work is confined to the `_JS` string in `frontend/components/ai_core.py`
- The Python `ai_core()` function signature and `_CORE` registration are untouched
- Sub-tasks 1–6 should be applied together in one agent pass since they're all in the same JS string
- After implementation, visually validate by running the Streamlit app and checking the dashboard view
- The component renders at ~420×460px logical pixels — all detail should be visible at that resolution
- DPR scaling is already handled (`dpr = Math.min(devicePixelRatio, 2)`) — no change needed

## Files Changed

| File | Change Type |
|------|-------------|
| `frontend/components/ai_core.py` | JS rewrite — `_JS` string only |
