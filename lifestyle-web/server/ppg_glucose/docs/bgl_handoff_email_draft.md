Subject: BGL inference CLI handoff

Hi David,

The BGL inference CLI is ready for the current-window deployment model. This replaces the old backend subprocess that kicked off training; the server should now call inference only.

Files/directories needed:

- `src/inference/predict.py`
- `models/bgl_catboost_current_ppg_demo_no_preop/`
- `requirements.txt`
- `examples/bgl/demo.example.json` as a demographics format reference

Command:

```bash
python -m src.inference.predict \
  --signal /path/to/window.npy \
  --demographics /path/to/demo.json \
  --output /path/to/prediction.json \
  --model-dir models/bgl_catboost_current_ppg_demo_no_preop
```

Input contract:

- signal is a 15-minute, 500 Hz, single-channel `.npy` PPG window with 450000 samples
- demographics JSON must include age, sex, BMI, and preop diabetes status
- optional demographics are preop haemoglobin and preop creatinine
- do not send preop glucose, measured glucose, or glucose_mgdl fields; the deployment model excludes glucose inputs

The output JSON contains the predicted BGL zone, probabilities for `low`, `elevated`, and `hyper`, plus signal-quality metadata from the SQI-gated subwindow extraction.

Important limitation: this is a prototype zone classifier for integrated-system demonstration. It is not clinically validated, not diagnostic, and must not be used to guide insulin, diet, medication, or medical decisions.

Happy to help test the endpoint with a real 15-minute PPG window before the live demo.
