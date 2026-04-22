"""
Unit tests for individual pipeline stage functions.

These use synthetic data so they run in seconds with no data files needed.
They verify the math/logic of each processing step.

Run with:  pytest tests/test_pipeline_units.py -v
"""

import math
import numpy as np
import pandas as pd
import pytest

from src.a_preprocessing.preprocess import (
    bandpass_filter,
    fill_missing_samples,
    extract_window,
    check_window_quality,
)
from src.b_features.summary_stats import extract_summary_features
from src.d_training.evaluate import clarke_error_grid
from src.d_training.split import get_cv_splits


FS = 500        # Hz
WIN_SAMPLES = 15 * 60 * FS  # 15-minute window at 500 Hz


def make_ppg(n_samples=WIN_SAMPLES, freq=1.2, fs=FS, seed=0):
    """Synthetic sinusoidal PPG-like signal."""
    rng = np.random.default_rng(seed)
    t = np.arange(n_samples) / fs
    signal = np.sin(2 * np.pi * freq * t)
    signal += 0.05 * rng.standard_normal(n_samples)
    return signal.astype(np.float64)


# ── bandpass_filter ───────────────────────────────────────────

class TestBandpassFilter:
    def test_output_same_length(self):
        sig = make_ppg(WIN_SAMPLES)
        out = bandpass_filter(sig, 0.5, 8.0, FS, order=4)
        assert len(out) == len(sig)

    def test_output_is_float64(self):
        sig = make_ppg(WIN_SAMPLES)
        out = bandpass_filter(sig, 0.5, 8.0, FS, order=4)
        assert out.dtype == np.float64

    def test_attenuates_dc_component(self):
        dc_signal = np.ones(WIN_SAMPLES) * 5.0
        out = bandpass_filter(dc_signal, 0.5, 8.0, FS, order=4)
        # DC should be heavily attenuated (well below 0.5 Hz)
        assert np.abs(out).mean() < 0.1

    def test_passes_in_band_frequency(self):
        # 1.2 Hz is well within the 0.5–8 Hz passband
        sig = make_ppg(WIN_SAMPLES, freq=1.2)
        out = bandpass_filter(sig, 0.5, 8.0, FS, order=4)
        assert np.std(out) > 0.1   # should retain substantial signal energy

    def test_no_nan_in_output(self):
        sig = make_ppg(WIN_SAMPLES)
        out = bandpass_filter(sig, 0.5, 8.0, FS, order=4)
        assert np.isfinite(out).all()


# ── fill_missing_samples ──────────────────────────────────────

class TestFillMissingSamples:
    def test_no_nans_unchanged(self):
        sig = np.array([1.0, 2.0, 3.0, 4.0])
        out = fill_missing_samples(sig)
        np.testing.assert_array_almost_equal(out, sig)

    def test_single_nan_interpolated(self):
        sig = np.array([0.0, np.nan, 2.0])
        out = fill_missing_samples(sig)
        assert np.isfinite(out).all()
        assert out[1] == pytest.approx(1.0)

    def test_all_nan_returns_none(self):
        sig = np.array([np.nan, np.nan, np.nan])
        out = fill_missing_samples(sig)
        assert out is None

    def test_returns_copy(self):
        sig = np.array([1.0, 2.0, 3.0])
        out = fill_missing_samples(sig)
        out[0] = 999.0
        assert sig[0] == 1.0


# ── extract_window ────────────────────────────────────────────

class TestExtractWindow:
    def setup_method(self):
        # 60-minute recording at 500 Hz
        self.ppg = make_ppg(n_samples=60 * 60 * FS)

    def test_window_at_valid_time(self):
        win = extract_window(self.ppg, t_end_sec=20 * 60, window_minutes=15, fs=FS)
        assert win is not None
        assert len(win) == 15 * 60 * FS

    def test_window_before_recording_start_is_none(self):
        win = extract_window(self.ppg, t_end_sec=5 * 60, window_minutes=15, fs=FS)
        assert win is None  # t_start would be negative

    def test_window_past_end_is_none(self):
        # Recording is 60 min; requesting end at 65 min
        win = extract_window(self.ppg, t_end_sec=65 * 60, window_minutes=15, fs=FS)
        assert win is None


# ── check_window_quality ──────────────────────────────────────

class TestCheckWindowQuality:
    def test_good_signal_passes(self):
        sig = make_ppg(WIN_SAMPLES)
        passed, reason = check_window_quality(sig, FS, min_coverage=0.80)
        assert passed, f"Good signal rejected: {reason}"

    def test_none_window_fails(self):
        passed, reason = check_window_quality(None, FS)
        assert not passed

    def test_flatline_fails(self):
        sig = np.ones(WIN_SAMPLES) * 2.5
        passed, reason = check_window_quality(sig, FS)
        assert not passed
        assert "flatline" in reason.lower()

    def test_too_many_nans_fails(self):
        sig = make_ppg(WIN_SAMPLES)
        sig[:int(WIN_SAMPLES * 0.25)] = np.nan   # 25% NaN → below 80% coverage
        passed, reason = check_window_quality(sig, FS, min_coverage=0.80)
        assert not passed

    def test_exactly_at_coverage_threshold_passes(self):
        sig = make_ppg(WIN_SAMPLES)
        sig[:int(WIN_SAMPLES * 0.19)] = np.nan   # 81% valid → passes
        passed, _ = check_window_quality(sig, FS, min_coverage=0.80)
        assert passed


# ── extract_summary_features ──────────────────────────────────

class TestExtractSummaryFeatures:
    def test_returns_dict(self):
        sig = make_ppg(WIN_SAMPLES)
        result = extract_summary_features(sig, FS, "w15m")
        assert isinstance(result, dict)

    def test_expected_number_of_features(self):
        sig = make_ppg(WIN_SAMPLES)
        result = extract_summary_features(sig, FS, "w15m")
        # Defined as 22 features in the README
        assert len(result) == 22

    def test_feature_names_have_correct_prefix(self):
        sig = make_ppg(WIN_SAMPLES)
        result = extract_summary_features(sig, FS, "w15m")
        for key in result:
            assert key.startswith("w15m_"), f"Unexpected key: {key}"

    def test_lag_prefix_works(self):
        sig = make_ppg(WIN_SAMPLES)
        result = extract_summary_features(sig, FS, "lag15m")
        for key in result:
            assert key.startswith("lag15m_"), f"Unexpected key: {key}"

    def test_known_feature_values(self):
        sig = np.ones(WIN_SAMPLES) * 3.0 + make_ppg(WIN_SAMPLES) * 0.001
        result = extract_summary_features(sig, FS, "w15m")
        assert result["w15m_mean"] == pytest.approx(3.0, abs=0.05)

    def test_all_values_are_finite_or_nan(self):
        sig = make_ppg(WIN_SAMPLES)
        result = extract_summary_features(sig, FS, "w15m")
        for k, v in result.items():
            assert v is None or math.isnan(v) or math.isfinite(v), (
                f"Feature '{k}' has unexpected value {v}"
            )


# ── clarke_error_grid ─────────────────────────────────────────

class TestClarkeErrorGrid:
    def test_perfect_predictions_all_zone_a(self):
        y = np.array([80.0, 100.0, 140.0, 180.0, 220.0])
        result, zones = clarke_error_grid(y, y)
        assert (zones == "A").all()
        assert result["Zone_A_pct"] == pytest.approx(100.0)

    def test_zone_ab_always_gte_zone_a(self):
        rng = np.random.default_rng(0)
        y_true = rng.uniform(60, 300, 100)
        y_pred = y_true + rng.normal(0, 30, 100)
        result, _ = clarke_error_grid(y_true, y_pred)
        assert result["Zone_AB_pct"] >= result["Zone_A_pct"]

    def test_zone_percentages_sum_to_100(self):
        rng = np.random.default_rng(1)
        y_true = rng.uniform(60, 300, 50)
        y_pred = y_true + rng.normal(0, 40, 50)
        result, _ = clarke_error_grid(y_true, y_pred)
        total = sum(result[f"Zone_{z}_pct"] for z in "ABCDE")
        assert total == pytest.approx(100.0, abs=0.01)

    def test_returns_dict_and_array(self):
        y = np.array([100.0, 200.0])
        result, zones = clarke_error_grid(y, y)
        assert isinstance(result, dict)
        assert isinstance(zones, np.ndarray)

    def test_hypo_confusion_is_zone_e(self):
        # Predict 300 when true is 40: erroneous treatment (E zone)
        result, zones = clarke_error_grid(np.array([40.0]), np.array([300.0]))
        assert zones[0] == "E"


# ── get_cv_splits ─────────────────────────────────────────────

class TestGetCVSplits:
    def _make_df(self, sids):
        rows = []
        for sid in sids:
            for i in range(5):    # 5 glucose measurements per subject
                rows.append({"sid": sid, "glucose_mgdl": 120.0 + i})
        return pd.DataFrame(rows)

    def test_group_kfold_5_returns_5_folds(self):
        df = self._make_df([184, 241, 626, 750, 1004,
                            1157, 1327, 1407, 1492, 1558,
                            1803, 2160, 3146, 3255, 3962,
                            4245, 4251, 4670, 5311, 6337])
        splits = get_cv_splits(df, "group_kfold_5")
        assert len(splits) == 5

    def test_loso_returns_n_subject_folds(self):
        sids = [184, 241, 626, 750, 1004]
        df = self._make_df(sids)
        splits = get_cv_splits(df, "loso")
        assert len(splits) == len(sids)

    def test_no_subject_leakage_across_folds(self):
        sids = [184, 241, 626, 750, 1004,
                1157, 1327, 1407, 1492, 1558,
                1803, 2160, 3146, 3255, 3962,
                4245, 4251, 4670, 5311, 6337]
        df = self._make_df(sids)
        splits = get_cv_splits(df, "group_kfold_5")
        for train_idx, test_idx in splits:
            train_sids = set(df.iloc[train_idx]["sid"])
            test_sids  = set(df.iloc[test_idx]["sid"])
            overlap = train_sids & test_sids
            assert overlap == set(), f"Subject leakage detected: {overlap}"

    def test_every_row_appears_in_exactly_one_test_fold(self):
        sids = [184, 241, 626, 750, 1004,
                1157, 1327, 1407, 1492, 1558,
                1803, 2160, 3146, 3255, 3962,
                4245, 4251, 4670, 5311, 6337]
        df = self._make_df(sids)
        splits = get_cv_splits(df, "group_kfold_5")
        test_idx_all = []
        for _, test_idx in splits:
            test_idx_all.extend(test_idx.tolist())
        assert sorted(test_idx_all) == list(range(len(df)))
