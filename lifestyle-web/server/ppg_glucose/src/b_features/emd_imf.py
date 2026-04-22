"""
Step B3: EMD / IMF Feature Extraction
======================================
Applies Empirical Mode Decomposition (EMD) to each PPG window
and extracts 20 features per Intrinsic Mode Function (IMF).

Based on:
  Satter et al. (2024) "EMD-Based Noninvasive Blood Glucose
  Estimation from PPG Signals Using ML Algorithms"

With max_imfs=7: 7 IMFs × 20 features = 140 features per window
With current + lag: up to 280 per segment

IMPORTANT: EMD is slow on 450,000-sample windows.
This script downsamples each window to 64 Hz before EMD
to keep runtime manageable (same rate as BIG IDEAs).
"""

import numpy as np
from scipy.signal import find_peaks, welch, resample_poly, hilbert
from scipy.stats import skew, kurtosis
from scipy.fft import fft, fftfreq
from PyEMD import EMD


def downsample_for_emd(ppg_segment, fs_original, fs_target=64):
    """
    Downsample PPG from fs_original to fs_target Hz.
    Uses polyphase resampling for clean anti-aliased output.

    Args:
        ppg_segment: 1D array at fs_original Hz
        fs_original: original sampling rate (e.g. 500)
        fs_target:   target rate (default 64)

    Returns:
        (downsampled_signal, fs_target)
    """
    from math import gcd
    g = gcd(fs_target, fs_original)
    up = fs_target // g
    down = fs_original // g
    downsampled = resample_poly(ppg_segment, up, down)
    return downsampled, fs_target


def compute_imf_features(imf, fs):
    """
    Compute 20 features for a single IMF.

    Returns:
        dict of {feature_name: value}
    """
    features = {}
    N = len(imf)

    # ── Time domain (8 features) ────────────────────────────
    features["mean"] = np.mean(imf)
    features["var"] = np.var(imf)
    features["std"] = np.std(imf)
    features["ptp"] = np.ptp(imf)
    features["skew"] = skew(imf)
    features["kurtosis"] = kurtosis(imf)

    # Zero crossing rate
    zero_crossings = np.sum(np.diff(np.sign(imf)) != 0)
    features["zcr"] = zero_crossings / N

    # Extrema count
    maxima = find_peaks(imf)[0]
    minima = find_peaks(-imf)[0]
    features["extrema"] = len(maxima) + len(minima)

    # ── Frequency domain (4 features) ───────────────────────
    fft_vals = fft(imf)
    fft_mag = np.abs(fft_vals[:N // 2])
    freqs = fftfreq(N, d=1.0 / fs)[:N // 2]

    # Dominant frequency
    if len(fft_mag) > 0 and np.max(fft_mag) > 0:
        features["dominant_freq"] = freqs[np.argmax(fft_mag)]
    else:
        features["dominant_freq"] = 0.0

    # Total power
    features["total_power"] = np.sum(fft_mag ** 2)

    # PSD via Welch
    nperseg = min(256, N)
    if nperseg >= 8:
        f_psd, psd = welch(imf, fs=fs, nperseg=nperseg)
        features["psd_mean"] = np.mean(psd)
        features["psd_var"] = np.var(psd)
    else:
        features["psd_mean"] = 0.0
        features["psd_var"] = 0.0

    # ── Spectral features (6 features) ──────────────────────
    # Spectral centroid
    if np.sum(fft_mag) > 0:
        features["spectral_centroid"] = np.sum(freqs * fft_mag) / np.sum(fft_mag)
    else:
        features["spectral_centroid"] = 0.0

    # Spectral entropy
    psd_sum = np.sum(psd) if nperseg >= 8 else 0
    if psd_sum > 0:
        psd_norm = psd / psd_sum
        psd_norm = psd_norm[psd_norm > 0]
        features["spectral_entropy"] = -np.sum(psd_norm * np.log(psd_norm))
    else:
        features["spectral_entropy"] = 0.0

    # Spectral flatness
    fft_pos = fft_mag[fft_mag > 0]
    if len(fft_pos) > 0 and np.mean(fft_mag) > 0:
        geometric_mean = np.exp(np.mean(np.log(fft_pos)))
        features["spectral_flatness"] = geometric_mean / np.mean(fft_mag)
    else:
        features["spectral_flatness"] = 0.0

    # Peak to spectral energy ratio
    if features["total_power"] > 0:
        features["pser"] = np.max(fft_mag) / features["total_power"]
    else:
        features["pser"] = 0.0

    # Spectral band energy (0.5 - 4.5 Hz, PPG-relevant)
    band_mask = (freqs >= 0.5) & (freqs <= 4.5)
    if np.any(band_mask):
        features["spectral_band_energy"] = np.sum(fft_mag[band_mask] ** 2)
    else:
        features["spectral_band_energy"] = 0.0

    # Spectral slope
    if len(freqs) > 2:
        log_freqs = np.log(freqs[1:] + 1e-10)
        log_mag = np.log(fft_mag[1:] + 1e-10)
        features["spectral_slope"] = np.polyfit(log_freqs, log_mag, 1)[0]
    else:
        features["spectral_slope"] = 0.0

    # ── Analytic signal features (2 features) ───────────────
    analytic = hilbert(imf)
    amplitude_envelope = np.abs(analytic)
    features["ae_mean"] = np.mean(amplitude_envelope)

    phase = np.unwrap(np.angle(analytic))
    inst_freq = np.diff(phase) / (2.0 * np.pi * (1.0 / fs))
    features["if_mean"] = np.mean(inst_freq) if len(inst_freq) > 0 else 0.0

    return features


def imf_feature_names():
    """Return the 20 feature names (for zero-padding)."""
    return [
        "mean", "var", "std", "ptp", "skew", "kurtosis", "zcr", "extrema",
        "dominant_freq", "total_power", "psd_mean", "psd_var",
        "spectral_centroid", "spectral_entropy", "spectral_flatness",
        "pser", "spectral_band_energy", "spectral_slope",
        "ae_mean", "if_mean",
    ]


def extract_emd_features(ppg_segment, fs, prefix="w15m", max_imfs=7, ds_rate=64):
    """
    Extract EMD/IMF features from a PPG segment.

    Steps:
    1. Downsample to ds_rate Hz (for speed)
    2. Run EMD to get IMFs
    3. Extract 20 features per IMF
    4. Zero-pad if fewer than max_imfs

    Args:
        ppg_segment: 1D array (filtered PPG, possibly 500 Hz)
        fs:          original sampling rate
        prefix:      "w15m" or "lag15m"
        max_imfs:    max number of IMFs (default 7, per Satter paper)
        ds_rate:     downsample target for EMD (default 64 Hz)

    Returns:
        dict of {feature_name: value}
    """
    # Downsample for speed
    if fs != ds_rate:
        sig_ds, fs_ds = downsample_for_emd(ppg_segment, fs, ds_rate)
    else:
        sig_ds = ppg_segment
        fs_ds = fs

    # Run EMD
    emd = EMD()
    try:
        imfs = emd(sig_ds)
    except Exception:
        # EMD failed — return zeros
        features = {}
        for i in range(max_imfs):
            for name in imf_feature_names():
                features[f"{prefix}_imf{i + 1}_{name}"] = 0.0
        return features

    # Extract features for each IMF
    features = {}
    for i in range(max_imfs):
        if i < len(imfs):
            try:
                feat = compute_imf_features(imfs[i], fs_ds)
            except Exception:
                feat = {k: 0.0 for k in imf_feature_names()}
        else:
            # Zero-pad missing IMFs
            feat = {k: 0.0 for k in imf_feature_names()}

        for name, val in feat.items():
            features[f"{prefix}_imf{i + 1}_{name}"] = val

    return features


# ── Standalone test ──────────────────────────────────────────
if __name__ == "__main__":
    from src.a_preprocessing.load_vitaldb import load_config, load_all_subjects
    from src.a_preprocessing.preprocess import preprocess_all
    import time

    cfg = load_config()
    subjects = load_all_subjects(cfg)
    segments = preprocess_all(subjects, cfg)

    print("\n" + "=" * 60)
    print("EMD / IMF FEATURE TEST")
    print("=" * 60)

    # Test on just 2 segments (EMD can be slow)
    for seg in segments[:2]:
        t0 = time.time()
        feat = extract_emd_features(
            seg["w15m_ppg"], cfg["ppg_sampling_rate"], "w15m",
            max_imfs=cfg.get("max_imfs", 7)
        )
        elapsed = time.time() - t0

        print(f"\nCase {seg['sid']}, glucose={seg['glucose_mgdl']} mg/dL:")
        print(f"  Features: {len(feat)}")
        print(f"  Time: {elapsed:.1f}s")

        # Show a few example features
        for name, val in list(feat.items())[:5]:
            print(f"    {name}: {val:.6f}")
        print(f"    ...")

    print(f"\nFeatures per window: {7 * 20} = 140")
    print(f"(7 IMFs × 20 features each)")
