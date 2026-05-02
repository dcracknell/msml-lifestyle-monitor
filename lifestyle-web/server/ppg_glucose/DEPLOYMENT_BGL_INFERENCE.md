# BGL Inference Deployment Handoff

## 1. Overview

The old `/api/vitals/run` path spawned the training pipeline. The deployment path should now spawn inference only.

Use the current-window model bundle:

```text
models/bgl_catboost_current_ppg_demo_no_preop/
```

Run inference through:

```bash
python -m src.inference.predict
```

## 2. Model Description

The deployed model is a CatBoost 3-zone BGL classifier.

Classes:

- `low`: `[0, 140]` mg/dL
- `elevated`: `(140, 180]` mg/dL
- `hyper`: `(180, inf]` mg/dL

Inputs:

- current 15-minute PPG window
- demographics

Excluded:

- preoperative glucose
- measured glucose
- lag/history features

This is a prototype only. It is not diagnostic or treatment-guiding.

## 3. Server Install Notes

Linux/macOS:

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell:

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 4. Input Contract

Signal:

- `.npy` file
- 1D single-channel PPG
- 15 minutes
- 500 Hz
- 450000 samples
- arrays shaped `(N, 1)` or `(1, N)` are flattened
- multi-channel arrays are rejected

Demographics JSON required fields:

- `age` or `demo_age`
- `sex` or `demo_sex`
- `bmi` or `demo_bmi`
- `preop_dm` or `demo_preop_dm`

Demographics JSON optional fields:

- `preop_hb` or `demo_preop_hb`
- `preop_cr` or `demo_preop_cr`

Forbidden fields:

- `preop_gluc`
- `demo_preop_gluc`
- `glucose`
- `glucose_mgdl`

## 5. Example Demographics JSON

```json
{
  "age": 62,
  "sex": "M",
  "bmi": 27.5,
  "preop_dm": false,
  "preop_hb": 13.2,
  "preop_cr": 0.9
}
```

## 6. Command Example

```bash
python -m src.inference.predict \
  --signal /path/to/window.npy \
  --demographics /path/to/demo.json \
  --output /path/to/prediction.json \
  --model-dir models/bgl_catboost_current_ppg_demo_no_preop
```

## 7. Expected Output JSON Shape

```json
{
  "model_name": "bgl_catboost_current_ppg_demo_no_preop",
  "model_version": "20260501T165537Z",
  "input": {
    "signal_path": "/path/to/window.npy",
    "demographics_path": "/path/to/demo.json",
    "fs_hz": 500,
    "window_seconds": 900,
    "n_samples": 450000
  },
  "prediction": {
    "class_index": 0,
    "label": "low",
    "probabilities": {
      "low": 0.7,
      "elevated": 0.2,
      "hyper": 0.1
    }
  },
  "quality": {
    "n_subwindows_attempted": 59,
    "n_subwindows_used": 55,
    "mean_sqi": 0.91,
    "min_sqi": 0.82
  },
  "warnings": []
}
```

## 8. Error Behavior

The CLI exits non-zero on:

- invalid signal shape or length
- missing demographics
- forbidden glucose fields
- no clean SQI-gated subwindows
- missing final features
- model-load failure

When possible, the CLI writes an error JSON to `--output`:

```json
{
  "error": {
    "message": "No clean SQI-gated subwindows survived feature extraction."
  }
}
```

Synthetic or flat signals may fail quality gating. That is expected and should not be treated as a deployment failure.

## 9. Backend Integration Note

David's Node/Express endpoint should:

- save the incoming PPG window to a temporary `.npy` file
- save demographics to a temporary JSON file
- spawn the CLI subprocess
- read `prediction.json`
- store prediction, probabilities, and quality metadata in SQLite
- delete temporary input files after completion
- not call the old training command

## 10. Current Validation Status

- Full pytest: `227 passed`, `29 warnings`
- Synthetic flat signal smoke test failed quality gating as expected.
- A real PPG smoke test is still recommended before the live demo.

## 11. Current Model Metrics

CatBoost current-window deployment model:

- `macro_f1=0.3572`
- `f1_hyper=0.1613`
- `off_by_one_accuracy=0.7571`
- `dangerous_misclassification_rate=0.2429`
- bootstrap `macro_f1` CI `[0.2834, 0.4336]`
- bootstrap `hyper_f1` CI `[0.0345, 0.2857]`

## 12. Limitation Statement

This is a prototype zone classifier for integrated-system demonstration. It is not clinically validated, not diagnostic, and should not be used to guide insulin, diet, medication, or medical decisions.
