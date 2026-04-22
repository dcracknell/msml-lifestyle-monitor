"""
Tests that the config file loads correctly and all data files exist.

These tests will FAIL if the data files are not present on the machine.
That is intentional — they are your pre-flight checklist before running
the pipeline on a server.

Run with:  pytest tests/test_config_and_data.py -v
"""

from pathlib import Path
import numpy as np
import pandas as pd
import pytest
import yaml


CONFIG_PATH = Path("configs/vitaldb.yaml")
REQUIRED_CONFIG_KEYS = [
    "dataset_name", "data_dir", "output_dir",
    "glucose_file", "demographics_file", "download_log_file", "cases_file",
    "ppg_sampling_rate", "ppg_file_pattern",
    "bandpass_low", "bandpass_high", "bandpass_order",
    "window_minutes", "lag_minutes", "min_coverage",
    "max_imfs", "n_top_features",
    "subjects",
]


# ── Config file ───────────────────────────────────────────────

class TestConfig:
    @pytest.fixture(autouse=True)
    def cfg(self):
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)

    def test_config_file_exists(self):
        assert CONFIG_PATH.exists(), f"Config not found: {CONFIG_PATH}"

    def test_config_loads_as_dict(self, cfg):
        assert isinstance(cfg, dict)

    def test_all_required_keys_present(self, cfg):
        missing = [k for k in REQUIRED_CONFIG_KEYS if k not in cfg]
        assert missing == [], f"Missing config keys: {missing}"

    def test_subjects_is_list_of_20(self, cfg):
        assert isinstance(cfg["subjects"], list)
        assert len(cfg["subjects"]) == 20, (
            f"Expected 20 subjects, got {len(cfg['subjects'])}"
        )

    def test_subjects_are_all_integers(self, cfg):
        for sid in cfg["subjects"]:
            assert isinstance(sid, int), f"Subject ID {sid!r} is not an int"

    def test_ppg_sampling_rate_is_500(self, cfg):
        assert cfg["ppg_sampling_rate"] == 500

    def test_bandpass_range_is_valid(self, cfg):
        assert cfg["bandpass_low"] < cfg["bandpass_high"]
        assert cfg["bandpass_low"] > 0
        assert cfg["bandpass_high"] < cfg["ppg_sampling_rate"] / 2

    def test_window_and_lag_positive(self, cfg):
        assert cfg["window_minutes"] > 0
        assert cfg["lag_minutes"] > 0

    def test_min_coverage_in_range(self, cfg):
        assert 0 < cfg["min_coverage"] <= 1.0

    def test_n_top_features_reasonable(self, cfg):
        assert 1 <= cfg["n_top_features"] <= 400

    def test_data_dir_in_config(self, cfg):
        assert cfg["data_dir"] == "data/vitaldb"

    def test_output_dir_in_config(self, cfg):
        assert cfg["output_dir"] == "outputs"


# ── Data files ────────────────────────────────────────────────

class TestDataFiles:
    """Pre-flight checks that every required input file is present."""

    @pytest.fixture(autouse=True)
    def cfg(self):
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)

    def _data_path(self, cfg, filename):
        return Path(cfg["data_dir"]) / filename

    def test_glucose_csv_exists(self, cfg):
        p = self._data_path(cfg, cfg["glucose_file"])
        assert p.exists(), f"Missing: {p}"

    def test_demographics_csv_exists(self, cfg):
        p = self._data_path(cfg, cfg["demographics_file"])
        assert p.exists(), f"Missing: {p}"

    def test_download_log_csv_exists(self, cfg):
        p = self._data_path(cfg, cfg["download_log_file"])
        assert p.exists(), f"Missing: {p}"

    def test_cases_csv_exists(self, cfg):
        p = self._data_path(cfg, cfg["cases_file"])
        assert p.exists(), f"Missing: {p}"

    def test_all_ppg_npy_files_exist(self, cfg):
        missing = []
        for sid in cfg["subjects"]:
            pattern = cfg["ppg_file_pattern"].format(caseid=sid)
            p = Path(cfg["data_dir"]) / pattern
            if not p.exists():
                missing.append(str(p))
        assert missing == [], (
            f"{len(missing)} PPG files missing:\n" + "\n".join(missing)
        )

    def test_ppg_npy_count_is_20(self, cfg):
        ppg_dir = Path(cfg["data_dir"]) / "ppg"
        npy_files = list(ppg_dir.glob("*.npy"))
        assert len(npy_files) >= 20, (
            f"Expected ≥20 .npy files, found {len(npy_files)} in {ppg_dir}"
        )


# ── Data content sanity ───────────────────────────────────────

class TestDataContent:
    """Light content checks on CSV files — no PPG loading (that's slow)."""

    @pytest.fixture(autouse=True)
    def cfg(self):
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)

    def test_glucose_csv_has_required_columns(self, cfg):
        path = Path(cfg["data_dir"]) / cfg["glucose_file"]
        df = pd.read_csv(path, nrows=5)
        for col in ("caseid", "glucose_time_sec", "glucose_mg_dl"):
            assert col in df.columns, f"Column '{col}' missing from {path.name}"

    def test_glucose_values_are_positive(self, cfg):
        path = Path(cfg["data_dir"]) / cfg["glucose_file"]
        df = pd.read_csv(path)
        assert (df["glucose_mg_dl"] > 0).all(), "Found non-positive glucose values"
        assert df["glucose_mg_dl"].notna().all(), "Found NaN glucose values"

    def test_glucose_range_is_physiological(self, cfg):
        path = Path(cfg["data_dir"]) / cfg["glucose_file"]
        df = pd.read_csv(path)
        assert df["glucose_mg_dl"].min() >= 30,  "Glucose too low (< 30 mg/dL)"
        assert df["glucose_mg_dl"].max() <= 800, "Glucose too high (> 800 mg/dL)"

    def test_demographics_csv_has_caseid(self, cfg):
        path = Path(cfg["data_dir"]) / cfg["demographics_file"]
        df = pd.read_csv(path, nrows=5)
        assert "caseid" in df.columns

    def test_subjects_in_glucose_file(self, cfg):
        path = Path(cfg["data_dir"]) / cfg["glucose_file"]
        df = pd.read_csv(path)
        cfg_sids = set(cfg["subjects"])
        csv_sids = set(df["caseid"].unique())
        missing_from_csv = cfg_sids - csv_sids
        assert missing_from_csv == set(), (
            f"Subjects in config but missing from glucose CSV: {missing_from_csv}"
        )

    def test_one_ppg_file_loads_as_array(self, cfg):
        first_sid = cfg["subjects"][0]
        pattern = cfg["ppg_file_pattern"].format(caseid=first_sid)
        path = Path(cfg["data_dir"]) / pattern
        ppg = np.load(path)
        ppg = ppg.flatten() if ppg.ndim > 1 else ppg
        assert ppg.ndim == 1, "PPG should be 1D after flattening"
        assert len(ppg) > 0, "PPG array is empty"
        # At 500 Hz, even a 5-minute recording is 150k samples
        min_expected = 5 * 60 * cfg["ppg_sampling_rate"]
        assert len(ppg) >= min_expected, (
            f"PPG for case {first_sid} has only {len(ppg)} samples "
            f"(expected ≥ {min_expected} for a 5-min recording)"
        )
