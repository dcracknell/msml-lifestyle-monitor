"""
Step A1: VitalDB Data Loader
=============================
Reads raw .npy PPG waveforms and glucose CSV files.
Outputs a standardised list of subject dictionaries that
the preprocessing step (Step A2) consumes.

Usage:
    python -m src.a_preprocessing.load_vitaldb
"""


from pathlib import Path
import yaml
import pandas as pd
import numpy as np


def load_config(config_path="configs/vitaldb.yaml"):
    """Load the YAML config file."""
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def load_glucose(cfg):
    """
    Load the glucose measurements CSV.
    
    Returns:
        pd.DataFrame with columns: [caseid, glucose_time_sec, glucose_mgdl]
    """
    path = Path(cfg["data_dir"]) / cfg["glucose_file"]
    df = pd.read_csv(path)

    # Keep only the columns we need and rename for clarity
    df = df[["caseid", "glucose_time_sec", "glucose_mg_dl"]].copy()
    df.rename(columns={"glucose_mg_dl": "glucose_mgdl"}, inplace=True)

    # Basic validation
    assert df["glucose_mgdl"].notna().all(), "Found NaN glucose values"
    assert (df["glucose_mgdl"] > 0).all(), "Found non-positive glucose values"

    print(f"  Loaded {len(df)} glucose measurements across {df['caseid'].nunique()} cases")
    return df


def load_demographics(cfg):
    """
    Load the demographics CSV.
    
    Returns:
        pd.DataFrame with one row per caseid and relevant clinical columns.
    """
    path = Path(cfg["data_dir"]) / cfg["demographics_file"]
    df = pd.read_csv(path)

    # Keep only our 20 cases
    df = df[df["caseid"].isin(cfg["subjects"])].copy()

    # Select clinically relevant columns
    keep_cols = [
        "caseid", "age", "sex", "height", "weight", "bmi",
        "preop_dm", "preop_gluc", "preop_hb", "preop_cr",
        "casestart", "caseend"
    ]
    # Only keep columns that exist
    keep_cols = [c for c in keep_cols if c in df.columns]
    df = df[keep_cols].copy()

    print(f"  Loaded demographics for {len(df)} cases")
    return df


def load_download_log(cfg):
    """
    Load the download log to get PPG quality metadata.
    
    Returns:
        pd.DataFrame with columns: [caseid, n_samples, duration_min, valid_pct]
    """
    path = Path(cfg["data_dir"]) / cfg["download_log_file"]
    df = pd.read_csv(path)
    df = df[df["caseid"].isin(cfg["subjects"])].copy()
    print(f"  Loaded download log for {len(df)} cases")
    return df


def load_ppg(caseid, cfg):
    """
    Load a single subject's PPG waveform from .npy file.
    
    Args:
        caseid: integer case ID (e.g. 184)
        cfg: config dict
    
    Returns:
        np.ndarray: 1D float array of raw PPG samples at 500 Hz
    """
    filename = cfg["ppg_file_pattern"].format(caseid=caseid)
    path = Path(cfg["data_dir"]) / filename
    ppg = np.load(path)

    # If 2D (some .npy files have shape (N,1)), flatten
    if ppg.ndim > 1:
        ppg = ppg.flatten()

    return ppg


def load_all_subjects(cfg):
    """
    Main loading function. Loads all 20 subjects into a standardised format.
    
    Returns:
        list of dicts, one per subject:
        {
            "sid": int,               # case ID
            "ppg": np.ndarray,        # raw PPG waveform (1D, 500 Hz)
            "ppg_fs": int,            # sampling rate
            "duration_sec": float,    # recording duration in seconds
            "glucose": pd.DataFrame,  # columns: [glucose_time_sec, glucose_mgdl]
            "demographics": dict,     # age, sex, bmi, etc.
        }
    """
    print("\n[A1] Loading VitalDB data...")

    # Load shared files
    glucose_df = load_glucose(cfg)
    demographics_df = load_demographics(cfg)
    download_log_df = load_download_log(cfg)

    subjects = []
    failed = []

    for caseid in cfg["subjects"]:
        try:
            # Load PPG waveform
            ppg = load_ppg(caseid, cfg)
            fs = cfg["ppg_sampling_rate"]
            duration_sec = len(ppg) / fs

            # Get this subject's glucose measurements
            subj_glucose = glucose_df[glucose_df["caseid"] == caseid][
                ["glucose_time_sec", "glucose_mgdl"]
            ].copy().reset_index(drop=True)

            # Filter glucose to within recording duration
            n_before = len(subj_glucose)
            subj_glucose = subj_glucose[
                (subj_glucose["glucose_time_sec"] >= 0) &
                (subj_glucose["glucose_time_sec"] <= duration_sec)
            ].reset_index(drop=True)
            n_after = len(subj_glucose)

            if n_after == 0:
                print(f"  WARNING: Case {caseid} has no glucose within recording window, skipping")
                failed.append(caseid)
                continue

            # Get demographics as a dict
            demo_row = demographics_df[demographics_df["caseid"] == caseid]
            demo_dict = demo_row.iloc[0].to_dict() if len(demo_row) > 0 else {}

            subjects.append({
                "sid": caseid,
                "ppg": ppg,
                "ppg_fs": fs,
                "duration_sec": duration_sec,
                "glucose": subj_glucose,
                "demographics": demo_dict,
            })

            dropped = n_before - n_after
            drop_msg = f" (dropped {dropped} outside window)" if dropped > 0 else ""
            print(f"  Case {caseid}: PPG={len(ppg):,} samples ({duration_sec/60:.0f} min), "
                  f"glucose={n_after} measurements{drop_msg}")

        except FileNotFoundError:
            print(f"  ERROR: PPG file not found for case {caseid}, skipping")
            failed.append(caseid)
        except Exception as e:
            print(f"  ERROR: Case {caseid} failed: {e}")
            failed.append(caseid)

    print(f"\n  Summary: {len(subjects)} subjects loaded, {len(failed)} failed")
    if failed:
        print(f"  Failed cases: {failed}")

    return subjects


# ============================================================
# Run standalone to test
# ============================================================
if __name__ == "__main__":
    cfg = load_config()
    subjects = load_all_subjects(cfg)

    # Print a quick summary
    print("\n" + "=" * 60)
    print("DATA LOADING SUMMARY")
    print("=" * 60)
    total_glucose = sum(len(s["glucose"]) for s in subjects)
    total_ppg_hours = sum(s["duration_sec"] for s in subjects) / 3600
    print(f"Subjects:           {len(subjects)}")
    print(f"Total glucose pts:  {total_glucose}")
    print(f"Total PPG hours:    {total_ppg_hours:.1f}")
    print(f"Glucose range:      "
          f"{min(s['glucose']['glucose_mgdl'].min() for s in subjects):.0f} - "
          f"{max(s['glucose']['glucose_mgdl'].max() for s in subjects):.0f} mg/dL")
    print(f"PPG sampling rate:  {subjects[0]['ppg_fs']} Hz")

    # Quick check on one subject
    s = subjects[0]
    print(f"\nExample (case {s['sid']}):")
    print(f"  PPG shape:    {s['ppg'].shape}")
    print(f"  PPG range:    {s['ppg'].min():.2f} to {s['ppg'].max():.2f}")
    print(f"  Duration:     {s['duration_sec']/60:.1f} min")
    print(f"  Glucose pts:  {len(s['glucose'])}")
    print(f"  Demographics: age={s['demographics'].get('age')}, "
          f"sex={s['demographics'].get('sex')}, "
          f"bmi={s['demographics'].get('bmi', 'N/A'):.1f}")
