"""
Step B2: Morphology + PRV Feature Extraction
=============================================
Extracts pulse shape (morphology) and pulse rate variability (PRV)
features from each PPG window.

Morphology features capture waveform shape characteristics that
are physiologically linked to vascular changes from glucose.

PRV features capture autonomic nervous system responses, which
your BIG IDEAs correlation analysis showed were among the
strongest predictors of glucose.

Features per window: 17
With current + lag:  up to 34 per segment
"""

import numpy as np
from scipy.signal import find_peaks, welch


def extract_morphology_prv_features(ppg_segment, fs, prefix="w15m"):
    """
    Extract 17 morphology and PRV features from a PPG segment.

    Args:
        ppg_segment: 1D numpy array (filtered PPG window)
        fs:          sampling rate (Hz)
        prefix:      "w15m" or "lag15m"

    Returns:
        dict of {feature_name: value}
    """
    features = {}
    sig = ppg_segment

    # ── Detect systolic peaks ───────────────────────────────
    min_distance = int(0.4 * fs)
    peaks, _ = find_peaks(sig, distance=min_distance,
                          prominence=0.1 * np.std(sig))

    # ── Detect troughs (diastolic minima) ───────────────────
    troughs, _ = find_peaks(-sig, distance=min_distance)

    if len(peaks) < 3 or len(troughs) < 2:
        # Not enough beats for morphology — return NaNs
        morph_names = [
            "pulse_width_25", "pulse_width_50", "pulse_width_75",
            "systolic_time", "diastolic_time", "sys_dia_ratio",
            "rise_slope", "fall_slope",
        ]
        prv_names = [
            "prv_mean_ibi", "prv_std_ibi", "prv_rmssd", "prv_sdnn", "prv_pnn50",
            "prv_power_lf", "prv_power_hf", "prv_lf_hf_ratio", "prv_total_power",
        ]
        for name in morph_names + prv_names:
            features[f"{prefix}_{name}"] = np.nan
        return features

    # ── Morphology: pulse width at 25%, 50%, 75% amplitude (3) ──
    pulse_widths_25 = []
    pulse_widths_50 = []
    pulse_widths_75 = []
    systolic_times = []
    diastolic_times = []
    rise_slopes = []
    fall_slopes = []

    for i in range(len(peaks) - 1):
        pk = peaks[i]

        # Find trough before this peak
        tr_before_arr = troughs[troughs < pk]
        if len(tr_before_arr) == 0:
            continue
        tr_before = tr_before_arr[-1]

        # Find trough after this peak
        tr_after_arr = troughs[troughs > pk]
        if len(tr_after_arr) == 0:
            continue
        tr_after = tr_after_arr[0]

        # Amplitude of this beat
        amp = sig[pk] - sig[tr_before]
        if amp <= 0:
            continue

        # Pulse widths at different amplitude levels
        beat = sig[tr_before:tr_after + 1]
        baseline = sig[tr_before]

        for level, pw_list in [(0.25, pulse_widths_25),
                                (0.50, pulse_widths_50),
                                (0.75, pulse_widths_75)]:
            threshold = baseline + amp * level
            above = beat > threshold
            crossings = np.where(np.diff(above.astype(int)))[0]
            if len(crossings) >= 2:
                pw_samples = crossings[-1] - crossings[0]
                pw_list.append(pw_samples / fs * 1000)  # in ms

        # Systolic time (trough to peak)
        sys_time = (pk - tr_before) / fs * 1000  # ms
        systolic_times.append(sys_time)

        # Diastolic time (peak to next trough)
        dia_time = (tr_after - pk) / fs * 1000  # ms
        diastolic_times.append(dia_time)

        # Rise slope (ascending limb)
        if pk > tr_before:
            rise_slopes.append(amp / ((pk - tr_before) / fs))

        # Fall slope (descending limb)
        fall_amp = sig[pk] - sig[tr_after]
        if tr_after > pk:
            fall_slopes.append(fall_amp / ((tr_after - pk) / fs))

    # Store morphology features as medians (robust to outlier beats)
    features[f"{prefix}_pulse_width_25"] = np.median(pulse_widths_25) if pulse_widths_25 else np.nan
    features[f"{prefix}_pulse_width_50"] = np.median(pulse_widths_50) if pulse_widths_50 else np.nan
    features[f"{prefix}_pulse_width_75"] = np.median(pulse_widths_75) if pulse_widths_75 else np.nan
    features[f"{prefix}_systolic_time"] = np.median(systolic_times) if systolic_times else np.nan
    features[f"{prefix}_diastolic_time"] = np.median(diastolic_times) if diastolic_times else np.nan

    if systolic_times and diastolic_times:
        features[f"{prefix}_sys_dia_ratio"] = np.median(systolic_times) / np.median(diastolic_times)
    else:
        features[f"{prefix}_sys_dia_ratio"] = np.nan

    features[f"{prefix}_rise_slope"] = np.median(rise_slopes) if rise_slopes else np.nan
    features[f"{prefix}_fall_slope"] = np.median(fall_slopes) if fall_slopes else np.nan

    # ── PRV: Pulse Rate Variability (9 features) ───────────
    ibi = np.diff(peaks) / fs  # inter-beat intervals in seconds

    # Time domain PRV
    features[f"{prefix}_prv_mean_ibi"] = np.mean(ibi)
    features[f"{prefix}_prv_std_ibi"] = np.std(ibi)

    # RMSSD: root mean square of successive differences
    successive_diffs = np.diff(ibi)
    features[f"{prefix}_prv_rmssd"] = np.sqrt(np.mean(successive_diffs ** 2))

    # SDNN: standard deviation of NN intervals (same as std_ibi)
    features[f"{prefix}_prv_sdnn"] = np.std(ibi)

    # pNN50: percentage of successive differences > 50ms
    features[f"{prefix}_prv_pnn50"] = np.sum(np.abs(successive_diffs) > 0.05) / len(successive_diffs)

    # Frequency domain PRV (using Welch on IBI series)
    if len(ibi) >= 8:
        # Resample IBI to regular 4 Hz grid for spectral analysis
        ibi_times = np.cumsum(ibi)
        resample_rate = 4.0  # Hz
        t_regular = np.arange(ibi_times[0], ibi_times[-1], 1.0 / resample_rate)
        ibi_resampled = np.interp(t_regular, ibi_times, ibi[:-1] if len(ibi) > len(ibi_times) else ibi[:len(ibi_times)])

        nperseg = min(len(ibi_resampled), 64)
        f_psd, psd = welch(ibi_resampled, fs=resample_rate, nperseg=nperseg)

        # LF: 0.04 - 0.15 Hz (sympathetic + parasympathetic)
        lf_mask = (f_psd >= 0.04) & (f_psd <= 0.15)
        features[f"{prefix}_prv_power_lf"] = np.trapezoid(psd[lf_mask], f_psd[lf_mask]) if np.any(lf_mask) else np.nan

        # HF: 0.15 - 0.40 Hz (parasympathetic)
        hf_mask = (f_psd >= 0.15) & (f_psd <= 0.40)
        features[f"{prefix}_prv_power_hf"] = np.trapezoid(psd[hf_mask], f_psd[hf_mask]) if np.any(hf_mask) else np.nan

        # LF/HF ratio
        lf = features[f"{prefix}_prv_power_lf"]
        hf = features[f"{prefix}_prv_power_hf"]
        if hf and hf > 0 and not np.isnan(hf):
            features[f"{prefix}_prv_lf_hf_ratio"] = lf / hf
        else:
            features[f"{prefix}_prv_lf_hf_ratio"] = np.nan

        # Total power
        features[f"{prefix}_prv_total_power"] = np.trapezoid(psd, f_psd)
    else:
        features[f"{prefix}_prv_power_lf"] = np.nan
        features[f"{prefix}_prv_power_hf"] = np.nan
        features[f"{prefix}_prv_lf_hf_ratio"] = np.nan
        features[f"{prefix}_prv_total_power"] = np.nan

    return features


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config, load_all_subjects
    from src.a_preprocessing.preprocess import preprocess_all

    cfg = load_config()
    subjects = load_all_subjects(cfg)
    segments = preprocess_all(subjects, cfg)

    print("\n" + "=" * 60)
    print("MORPHOLOGY + PRV TEST")
    print("=" * 60)

    for seg in segments[:3]:
        feat = extract_morphology_prv_features(seg["w15m_ppg"], cfg["ppg_sampling_rate"], "w15m")
        print(f"\nCase {seg['sid']}, glucose={seg['glucose_mgdl']} mg/dL:")
        print(f"  Features: {len(feat)}")
        for name, val in feat.items():
            if isinstance(val, float) and not np.isnan(val):
                print(f"    {name}: {val:.4f}")
            else:
                print(f"    {name}: {val}")

    print(f"\nFeatures per window: 17")
