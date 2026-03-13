"""
NUT Express Mode Worker
=======================
A persistent HTTP server that loads the CANet model once at startup and handles
photo analysis requests without the per-request Python cold-start + model-load
overhead.  USDA nutrient lookups run in parallel (one thread per food item).

HIGH ACCURACY MODE (default)
  Node spawns a fresh Python process per request via nut_estimator.py.
  ~30-45 s per request.  Model loaded from disk every time.

EXPRESS MODE  (NUT_EXPRESS_MODE=true in server .env)
  Node POSTs to this worker.  Model stays in memory.
  ~3-8 s per request (first request after startup includes model load).
  USDA lookups run in parallel instead of sequentially.

── How to start ──────────────────────────────────────────────────────────────
Run alongside Node (same machine):

  /path/to/NUT_model/.venv/bin/python nut_server.py

Or with PM2 (add to ecosystem.config.js):
  {
    name: 'nut-worker',
    script: '/path/to/NUT_model/.venv/bin/python',
    args: '/path/to/NUT_model/nut_server.py',
    watch: false,
  }

── To revert to high accuracy mode ──────────────────────────────────────────
Remove NUT_EXPRESS_MODE=true from your .env (or set it to false).
You can leave this file in place — it only does anything when started.
─────────────────────────────────────────────────────────────────────────────
"""

import os
import sys

# ── venv bootstrap (mirrors nut_estimator.py) ─────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
_LOCAL_VENV_ROOT = os.path.join(SCRIPT_DIR, ".venv")
_LOCAL_VENV_PYTHON = os.path.join(SCRIPT_DIR, ".venv", "bin", "python")
_LOCAL_VENV_WINDOWS_PYTHON = os.path.join(SCRIPT_DIR, ".venv", "Scripts", "python.exe")


def _maybe_rerun_in_venv():
    import subprocess

    for candidate in (_LOCAL_VENV_PYTHON, _LOCAL_VENV_WINDOWS_PYTHON):
        if not os.path.exists(candidate):
            continue
        if os.path.abspath(sys.prefix) == os.path.abspath(_LOCAL_VENV_ROOT):
            return
        completed = subprocess.run([candidate, __file__, *sys.argv[1:]], check=False)
        raise SystemExit(completed.returncode)


_maybe_rerun_in_venv()
# ──────────────────────────────────────────────────────────────────────────────

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer

if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Import helpers from nut_estimator (model is NOT loaded here — see _startup()).
# The module-level bootstrap in nut_estimator runs, but since we're already in
# the correct venv at this point it returns immediately.
from NUT_model.nut_estimator import (  # noqa: E402
    DEFAULT_IMAGE_SIZE,
    DEFAULT_LABELS_PATH,
    DEFAULT_MODEL_PATH,
    DEFAULT_THICKNESS_MM,
    FALLBACK_MM_PER_PIXEL,
    MIN_SEGMENT_RATIO,
    detect_plate_scale,
    display_food_name,
    load_foodseg103_class_names,
    load_model,
    resolve_density,
    resolve_usda_query,
    round_or_none,
    run_segmentation,
    safe_float,
    scale_usda_nutrients,
    lookup_usda_nutrients,
)

import numpy as np  # noqa: E402
import requests as _requests  # noqa: E402
from PIL import Image  # noqa: E402

# ── global state ──────────────────────────────────────────────────────────────
_model = None
_class_names = None
# Persistent USDA cache shared across all requests.
# Key: lower-cased USDA query string.  Value: result dict from lookup_usda_nutrients.
_usda_cache: dict = {}
_usda_lock = threading.Lock()
# Thread pool for parallel USDA lookups (I/O-bound, so many workers are fine).
_usda_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="usda")
# Per-lookup timeout (seconds). Reduce to fail-fast when USDA API is slow.
_USDA_LOOKUP_TIMEOUT = float(os.environ.get("NUT_USDA_LOOKUP_TIMEOUT", "6"))
# ──────────────────────────────────────────────────────────────────────────────


def _startup(model_path: str, labels_path: str) -> None:
    global _model, _class_names
    print(f"[nut_server] Loading class names from {labels_path} ...", flush=True)
    _class_names = load_foodseg103_class_names(labels_path)
    print(f"[nut_server] Loading model from {model_path} ...", flush=True)
    _model = load_model(model_path)
    print("[nut_server] Model ready — accepting requests.", flush=True)


def _lookup_usda_cached(label: str) -> dict:
    """Thread-safe USDA lookup backed by the persistent in-memory cache."""
    query_key = resolve_usda_query(label).lower()
    with _usda_lock:
        if query_key in _usda_cache:
            return _usda_cache[query_key]
    # Fetch outside the lock so other threads are not blocked during the HTTP call.
    session = _requests.Session()
    result = lookup_usda_nutrients(label, session, {})
    with _usda_lock:
        _usda_cache[query_key] = result
    return result


def _lookup_usda_parallel(labels: list) -> dict:
    """Submit one USDA lookup per label concurrently; return {label: result}."""
    futures = {_usda_executor.submit(_lookup_usda_cached, label): label for label in labels}
    results = {}
    for future, label in futures.items():
        try:
            results[label] = future.result(timeout=_USDA_LOOKUP_TIMEOUT)
        except Exception:
            results[label] = {"found": False, "query": resolve_usda_query(label)}
    return results


def _run_analysis(body: dict) -> dict:
    image_path = body["imagePath"]
    image_size = int(body.get("imageSize", DEFAULT_IMAGE_SIZE))
    thickness_mm = float(body.get("thicknessMm", DEFAULT_THICKNESS_MM))

    pil_img = Image.open(image_path).convert("RGB")
    original_rgb = np.array(pil_img)

    plate = detect_plate_scale(original_rgb)
    mm_per_pixel = safe_float(plate.get("mmPerPixel")) or FALLBACK_MM_PER_PIXEL

    pred_mask, seg_probs = run_segmentation(_model, pil_img, image_size)
    total_pixels = int(pred_mask.size)
    threshold = total_pixels * MIN_SEGMENT_RATIO

    unique_ids, counts = np.unique(pred_mask, return_counts=True)
    significant = []
    for class_id, pixel_count in zip(unique_ids, counts):
        if int(class_id) == 0 or int(pixel_count) <= threshold:
            continue
        significant.append((int(class_id), int(pixel_count)))
    significant.sort(key=lambda e: e[1], reverse=True)

    # ── parallel USDA lookups (key speedup vs sequential in nut_estimator) ────
    labels = [_class_names.get(cid, "default") for cid, _ in significant]
    usda_map = _lookup_usda_parallel(labels)
    # ──────────────────────────────────────────────────────────────────────────

    items = []
    for (class_id, pixel_count), label in zip(significant, labels):
        class_mask = pred_mask == class_id
        density = resolve_density(label)
        area_ratio = pixel_count / total_pixels if total_pixels else 0.0
        mean_confidence = (
            float(seg_probs[class_id][class_mask].mean()) if np.any(class_mask) else None
        )

        area_mm2 = pixel_count * (mm_per_pixel**2)
        volume_mm3 = area_mm2 * thickness_mm
        volume_cm3 = volume_mm3 / 1000.0
        mass_g = volume_cm3 * density

        usda = usda_map.get(label, {"found": False, "query": label})
        scaled = scale_usda_nutrients(usda, mass_g)
        item_name = display_food_name(label)

        items.append(
            {
                "classId": class_id,
                "name": item_name,
                "lookupQuery": usda.get("query"),
                "confidence": round_or_none(mean_confidence, 4),
                "portionPercent": round_or_none(area_ratio * 100.0, 2),
                "pixelCount": pixel_count,
                "massG": round_or_none(mass_g, 2),
                "weightAmount": round_or_none(mass_g, 2),
                "weightUnit": "g",
                "density": round_or_none(density, 4),
                "calories": scaled.get("calories"),
                "protein": scaled.get("protein"),
                "carbs": scaled.get("carbs"),
                "fats": scaled.get("fats"),
                "fiber": scaled.get("fiber"),
                "caloriesPer100g": usda.get("caloriesPer100g"),
                "proteinPer100g": usda.get("proteinPer100g"),
                "carbsPer100g": usda.get("carbsPer100g"),
                "fatsPer100g": usda.get("fatsPer100g"),
                "fiberPer100g": usda.get("fiberPer100g"),
            }
        )

    dominant = items[0] if items else {}
    total_calories = sum(safe_float(i.get("calories")) or 0.0 for i in items)
    total_protein = sum(safe_float(i.get("protein")) or 0.0 for i in items)
    total_carbs = sum(safe_float(i.get("carbs")) or 0.0 for i in items)
    total_fats = sum(safe_float(i.get("fats")) or 0.0 for i in items)
    total_fiber = sum(safe_float(i.get("fiber")) or 0.0 for i in items)
    total_weight = sum(safe_float(i.get("weightAmount")) or 0.0 for i in items)
    food_count = len(items)
    is_reliable = food_count > 0

    return {
        "name": dominant.get("name", ""),
        "confidence": dominant.get("confidence"),
        "isReliable": is_reliable,
        "reliabilityThreshold": 0.0 if is_reliable else MIN_SEGMENT_RATIO,
        "reliabilityReason": (
            None if is_reliable else "No food segments passed the minimum area threshold."
        ),
        "calories": round_or_none(total_calories, 0),
        "protein": round_or_none(total_protein, 1),
        "carbs": round_or_none(total_carbs, 1),
        "fats": round_or_none(total_fats, 1),
        "fiber": round_or_none(total_fiber, 1),
        "weightAmount": round_or_none(total_weight, 1),
        "weightUnit": "g",
        "topMatches": [
            {"name": i["name"], "confidence": i["confidence"]} for i in items[:5]
        ],
        "detectedFoods": [
            {
                "name": i["name"],
                "confidence": i["confidence"],
                "portionPercent": i["portionPercent"],
                "calories": i["calories"],
                "protein": i["protein"],
                "carbs": i["carbs"],
                "fats": i["fats"],
                "fiber": i["fiber"],
                "weightAmount": i["weightAmount"],
                "weightUnit": i["weightUnit"],
            }
            for i in items[:8]
        ],
        "mealAnalysis": {
            "foodCount": food_count,
            "totalCalories": round_or_none(total_calories, 2),
            "totalProtein": round_or_none(total_protein, 2),
            "totalCarbs": round_or_none(total_carbs, 2),
            "totalFats": round_or_none(total_fats, 2),
            "totalFiber": round_or_none(total_fiber, 2),
            "totalWeightAmount": round_or_none(total_weight, 2),
            "weightUnit": "g",
            "plateDetected": bool(plate.get("plateDetected")),
            "plateDiameterPx": plate.get("plateDiameterPx"),
            "mmPerPixel": round_or_none(mm_per_pixel, 4),
            "items": items,
        },
    }


# ── HTTP server ───────────────────────────────────────────────────────────────


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._respond(
                200,
                {
                    "status": "ok",
                    "mode": "express",
                    "modelLoaded": _model is not None,
                    "usdaCacheSize": len(_usda_cache),
                },
            )
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/analyze":
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length))
                result = _run_analysis(body)
                self._respond(200, result)
            except Exception as exc:
                self._respond(500, {"error": str(exc)})
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):  # suppress default Apache-style access log
        pass


# ── entry point ───────────────────────────────────────────────────────────────


def main():
    import argparse

    parser = argparse.ArgumentParser(description="NUT express mode worker")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("NUT_EXPRESS_PORT", "8001")),
        help="Port to listen on (default: 8001)",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL_PATH,
        help="Path to canet_NUT.pth weights",
    )
    parser.add_argument(
        "--labels",
        default=DEFAULT_LABELS_PATH,
        help="Path to FoodSeg103 category_id.txt",
    )
    args = parser.parse_args()

    _startup(args.model, args.labels)

    server = HTTPServer(("127.0.0.1", args.port), _Handler)
    server.allow_reuse_address = True
    print(f"[nut_server] Listening on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[nut_server] Shutting down.", flush=True)
    finally:
        _usda_executor.shutdown(wait=False)


if __name__ == "__main__":
    main()
