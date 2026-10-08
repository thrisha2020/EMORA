#!/usr/bin/env python3
"""Report whether a GLB can actually drive Emora's avatar animation.

Emora needs three things the model must supply itself:
  - a skeleton, for head turn / eye tracking
  - eye-blink blendshapes
  - a jaw or viseme blendshape, for lipsync

A model missing these still renders, but every animation hook falls back to
scaling arbitrary primitives, which is what "the avatar looks wrong" means in
practice. Run this before wiring a new avatar in.

    python scripts/check_avatar.py emora-frontend/public/avatar.glb
"""

import json
import struct
import sys

# Names Emora's hooks look for, across the common exporter conventions.
BLINK = ("eyeblinkleft", "eyeblinkright", "eyeblink_l", "eyeblink_r",
         "fcl_eye_close", "fcl_eye_close_l", "fcl_eye_close_r", "blink")
JAW = ("jawopen", "mouthopen", "viseme_aa", "mouthfunnel",
       "fcl_mth_a", "fcl_mth_o", "fcl_mth_e")
HEAD = ("head", "neck", "mixamorighead")


def normalize(name: str) -> str:
    """Strip exporter prefixes: VRoid emits `Face_Blendshape.Fcl_EYE_Close_L`,
    Blender may emit `Mesh.001_eyeBlinkLeft`. Only the final segment matters."""
    return name.split(".")[-1].split("|")[-1].strip().lower()


def load(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        sys.exit(f"{path}: not a GLB (missing glTF magic)")
    _, _, _ = struct.unpack("<III", data[:12])
    off, gltf, bin_len = 12, None, 0
    while off < len(data):
        clen, _ = struct.unpack("<II", data[off : off + 8])
        tag = data[off + 4 : off + 8].decode(errors="replace").strip()
        if tag == "JSON":
            gltf = json.loads(data[off + 8 : off + 8 + clen])
        else:
            bin_len = max(bin_len, clen)
        off += 8 + clen
    return gltf, bin_len, len(data)


def target_names(gltf):
    names = []
    for mesh in gltf.get("meshes", []):
        extras = mesh.get("extras") or {}
        # Older UniGLTF puts names on the primitive; the frontend hoists them.
        prims = mesh.get("primitives") or [{}]
        names.extend(extras.get("targetNames") or (prims[0].get("extras") or {}).get("targetNames") or [])
    return names


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "emora-frontend/public/avatar.glb"
    gltf, bin_len, total = load(path)

    tris = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            idx = prim.get("indices")
            if idx is not None:
                tris += gltf["accessors"][idx]["count"] // 3

    node_names = [n.get("name", "") for n in gltf.get("nodes", [])]
    morphs = target_names(gltf)
    lower_nodes = [n.lower() for n in node_names]

    normalized = [normalize(m) for m in morphs]
    has_skin = bool(gltf.get("skins"))
    has_blink = any(b in normalized for b in BLINK)
    has_jaw = any(j in normalized for j in JAW)
    has_head = any(any(h in n for h in HEAD) for n in lower_nodes)

    print(f"{path}")
    print(f"  size        {total / 1024 / 1024:.2f} MB   triangles {tris:,}")
    print(f"  meshes {len(gltf.get('meshes', []))}  nodes {len(node_names)}  "
          f"materials {len(gltf.get('materials', []))}  textures {len(gltf.get('textures', []))}")
    print(f"  blendshapes {len(morphs)}")
    if morphs:
        print(f"    {', '.join(morphs[:12])}{' …' if len(morphs) > 12 else ''}")
    print()

    checks = [
        ("skeleton (head turn, eye tracking)", has_skin or has_head),
        ("eye-blink blendshapes", has_blink),
        ("jaw / viseme blendshape (lipsync)", has_jaw),
    ]
    for label, ok in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")

    warnings = []
    if tris > 150_000:
        warnings.append(f"{tris:,} triangles is heavy for a web canvas; aim under ~80k")
    if total > 15 * 1024 * 1024:
        warnings.append(f"{total / 1024 / 1024:.1f} MB will be slow to load; aim under ~10 MB")
    if warnings:
        print()
        for w in warnings:
            print(f"  WARN  {w}")

    failed = [label for label, ok in checks if not ok]
    if failed:
        print("\n  This model cannot drive Emora's animation hooks; they will fall")
        print("  back to scaling arbitrary meshes. A VRoid Studio avatar (free,")
        print("  vroid.com) exports a .vrm — which is glTF, so it loads directly —")
        print("  with blink, vowel visemes and whole-face emotion shapes.")
        return 1
    print("\n  Ready to use.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
