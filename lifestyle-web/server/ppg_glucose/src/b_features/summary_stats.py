"""
TODO: per-pulse features migrating to pyPPG.

The window-level features here (mean, std, min, max, median, iqr,
rms, peak_to_peak, skew, kurtosis, d1_*, d2_*) are still valid
and stay. The peak-detection-derived features (hr_bpm, ibi_std,
mean_peak_amp, std_peak_amp) will move to pyPPG-based extraction
in v2 because they share the manual detector's noise sensitivity.
"""

"""
Step B1: Summary Statistics Feature Extraction
===============================================
Extracts 22 basic statistical features from each PPG window.
These capture overall signal characteristics: amplitude,
variability, distribution shape, and rate of change.

Features per window: 22
With current + lag:  up to 44 per segment
"""

import numpy as np
from scipy.signal import find_peaks
from scipy.stats import skew, kurtosis


def extract_summary_features(ppg_segment, fs, prefix="w15m"):
    """
    Extract 22 summary statistics from a PPG segment.

    Args:
        ppg_segment: 1D numpy array (filtered PPG window)
        fs:          sampling rate (Hz)
        prefix:      "w15m" or "lag15m"

    Returns:
        dict of {feature_name: value}
    """
    features = {}
    sig = ppg_segment

    # ── Basic statistics (7) ────────────────────────────────
    features[f"{prefix}_mean"] = np.mean(sig)
    features[f"{prefix}_std"] = np.std(sig)
    features[f"{prefix}_min"] = np.min(sig)
    features[f"{prefix}_max"] = np.max(sig)
    features[f"{prefix}_median"] = np.median(sig)
    features[f"{prefix}_iqr"] = np.percentile(sig, 75) - np.percentile(sig, 25)
    features[f"{prefix}_rms"] = np.sqrt(np.mean(sig ** 2))

    # ── Amplitude (1) ───────────────────────────────────────
    features[f"{prefix}_peak_to_peak"] = np.ptp(sig)

    # ── Distribution shape (2) ──────────────────────────────
    features[f"{prefix}_skew"] = skew(sig)
    features[f"{prefix}_kurtosis"] = kurtosis(sig)

    # ── First derivative (4) ────────────────────────────────
    d1 = np.diff(sig)
    features[f"{prefix}_d1_mean"] = np.mean(d1)
    features[f"{prefix}_d1_std"] = np.std(d1)
    features[f"{prefix}_d1_max"] = np.max(d1)
    features[f"{prefix}_d1_min"] = np.min(d1)

    # ── Second derivative (4) ───────────────────────────────
    d2 = np.diff(d1)
    features[f"{prefix}_d2_mean"] = np.mean(d2)
    features[f"{prefix}_d2_std"] = np.std(d2)
    features[f"{prefix}_d2_max"] = np.max(d2)
    features[f"{prefix}_d2_min"] = np.min(d2)

    # ── Peak detection (4) ──────────────────────────────────
    min_distance = int(0.4 * fs)
    peaks, _ = find_peaks(sig, distance=min_distance,
                          prominence=0.1 * np.std(sig))

    if len(peaks) >= 2:
        ibi = np.diff(peaks) / fs
        features[f"{prefix}_hr_bpm"] = 60.0 / np.mean(ibi)
        features[f"{prefix}_ibi_std"] = np.std(ibi)
        peak_amps = sig[peaks]
        features[f"{prefix}_mean_peak_amp"] = np.mean(peak_amps)
        features[f"{prefix}_std_peak_amp"] = np.std(peak_amps)
    else:
        features[f"{prefix}_hr_bpm"] = np.nan
        features[f"{prefix}_ibi_std"] = np.nan
        features[f"{prefix}_mean_peak_amp"] = np.nan
        features[f"{prefix}_std_peak_amp"] = np.nan

    return features


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config, load_all_subjects
    from src.a_preprocessing.preprocess import preprocess_all

    cfg = load_config()
    subjects = load_all_subjects(cfg)
    segments = preprocess_all(subjects, cfg)

    print("\n" + "=" * 60)
    print("SUMMARY STATISTICS TEST")
    print("=" * 60)

    for seg in segments[:3]:
        feat = extract_summary_features(seg["w15m_ppg"], cfg["ppg_sampling_rate"], "w15m")
        print(f"\nCase {seg['sid']}, glucose={seg['glucose_mgdl']} mg/dL:")
        print(f"  Features: {len(feat)}")
        print(f"  HR: {feat.get('w15m_hr_bpm', 'N/A'):.1f} bpm")
        print(f"  RMS: {feat.get('w15m_rms', 'N/A'):.4f}")
        print(f"  Skew: {feat.get('w15m_skew', 'N/A'):.4f}")

    print(f"\nFeatures per window: 22")
