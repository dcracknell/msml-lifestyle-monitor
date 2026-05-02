BGL inference handoff package
=============================

Setup
-----
From the package root:

  python -m venv venv
  source venv/bin/activate
  pip install -r requirements_bgl_inference.txt

Windows PowerShell equivalent:

  python -m venv venv
  venv\Scripts\Activate.ps1
  pip install -r requirements_bgl_inference.txt

Inference command
-----------------
  python -m src.inference.predict \
    --signal /path/to/window.npy \
    --demographics /path/to/demo.json \
    --output /path/to/prediction.json \
    --model-dir models/bgl_catboost_current_ppg_demo_no_preop

Prototype warning
-----------------
This is a prototype zone classifier for integrated-system demonstration. It is
not clinically validated, not diagnostic, and must not be used to guide insulin,
diet, medication, or medical decisions.

Signal note
-----------
The model expects a real 15-minute, 500 Hz, single-channel PPG window saved as
.npy with 450000 samples. Synthetic or flat signals may fail pyPPG/SQI quality
gating; that is expected and does not mean the CLI is broken.
