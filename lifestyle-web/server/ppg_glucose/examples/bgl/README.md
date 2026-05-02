# BGL Inference Example

Run current-window BGL inference with a 15-minute PPG window saved as `.npy`:

```powershell
python -m src.inference.predict `
  --signal path\to\window.npy `
  --demographics examples\bgl\demo.example.json `
  --output prediction.json
```

The model expects a single-channel 1D PPG array with 450000 samples at 500 Hz.
Arrays shaped `(N, 1)` or `(1, N)` are flattened safely.

Bundled smoke-test input:

```bash
python -m src.inference.predict \
  --signal examples/bgl/demo.signal.npy \
  --demographics examples/bgl/demo.example.json \
  --output prediction.json \
  --no-strict-length
```

`examples/bgl/demo.signal.npy` is a short synthetic signal used only for the
integrated demo button and repo smoke tests. It is not a clinically realistic
15-minute deployment input.

To create a dummy shape-test file locally:

```powershell
@'
import numpy as np
fs = 500
t = np.arange(15 * 60 * fs) / fs
signal = 0.5 * np.sin(2 * np.pi * 1.2 * t)
np.save("window_dummy.npy", signal.astype("float32"))
'@ | python -
```

Synthetic PPG can fail pyPPG quality gates and is only useful for checking file
shape and CLI wiring. A successful clinical-style prediction needs a real
quality-gated 15-minute PPG window.
