# PPG → Glucose Pipeline (VitalDB)

## Quick setup

### 1. Open this folder in VS Code
```
File → Open Folder → select ppg_glucose/
```

### 2. Copy your VitalDB data into data/vitaldb/
You need these files inside `data/vitaldb/`:
```
data/vitaldb/
├── 184.npy
├── 241.npy
├── 626.npy
├── ... (all 20 .npy files)
├── 6337.npy
├── final_glucose.csv
├── selected_demographics.csv
├── download_log.csv
└── final_cases.csv
```

### 3. Create a virtual environment and install packages
Open a terminal in VS Code (Ctrl+`) and run:
```bash
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

### 4. Test the setup
```bash
python -c "import numpy, pandas, scipy, sklearn, PyEMD, catboost, xgboost, lightgbm; print('All packages OK')"
```

### 5. Start implementing
Work through the pipeline scripts in order:
- `src/a_preprocessing/load_vitaldb.py`  (Step 2)
- `src/a_preprocessing/preprocess.py`     (Step 3)
- `src/a_preprocessing/verify_signals.py` (Step 4)
- `src/b_features/summary_stats.py`       (Step 5)
- `src/b_features/morphology_prv.py`      (Step 6)
- `src/b_features/emd_imf.py`             (Step 7)
- `src/b_features/build_master.py`        (Step 8)
- `src/c_selection/select_features.py`    (Step 9)
- `src/d_training/split.py`              (Step 10)
- `src/d_training/train.py`              (Step 11)
- `src/d_training/evaluate.py`           (Step 12)
