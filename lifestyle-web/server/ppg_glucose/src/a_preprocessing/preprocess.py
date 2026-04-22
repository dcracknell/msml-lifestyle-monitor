"""
Step A2: Preprocessing
======================
Takes raw loaded subject data (from Step A1) and produces
clean PPG segments aligned to glucose timestamps.

For each glucose measurement at time t:
  - w15m:   PPG window from [t - 15 min, t]       (current window)
  - lag15m: PPG window from [t - 30 min, t - 15 min] (lagged window)

Both windows are bandpass filtered (0.5–8 Hz).

Usage:
    python -m src.a_preprocessing.preprocess
"""

import numpy as np
from scipy.signal import butter, filtfilt


def bandpass_filter(signal, lowcut, highcut, fs, order=4):
    """
    Apply a Butterworth bandpass filter.

    Args:
        signal:  1D numpy array (raw PPG)
        lowcut:  lower cutoff frequency (Hz)
        highcut: upper cutoff frequency (Hz)
        fs:      sampling rate (Hz)
        order:   filter order

    Returns:
        1D numpy array (filtered PPG)
    """
    nyq = 0.5 * fs
    low = lowcut / nyq
    high = highcut / nyq
    b, a = butter(order, [low, high], btype="band")
    return filtfilt(b, a, signal)


def fill_missing_samples(signal):
    """
    Fill NaN gaps by linear interpolation so filtering can run on each window.
    """
    signal = np.asarray(signal, dtype=float)
    valid_mask = np.isfinite(signal)

    if not valid_mask.any():
        return None

    if valid_mask.all():
        return signal.copy()

    filled = signal.copy()
    missing_idx = np.flatnonzero(~valid_mask)
    valid_idx = np.flatnonzero(valid_mask)
    filled[missing_idx] = np.interp(missing_idx, valid_idx, signal[valid_mask])
    return filled


def extract_window(ppg_filtered, t_end_sec, window_minutes, fs):
    """
    Extract a PPG window ending at t_end_sec.

    Args:
        ppg_filtered: full filtered PPG array for this subject
        t_end_sec:    end time of window in seconds from case start
        window_minutes: window length in minutes
        fs:           sampling rate

    Returns:
        np.ndarray or None (if not enough data)
    """
    window_sec = window_minutes * 60
    t_start_sec = t_end_sec - window_sec

    # Cannot extract window before the recording starts
    if t_start_sec < 0:
        return None

    start_sample = int(t_start_sec * fs)
    end_sample = int(t_end_sec * fs)

    # Cannot extract window past the recording end
    if end_sample > len(ppg_filtered):
        return None

    window = ppg_filtered[start_sample:end_sample]
    return window


def check_window_quality(window, fs, min_coverage=0.80):
    """
    Check whether a PPG window is usable.

    Checks:
    1. Enough valid (non-NaN, non-zero) samples
    2. Signal is not flatlined
    3. No extreme outliers

    Returns:
        (bool, str): (passed, reason if failed)
    """
    if window is None:
        return False, "window is None"

    expected_samples = len(window)
    if expected_samples == 0:
        return False, "empty window"

    # Check for NaN / inf before interpolation
    valid_mask = np.isfinite(window)
    valid_pct = valid_mask.sum() / expected_samples
    if valid_pct < min_coverage:
        return False, f"too many NaN ({valid_pct:.1%} valid, need {min_coverage:.0%})"

    # Check for flatline (std too low)
    valid_signal = window[valid_mask]
    if np.std(valid_signal) < 1e-6:
        return False, "flatline signal"

    # Check for extreme outliers (values > 10 std from mean)
    mean_val = np.mean(valid_signal)
    std_val = np.std(valid_signal)
    outlier_pct = np.sum(np.abs(valid_signal - mean_val) > 10 * std_val) / len(valid_signal)
    if outlier_pct > 0.05:
        return False, f"too many outliers ({outlier_pct:.1%})"

    return True, "ok"


def preprocess_subject(subject_data, cfg):
    """
    Preprocess one subject: filter PPG, extract windows for each glucose time.

    Args:
        subject_data: dict from load_all_subjects() with keys:
                      sid, ppg, ppg_fs, glucose, demographics
        cfg:          config dict

    Returns:
        list of segment dicts:
        {
            "sid":            int,
            "glucose_time":   float,    # seconds from case start
            "glucose_mgdl":   float,
            "w15m_ppg":       np.array, # current 15-min window (filtered)
            "lag15m_ppg":     np.array or None, # lagged 15-min window
            "demographics":   dict,
        }
    """
    sid = subject_data["sid"]
    ppg_raw = subject_data["ppg"]
    fs = subject_data["ppg_fs"]
    glucose_df = subject_data["glucose"]
    demographics = subject_data["demographics"]

    window_min = cfg["window_minutes"]    # 15
    lag_min = cfg["lag_minutes"]          # 15
    min_coverage = cfg["min_coverage"]    # 0.80
    lowcut = cfg["bandpass_low"]
    highcut = cfg["bandpass_high"]
    order = cfg["bandpass_order"]

    segments = []
    skipped = 0

    # Step 2: For each glucose timestamp, extract windows
    for _, row in glucose_df.iterrows():
        t_glucose = row["glucose_time_sec"]
        glucose_val = row["glucose_mgdl"]

        # Current window: [t - 15min, t]
        w15m_raw = extract_window(ppg_raw, t_glucose, window_min, fs)
        w15m_ok, w15m_reason = check_window_quality(w15m_raw, fs, min_coverage)

        if not w15m_ok:
            skipped += 1
            continue

        w15m = fill_missing_samples(w15m_raw)
        if w15m is None:
            skipped += 1
            continue
        w15m = bandpass_filter(w15m, lowcut, highcut, fs, order)

        # Lagged window: [t - 30min, t - 15min]
        lag_end = t_glucose - (lag_min * 60)
        lag15m_raw = extract_window(ppg_raw, lag_end, window_min, fs)
        lag15m_ok, _ = check_window_quality(lag15m_raw, fs, min_coverage)
        lag15m = None

        # lag15m can be None (not enough recording before this glucose time)
        # That's OK — we keep the segment, lag features will just be missing
        if lag15m_ok:
            lag15m = fill_missing_samples(lag15m_raw)
            if lag15m is not None:
                lag15m = bandpass_filter(lag15m, lowcut, highcut, fs, order)

        segments.append({
            "sid": sid,
            "glucose_time": t_glucose,
            "glucose_mgdl": glucose_val,
            "w15m_ppg": w15m,
            "lag15m_ppg": lag15m,
            "demographics": demographics,
        })

    return segments, skipped


def preprocess_all(subjects_data, cfg):
    """
    Preprocess all subjects.

    Args:
        subjects_data: list of subject dicts (from load_all_subjects)
        cfg:           config dict

    Returns:
        list of all segment dicts across all subjects
    """
    print(f"\n[A2] Preprocessing...")
    print(f"  Filter: {cfg['bandpass_low']}–{cfg['bandpass_high']} Hz "
          f"(order {cfg['bandpass_order']})")
    print(f"  Window: {cfg['window_minutes']} min current + "
          f"{cfg['lag_minutes']} min lag")
    print(f"  Min coverage: {cfg['min_coverage']:.0%}")

    all_segments = []
    total_skipped = 0

    for subj in subjects_data:
        segments, skipped = preprocess_subject(subj, cfg)
        all_segments.extend(segments)
        total_skipped += skipped

        n_with_lag = sum(1 for s in segments if s["lag15m_ppg"] is not None)
        print(f"  Case {subj['sid']}: {len(segments)} segments "
              f"({n_with_lag} with lag), {skipped} skipped")

    print(f"\n  Total: {len(all_segments)} segments from "
          f"{len(subjects_data)} subjects")
    print(f"  Skipped: {total_skipped} (failed quality check)")
    n_with_lag = sum(1 for s in all_segments if s["lag15m_ppg"] is not None)
    print(f"  With lag window: {n_with_lag}/{len(all_segments)}")

    return all_segments


# ============================================================
# Run standalone to test
# ============================================================
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config, load_all_subjects

    cfg = load_config()
    subjects = load_all_subjects(cfg)
    segments = preprocess_all(subjects, cfg)

    # Quick checks
    print("\n" + "=" * 60)
    print("PREPROCESSING SUMMARY")
    print("=" * 60)
    print(f"Total segments:     {len(segments)}")

    if len(segments) > 0:
        # Check window sizes
        fs = cfg["ppg_sampling_rate"]
        expected_samples = cfg["window_minutes"] * 60 * fs
        actual_samples = [len(s["w15m_ppg"]) for s in segments]
        print(f"Expected samples:   {expected_samples:,} per window")
        print(f"Actual samples:     {min(actual_samples):,} – {max(actual_samples):,}")

        # Glucose stats
        glucose_vals = [s["glucose_mgdl"] for s in segments]
        print(f"Glucose range:      {min(glucose_vals):.0f} – {max(glucose_vals):.0f} mg/dL")
        print(f"Glucose mean:       {np.mean(glucose_vals):.1f} mg/dL")

        # Check one segment
        seg = segments[0]
        print(f"\nExample segment (case {seg['sid']}, t={seg['glucose_time']:.0f}s):")
        print(f"  w15m shape:    {seg['w15m_ppg'].shape}")
        print(f"  w15m range:    {seg['w15m_ppg'].min():.4f} to {seg['w15m_ppg'].max():.4f}")
        print(f"  lag15m:        {'yes' if seg['lag15m_ppg'] is not None else 'no'}")
        print(f"  glucose:       {seg['glucose_mgdl']} mg/dL")
