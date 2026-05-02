"""CLI for current-window BGL 3-zone inference."""

from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier

# pyPPG 1.0.73 expects legacy pandas/numpy behavior that changed in newer runtimes.
if not hasattr(np, "NaN"):
    np.NaN = np.nan
if not hasattr(np, "trapz") and hasattr(np, "trapezoid"):
    np.trapz = np.trapezoid
if hasattr(pd, "options") and hasattr(pd.options, "mode"):
    try:
        pd.options.mode.chained_assignment = None
    except Exception:
        pass
try:
    warnings.filterwarnings("ignore", category=pd.errors.ChainedAssignmentError)
except Exception:
    pass


DEFAULT_MODEL_DIR = Path("models/bgl_catboost_current_ppg_demo_no_preop")
DEFAULT_FS = 500
DEFAULT_WINDOW_SECONDS = 900
BANDPASS_LOW = 0.5
BANDPASS_HIGH = 8.0
BANDPASS_ORDER = 4
CLASS_LABELS = ["low", "elevated", "hyper"]
FORBIDDEN_DEMOGRAPHIC_KEYS = {
    "demo_preop_gluc",
    "preop_gluc",
    "glucose",
    "glucose_mgdl",
}
DEMOGRAPHIC_ALIASES = {
    "age": "demo_age",
    "sex": "demo_sex",
    "bmi": "demo_bmi",
    "preop_dm": "demo_preop_dm",
    "preop_hb": "demo_preop_hb",
    "preop_cr": "demo_preop_cr",
}
REQUIRED_DEMOGRAPHICS = {
    "demo_age",
    "demo_sex",
    "demo_bmi",
    "demo_preop_dm",
}
OPTIONAL_DEMOGRAPHICS = {
    "demo_preop_hb",
    "demo_preop_cr",
}


class InferenceError(RuntimeError):
    """Raised for user-facing inference failures."""


@dataclass
class ModelBundle:
    model: CatBoostClassifier
    final_features: list[str]
    metadata: dict[str, Any]
    schema: dict[str, Any]
    model_dir: Path


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc


def _read_feature_list(path: Path) -> list[str]:
    features = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    features = [feature for feature in features if feature]
    if not features:
        raise ValueError(f"No features found in {path}")
    duplicates = sorted({feature for feature in features if features.count(feature) > 1})
    if duplicates:
        raise ValueError(f"Duplicate final feature(s) in {path}: {duplicates}")
    forbidden = [feature for feature in features if _is_forbidden_feature(feature)]
    if forbidden:
        raise ValueError(f"Model bundle contains excluded feature(s): {forbidden}")
    return features


def _is_lag_feature(feature: str) -> bool:
    return feature.startswith("lag_") or feature.startswith("lag15m_") or "lag" in feature.lower()


def _is_forbidden_feature(feature: str) -> bool:
    return feature == "demo_preop_gluc" or _is_lag_feature(feature)


def load_model_bundle(model_dir: Path) -> ModelBundle:
    """Load CatBoost model, final feature order, metadata, and schema."""
    model_dir = Path(model_dir)
    model_path = model_dir / "catboost_model.cbm"
    features_path = model_dir / "final_features.txt"
    metadata_path = model_dir / "model_metadata.json"
    schema_path = model_dir / "training_schema.json"

    missing = [
        path
        for path in [model_path, features_path, metadata_path, schema_path]
        if not path.exists()
    ]
    if missing:
        raise FileNotFoundError(f"Model bundle is missing required file(s): {missing}")

    final_features = _read_feature_list(features_path)
    metadata = _read_json(metadata_path)
    schema = _read_json(schema_path)

    model = CatBoostClassifier()
    model.load_model(str(model_path))
    return ModelBundle(
        model=model,
        final_features=final_features,
        metadata=metadata,
        schema=schema,
        model_dir=model_dir,
    )


def load_signal(signal_path: Path) -> np.ndarray:
    """Load a .npy PPG window and return a 1D float array."""
    arr = np.load(Path(signal_path), allow_pickle=False)
    if arr.ndim == 1:
        flat = arr
    elif arr.ndim == 2 and 1 in arr.shape:
        flat = arr.reshape(-1)
    else:
        raise ValueError(
            "Signal must be 1D, or shape (N, 1)/(1, N); "
            f"got shape {arr.shape}."
        )

    try:
        signal = np.asarray(flat, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError("Signal array must be numeric.") from exc

    if signal.size == 0:
        raise ValueError("Signal array is empty.")
    return signal


def validate_signal(
    signal: np.ndarray,
    fs: int,
    expected_seconds: int = DEFAULT_WINDOW_SECONDS,
    strict_length: bool = True,
) -> None:
    """Validate signal dimensionality and, by default, exact 15-minute length."""
    sig = np.asarray(signal)
    if sig.ndim != 1:
        raise ValueError(f"Signal must be 1D after loading; got shape {sig.shape}.")
    if fs <= 0:
        raise ValueError("Sampling rate must be positive.")
    expected_samples = int(round(expected_seconds * fs))
    if strict_length and sig.size != expected_samples:
        raise ValueError(
            f"Expected {expected_samples} samples for {expected_seconds}s at {fs} Hz; "
            f"got {sig.size}."
        )


def load_demographics(json_path: Path) -> dict:
    raw = _read_json(Path(json_path))
    if not isinstance(raw, dict):
        raise ValueError("Demographics JSON must contain an object.")
    return raw


def _schema_dtype(schema: dict | None, feature: str) -> str | None:
    if not schema:
        return None
    for item in schema.get("features", []):
        if item.get("name") == feature:
            return str(item.get("dtype"))
    return None


def _numeric_value(value: Any, field: str) -> float:
    if value is None:
        return math.nan
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric; got {value!r}.") from exc


def _normalize_sex(value: Any, dtype: str | None = None) -> float | int:
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"m", "male"}:
            return 1
        if token in {"f", "female"}:
            return 0
        try:
            numeric = float(token)
        except ValueError as exc:
            raise ValueError(f"demo_sex must be M/F, male/female, or numeric 0/1; got {value!r}.") from exc
    else:
        numeric = float(value)

    if numeric not in {0.0, 1.0}:
        raise ValueError(f"demo_sex must encode female=0 or male=1; got {value!r}.")
    return int(numeric) if dtype and dtype.startswith("int") else numeric


def _normalize_binary(value: Any, field: str, dtype: str | None = None) -> float | int:
    if isinstance(value, bool):
        numeric = 1.0 if value else 0.0
    elif isinstance(value, str):
        token = value.strip().lower()
        if token in {"yes", "y", "true", "t", "1"}:
            numeric = 1.0
        elif token in {"no", "n", "false", "f", "0"}:
            numeric = 0.0
        else:
            try:
                numeric = float(token)
            except ValueError as exc:
                raise ValueError(f"{field} must be boolean-like or numeric 0/1; got {value!r}.") from exc
    else:
        numeric = float(value)

    if numeric not in {0.0, 1.0}:
        raise ValueError(f"{field} must be 0/1 or boolean-like; got {value!r}.")
    return int(numeric) if dtype and dtype.startswith("int") else numeric


def normalize_demographics(
    raw: dict,
    final_features: list[str],
    schema: dict | None = None,
) -> dict:
    """Normalize demographics to deployment model feature names and encodings."""
    supplied_forbidden = sorted(FORBIDDEN_DEMOGRAPHIC_KEYS.intersection(raw))
    if supplied_forbidden:
        raise ValueError(
            "Preoperative/measured glucose is excluded from the deployment model; "
            f"remove key(s): {supplied_forbidden}."
        )

    canonical: dict[str, Any] = {}
    for key, value in raw.items():
        target = DEMOGRAPHIC_ALIASES.get(key, key)
        if target.startswith("demo_"):
            canonical[target] = value

    missing = sorted(field for field in REQUIRED_DEMOGRAPHICS if field not in canonical)
    if missing:
        raise ValueError(f"Missing required demographic field(s): {missing}")

    result: dict[str, float | int] = {}
    for feature in final_features:
        if not feature.startswith("demo_"):
            continue
        dtype = _schema_dtype(schema, feature)
        if feature == "demo_sex":
            result[feature] = _normalize_sex(canonical[feature], dtype)
        elif feature == "demo_preop_dm":
            result[feature] = _normalize_binary(canonical[feature], feature, dtype)
        elif feature in OPTIONAL_DEMOGRAPHICS and feature not in canonical:
            result[feature] = math.nan
        elif feature in canonical:
            result[feature] = _numeric_value(canonical[feature], feature)
        else:
            raise ValueError(f"Missing required demographic field: {feature}")
    return result


def _extract_biomarkers_from_array(signal: np.ndarray, fs: int, name: str) -> dict | None:
    """Run the same pyPPG biomarker summarisation on an in-memory subwindow."""
    try:
        from pyPPG import Fiducials, PPG
        import pyPPG.biomarkers as BM
        import pyPPG.fiducials as FP

        from src.b_features._pyppg_helpers import build_pyppg_signal
        from src.b_features.pyppg_features import (
            _capture_stdout,
            _summarise_subwindow_biomarkers,
        )

        pyppg_signal = build_pyppg_signal(np.asarray(signal, dtype=float), int(fs), name, False)
        s = PPG(s=pyppg_signal, check_ppg_len=False)

        fpex = FP.FpCollection(s=s)
        fiducials = _capture_stdout(fpex.get_fiducials, s=s)
        fp = Fiducials(fp=fiducials)

        bmex = BM.BmCollection(s=s, fp=fp)
        bm_defs, bm_vals, bm_stats = _capture_stdout(bmex.get_biomarkers)
        biomarkers = _summarise_subwindow_biomarkers(bm_defs, bm_vals, bm_stats)
        return biomarkers or None
    except Exception:
        return None


def extract_features_from_signal(signal: np.ndarray, fs: int) -> tuple[dict, dict]:
    """Extract current-window features and quality metadata fully in memory."""
    from src.a_preprocessing.preprocess import bandpass_filter, fill_missing_samples
    from src.b_features.emd_imf import extract_emd_features
    from src.b_features.prv_from_tpp import aggregate_segment as aggregate_prv_segment
    from src.b_features.prv_from_tpp import compute_prv_features
    from src.b_features.pyppg_features import aggregate_segment as aggregate_pyppg_segment
    from src.b_features.subwindows import (
        DEFAULT_OVERLAP_SEC,
        DEFAULT_SUBWINDOW_SEC,
        extract_subwindows_from_segment,
        subwindow_starts,
    )
    from src.b_features.summary_stats import extract_summary_features

    filled = fill_missing_samples(signal)
    if filled is None:
        raise InferenceError("Signal contains no finite samples.")

    filtered = bandpass_filter(
        filled,
        BANDPASS_LOW,
        BANDPASS_HIGH,
        int(fs),
        BANDPASS_ORDER,
    )

    starts = subwindow_starts(
        len(filtered),
        int(fs),
        DEFAULT_SUBWINDOW_SEC,
        DEFAULT_OVERLAP_SEC,
    )
    subwindows = extract_subwindows_from_segment(filtered, int(fs))
    sqi_values = [float(row["sqi"]) for row in subwindows if np.isfinite(row.get("sqi", np.nan))]
    quality = {
        "n_subwindows_attempted": int(starts.size),
        "n_subwindows_used": int(len(subwindows)),
        "mean_sqi": float(np.mean(sqi_values)) if sqi_values else None,
        "min_sqi": float(np.min(sqi_values)) if sqi_values else None,
    }
    if not subwindows:
        raise InferenceError("No clean SQI-gated subwindows survived feature extraction.")

    features: dict[str, Any] = {}
    features.update(extract_summary_features(filtered, int(fs), "w15m"))
    features.update(extract_emd_features(filtered, int(fs), "w15m", max_imfs=7))

    biomarker_rows: list[dict[str, Any]] = []
    prv_rows: list[dict[str, Any]] = []
    biomarker_failures = 0
    for subwindow in subwindows:
        base = {
            "sid": 0,
            "glucose_time_sec": DEFAULT_WINDOW_SECONDS,
            "glucose_mgdl": math.nan,
            "window_type": "current",
            "subwin_idx": int(subwindow["subwin_idx"]),
            "subwin_start_sec": float(subwindow["subwin_start_sec"]),
            "npz_path": "",
        }

        biomarkers = _extract_biomarkers_from_array(
            np.asarray(subwindow["signal"], dtype=float),
            int(fs),
            f"inference_current_{subwindow['subwin_idx']}",
        )
        if biomarkers is None:
            biomarker_failures += 1
        else:
            row = dict(base)
            row.update(biomarkers)
            biomarker_rows.append(row)

        prv_row = dict(base)
        prv_row.update(compute_prv_features(np.asarray(subwindow["tpp"], dtype=float), int(fs)))
        prv_rows.append(prv_row)

    quality["n_biomarker_subwindows_used"] = int(len(biomarker_rows))
    if biomarker_failures:
        quality["n_biomarker_subwindows_failed"] = int(biomarker_failures)
    if not biomarker_rows:
        raise InferenceError("No clean subwindows produced pyPPG biomarker features.")

    features.update(aggregate_pyppg_segment(pd.DataFrame(biomarker_rows), "current"))
    features.update(aggregate_prv_segment(pd.DataFrame(prv_rows), "current"))
    return features, quality


def assemble_feature_row(
    signal_features: dict,
    demographics: dict,
    final_features: list[str],
) -> pd.DataFrame:
    combined = dict(signal_features)
    combined.update(demographics)
    missing = [feature for feature in final_features if feature not in combined]
    if missing:
        raise ValueError(f"Missing required final feature(s): {missing}")
    row = {feature: combined[feature] for feature in final_features}
    return pd.DataFrame([row], columns=final_features)


def _prediction_payload(
    *,
    bundle: ModelBundle,
    signal_path: Path,
    demographics_path: Path,
    fs: int,
    signal: np.ndarray,
    probabilities: np.ndarray,
    quality: dict,
    warnings: list[str],
) -> dict:
    labels = list(bundle.metadata.get("class_labels") or CLASS_LABELS)
    probs = np.asarray(probabilities, dtype=float).ravel()
    if probs.size != len(labels):
        raise InferenceError(
            f"Model returned {probs.size} probabilities for {len(labels)} class labels."
        )
    class_index = int(np.argmax(probs))
    return {
        "model_name": bundle.metadata.get("model_name", bundle.model_dir.name),
        "model_version": bundle.metadata.get("model_version"),
        "input": {
            "signal_path": Path(signal_path).as_posix(),
            "demographics_path": Path(demographics_path).as_posix(),
            "fs_hz": int(fs),
            "window_seconds": int(round(len(signal) / float(fs))),
            "n_samples": int(len(signal)),
        },
        "prediction": {
            "class_index": class_index,
            "label": labels[class_index],
            "probabilities": {
                label: float(probs[idx])
                for idx, label in enumerate(labels)
            },
        },
        "quality": quality,
        "warnings": warnings,
    }


def run_prediction(
    signal_path: Path,
    demographics_path: Path,
    output_path: Path,
    model_dir: Path = DEFAULT_MODEL_DIR,
    fs: int = DEFAULT_FS,
    strict_length: bool = True,
) -> dict:
    bundle = load_model_bundle(Path(model_dir))
    signal = load_signal(Path(signal_path))
    validate_signal(signal, fs=fs, strict_length=strict_length)
    raw_demographics = load_demographics(Path(demographics_path))
    demographics = normalize_demographics(
        raw_demographics,
        bundle.final_features,
        schema=bundle.schema,
    )

    warnings: list[str] = []
    if not strict_length and len(signal) != DEFAULT_WINDOW_SECONDS * fs:
        warnings.append(
            "Signal length differs from 15 minutes; prediction used the supplied window without trimming or padding."
        )

    signal_features, quality = extract_features_from_signal(signal, fs)
    row = assemble_feature_row(signal_features, demographics, bundle.final_features)
    probabilities = np.asarray(bundle.model.predict_proba(row), dtype=float)[0]
    payload = _prediction_payload(
        bundle=bundle,
        signal_path=Path(signal_path),
        demographics_path=Path(demographics_path),
        fs=fs,
        signal=signal,
        probabilities=probabilities,
        quality=quality,
        warnings=warnings,
    )

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def _write_error_json(output_path: Path | None, message: str) -> None:
    if output_path is None:
        return
    try:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps({"error": {"message": message}}, indent=2),
            encoding="utf-8",
        )
    except Exception:
        return


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run current-window BGL 3-zone inference.")
    parser.add_argument("--signal", type=Path, required=True)
    parser.add_argument("--demographics", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--fs", type=int, default=DEFAULT_FS)
    parser.add_argument(
        "--strict-length",
        dest="strict_length",
        action="store_true",
        default=True,
        help="Require exactly 900 seconds of samples at --fs.",
    )
    parser.add_argument(
        "--no-strict-length",
        dest="strict_length",
        action="store_false",
        help="Allow non-900-second inputs without trimming or padding.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    try:
        payload = run_prediction(
            signal_path=args.signal,
            demographics_path=args.demographics,
            output_path=args.output,
            model_dir=args.model_dir,
            fs=args.fs,
            strict_length=args.strict_length,
        )
    except Exception as exc:
        message = str(exc)
        _write_error_json(args.output, message)
        print(f"ERROR: {message}", file=sys.stderr)
        raise SystemExit(1) from exc

    print(json.dumps(payload["prediction"], indent=2))


if __name__ == "__main__":
    main()
