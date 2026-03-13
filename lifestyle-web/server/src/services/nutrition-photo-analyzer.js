const { execFile } = require('child_process');
const fsSync = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function parseIntegerEnv(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

// ── MODE SWITCH ───────────────────────────────────────────────────────────────
// HIGH ACCURACY (default): spawns a fresh Python process per request.
//   Slower (~30-45 s) but self-contained — no extra process needed.
//
// EXPRESS MODE: set NUT_EXPRESS_MODE=true in your .env and start nut_server.py
//   alongside Node.  Model stays loaded in memory; USDA lookups run in parallel.
//   Typical latency: ~3-8 s after the first warm-up request.
//
//   Start the worker:
//     /path/to/NUT_model/.venv/bin/python NUT_model/nut_server.py
//
//   To revert: remove NUT_EXPRESS_MODE (or set to false) and stop nut_server.py.
// ──────────────────────────────────────────────────────────────────────────────
const NUT_EXPRESS_MODE = process.env.NUT_EXPRESS_MODE === 'true';
const NUT_EXPRESS_URL = (process.env.NUT_EXPRESS_URL || 'http://localhost:8001').replace(/\/$/, '');

const DEFAULT_TIMEOUT_MS = parseIntegerEnv(process.env.NUT_MODEL_TIMEOUT_MS, 45000, {
  min: 1000,
  max: 300000,
});
const DEFAULT_IMAGE_SIZE = parseIntegerEnv(process.env.NUT_MODEL_IMAGE_SIZE, 320, {
  min: 128,
  max: 1024,
});
const LOCAL_VENV_PYTHON = path.resolve(__dirname, '..', '..', 'NUT_model', '.venv', 'bin', 'python');
const LOCAL_VENV_WINDOWS_PYTHON = path.resolve(
  __dirname,
  '..',
  '..',
  'NUT_model',
  '.venv',
  'Scripts',
  'python.exe'
);
const DEFAULT_PYTHON_BIN =
  process.env.NUT_MODEL_PYTHON_BIN ||
  (fsSync.existsSync(LOCAL_VENV_PYTHON)
    ? LOCAL_VENV_PYTHON
    : fsSync.existsSync(LOCAL_VENV_WINDOWS_PYTHON)
      ? LOCAL_VENV_WINDOWS_PYTHON
      : 'python');
const DEFAULT_SCRIPT_PATH =
  process.env.NUT_MODEL_SCRIPT ||
  path.resolve(__dirname, '..', '..', 'NUT_model', 'nut_estimator.py');
const DEFAULT_MODEL_PATH =
  process.env.NUT_MODEL_WEIGHTS ||
  path.resolve(__dirname, '..', '..', 'NUT_model', 'checkpoint', 'canet_NUT.pth');
const DEFAULT_LABELS_PATH =
  process.env.NUT_MODEL_LABELS ||
  path.resolve(__dirname, '..', '..', 'data', 'FoodSeg103', 'category_id.txt');
const SETUP_CACHE_TTL_MS = parseIntegerEnv(
  process.env.NUT_MODEL_SETUP_CACHE_TTL_MS,
  60 * 60 * 1000,
  { min: 1000, max: 24 * 60 * 60 * 1000 }
);

let setupCheckCache = {
  checkedAt: 0,
  result: null,
  error: null,
  inflight: null,
};

class NutritionPhotoAnalysisError extends Error {
  constructor(message, { status = 502, code = 'PHOTO_ANALYSIS_FAILED' } = {}) {
    super(message);
    this.name = 'NutritionPhotoAnalysisError';
    this.status = status;
    this.code = code;
  }
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeNumericValue(value, digits = 1) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (!isFiniteNumber(value)) {
    return null;
  }
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}

function normalizeBase64Photo(photoData) {
  if (typeof photoData !== 'string') {
    return '';
  }
  const trimmed = photoData.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('data:image')) {
    return trimmed.split(',').pop() || '';
  }
  return trimmed;
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function buildCommandArgs({
  scriptPath,
  modelPath,
  labelsPath = null,
  imagePath = null,
  imageSize = null,
  selfCheck = false,
  json = true,
}) {
  const args = [scriptPath];
  if (json) {
    args.push('--json');
  }
  if (selfCheck) {
    args.push('--self-check');
  }
  if (imagePath) {
    args.push('--image', imagePath);
    if (Number.isFinite(Number(imageSize)) && Number(imageSize) > 0) {
      args.push('--image-size', String(Math.trunc(Number(imageSize))));
    }
  }
  args.push('--model', modelPath);
  if (labelsPath) {
    args.push('--labels', labelsPath);
  }
  return args;
}

function normalizeWeightUnit(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeDetectedFoodEntry(entry) {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
  if (!name) {
    return null;
  }
  return {
    name,
    confidence: normalizeNumericValue(entry.confidence, 4),
    portionPercent: normalizeNumericValue(entry.portionPercent, 2),
    calories: normalizeNumericValue(entry.calories, 2),
    protein: normalizeNumericValue(entry.protein, 2),
    carbs: normalizeNumericValue(entry.carbs, 2),
    fats: normalizeNumericValue(entry.fats, 2),
    fiber: normalizeNumericValue(entry.fiber, 2),
    weightAmount: normalizeNumericValue(entry.weightAmount ?? entry.massG, 2),
    weightUnit: normalizeWeightUnit(entry.weightUnit),
  };
}

function normalizeSetupPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new NutritionPhotoAnalysisError('NUT model setup check returned an invalid response.', {
      status: 502,
      code: 'NUT_SETUP_INVALID_RESPONSE',
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NutritionPhotoAnalysisError('NUT model setup check returned an invalid response.', {
      status: 502,
      code: 'NUT_SETUP_INVALID_RESPONSE',
    });
  }

  return {
    ready: parsed.ready !== false,
    checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : new Date().toISOString(),
    pythonVersion: typeof parsed.pythonVersion === 'string' ? parsed.pythonVersion : null,
    torchVersion: typeof parsed.torchVersion === 'string' ? parsed.torchVersion : null,
    torchvisionVersion: typeof parsed.torchvisionVersion === 'string' ? parsed.torchvisionVersion : null,
    pillowVersion: typeof parsed.pillowVersion === 'string' ? parsed.pillowVersion : null,
    labelsCount: Number.isFinite(Number(parsed.labelsCount)) ? Number(parsed.labelsCount) : null,
    checkpointEpoch: Number.isFinite(Number(parsed.checkpointEpoch))
      ? Number(parsed.checkpointEpoch)
      : null,
    clsHeadClasses: Number.isFinite(Number(parsed.clsHeadClasses)) ? Number(parsed.clsHeadClasses) : null,
    segHeadClasses: Number.isFinite(Number(parsed.segHeadClasses)) ? Number(parsed.segHeadClasses) : null,
    modelPath: typeof parsed.modelPath === 'string' ? parsed.modelPath : null,
    modelFileName: typeof parsed.modelFileName === 'string' ? parsed.modelFileName : null,
    modelSizeBytes: Number.isFinite(Number(parsed.modelSizeBytes))
      ? Number(parsed.modelSizeBytes)
      : null,
    modelSha256: typeof parsed.modelSha256 === 'string' ? parsed.modelSha256 : null,
    labelsPath: typeof parsed.labelsPath === 'string' ? parsed.labelsPath : null,
    labelsFileName: typeof parsed.labelsFileName === 'string' ? parsed.labelsFileName : null,
    labelsSizeBytes: Number.isFinite(Number(parsed.labelsSizeBytes))
      ? Number(parsed.labelsSizeBytes)
      : null,
    labelsSha256: typeof parsed.labelsSha256 === 'string' ? parsed.labelsSha256 : null,
  };
}

function parsePredictionPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new NutritionPhotoAnalysisError('NUT model returned an invalid response.', {
      status: 502,
      code: 'PHOTO_ANALYSIS_INVALID_RESPONSE',
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NutritionPhotoAnalysisError('NUT model returned an invalid response.', {
      status: 502,
      code: 'PHOTO_ANALYSIS_INVALID_RESPONSE',
    });
  }

  const topMatches = Array.isArray(parsed.topMatches)
    ? parsed.topMatches
        .map((entry) => normalizeDetectedFoodEntry(entry))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const detectedFoods = Array.isArray(parsed.detectedFoods)
    ? parsed.detectedFoods
        .map((entry) => normalizeDetectedFoodEntry(entry))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const rawMealAnalysis =
    parsed.mealAnalysis && typeof parsed.mealAnalysis === 'object' && !Array.isArray(parsed.mealAnalysis)
      ? parsed.mealAnalysis
      : null;
  const mealItems = Array.isArray(rawMealAnalysis?.items)
    ? rawMealAnalysis.items.map((entry) => normalizeDetectedFoodEntry(entry)).filter(Boolean)
    : detectedFoods;
  const mealAnalysis = rawMealAnalysis
    ? {
        foodCount: Number.isFinite(Number(rawMealAnalysis.foodCount))
          ? Math.max(0, Math.trunc(Number(rawMealAnalysis.foodCount)))
          : mealItems.length,
        totalCalories: normalizeNumericValue(rawMealAnalysis.totalCalories, 2),
        totalProtein: normalizeNumericValue(rawMealAnalysis.totalProtein, 2),
        totalCarbs: normalizeNumericValue(rawMealAnalysis.totalCarbs, 2),
        totalFats: normalizeNumericValue(rawMealAnalysis.totalFats, 2),
        totalFiber: normalizeNumericValue(rawMealAnalysis.totalFiber, 2),
        totalWeightAmount: normalizeNumericValue(rawMealAnalysis.totalWeightAmount, 2),
        weightUnit: normalizeWeightUnit(rawMealAnalysis.weightUnit) || 'g',
        plateDetected: rawMealAnalysis.plateDetected !== false,
        plateDiameterPx: normalizeNumericValue(rawMealAnalysis.plateDiameterPx, 0),
        mmPerPixel: normalizeNumericValue(rawMealAnalysis.mmPerPixel, 4),
        items: mealItems,
      }
    : mealItems.length
      ? {
          foodCount: mealItems.length,
          totalCalories: normalizeNumericValue(parsed.calories, 2),
          totalProtein: normalizeNumericValue(parsed.protein, 2),
          totalCarbs: normalizeNumericValue(parsed.carbs, 2),
          totalFats: normalizeNumericValue(parsed.fats, 2),
          totalFiber: normalizeNumericValue(parsed.fiber, 2),
          totalWeightAmount: normalizeNumericValue(parsed.weightAmount, 2),
          weightUnit: normalizeWeightUnit(parsed.weightUnit) || 'g',
          plateDetected: false,
          plateDiameterPx: null,
          mmPerPixel: null,
          items: mealItems,
        }
      : null;

  return {
    name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
    confidence: normalizeNumericValue(parsed.confidence, 4),
    isReliable: parsed.isReliable !== false,
    reliabilityThreshold: normalizeNumericValue(parsed.reliabilityThreshold, 4),
    reliabilityReason:
      typeof parsed.reliabilityReason === 'string' ? parsed.reliabilityReason.trim() : null,
    calories: normalizeNumericValue(parsed.calories, 0),
    protein: normalizeNumericValue(parsed.protein, 1),
    carbs: normalizeNumericValue(parsed.carbs, 1),
    fats: normalizeNumericValue(parsed.fats, 1),
    fiber: normalizeNumericValue(parsed.fiber, 1),
    weightAmount: normalizeNumericValue(parsed.weightAmount, 1),
    weightUnit: typeof parsed.weightUnit === 'string' ? parsed.weightUnit.trim().toLowerCase() : null,
    topMatches,
    detectedFoods,
    mealAnalysis,
  };
}

async function ensureFileExists(targetPath, label) {
  try {
    await fs.access(targetPath);
  } catch (error) {
    throw new NutritionPhotoAnalysisError(
      `NUT model is not configured: missing ${label} at ${targetPath}.`,
      {
        status: 503,
        code: 'NUT_MODEL_NOT_CONFIGURED',
      }
    );
  }
}

function mapExecutionError(
  error,
  fallbackMessage,
  fallbackCode = 'PHOTO_ANALYSIS_FAILED',
  pythonBin = DEFAULT_PYTHON_BIN,
  timeoutMessage = 'Meal photo analysis timed out.',
  timeoutCode = 'PHOTO_ANALYSIS_TIMEOUT'
) {
  if (error instanceof NutritionPhotoAnalysisError) {
    return error;
  }
  const stderr = String(error?.stderr || '').trim();
  const combinedMessage = `${stderr} ${String(error?.message || '').trim()}`.trim();
  if (/cannot identify image file/i.test(combinedMessage)) {
    return new NutritionPhotoAnalysisError(
      'Unsupported or corrupted image format. Use a JPG or PNG photo and try again.',
      {
        status: 400,
        code: 'PHOTO_UNSUPPORTED_FORMAT',
      }
    );
  }
  if (error?.code === 'ENOENT') {
    return new NutritionPhotoAnalysisError(
      `Python runtime not found: ${pythonBin}. Install the NUT model dependencies first.`,
      {
        status: 503,
        code: 'NUT_RUNTIME_MISSING',
      }
    );
  }
  if (error?.killed || error?.signal === 'SIGTERM') {
    return new NutritionPhotoAnalysisError(timeoutMessage, {
      status: 504,
      code: timeoutCode,
    });
  }
  return new NutritionPhotoAnalysisError(stderr || error?.message || fallbackMessage, {
    status: 502,
    code: fallbackCode,
  });
}

async function runSetupCheck({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pythonBin = DEFAULT_PYTHON_BIN,
  scriptPath = DEFAULT_SCRIPT_PATH,
  modelPath = DEFAULT_MODEL_PATH,
  labelsPath = DEFAULT_LABELS_PATH,
} = {}) {
  await ensureFileExists(scriptPath, 'inference script');
  await ensureFileExists(modelPath, 'model weights');
  if (labelsPath) {
    await ensureFileExists(labelsPath, 'label map');
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      buildCommandArgs({
        scriptPath,
        modelPath,
        labelsPath,
        selfCheck: true,
      }),
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }
    );

    const trimmedOutput = String(stdout || '').trim();
    if (!trimmedOutput) {
      throw new NutritionPhotoAnalysisError(
        String(stderr || '').trim() || 'NUT model setup check returned no output.',
        {
          status: 502,
          code: 'NUT_SETUP_EMPTY',
        }
      );
    }

    return normalizeSetupPayload(trimmedOutput);
  } catch (error) {
    throw mapExecutionError(
      error,
      'Unable to verify the NUT model setup.',
      'NUT_SETUP_FAILED',
      pythonBin,
      'NUT model setup check timed out.',
      'NUT_SETUP_TIMEOUT'
    );
  }
}

async function verifyNutritionPhotoModelSetup(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();

  if (
    !forceRefresh &&
    setupCheckCache.result &&
    setupCheckCache.checkedAt &&
    now - setupCheckCache.checkedAt < SETUP_CACHE_TTL_MS
  ) {
    return setupCheckCache.result;
  }

  if (
    !forceRefresh &&
    setupCheckCache.error &&
    setupCheckCache.checkedAt &&
    now - setupCheckCache.checkedAt < SETUP_CACHE_TTL_MS
  ) {
    throw setupCheckCache.error;
  }

  if (setupCheckCache.inflight) {
    return setupCheckCache.inflight;
  }

  setupCheckCache.inflight = runSetupCheck(options)
    .then((result) => {
      setupCheckCache = {
        checkedAt: Date.now(),
        result,
        error: null,
        inflight: null,
      };
      return result;
    })
    .catch((error) => {
      setupCheckCache = {
        checkedAt: Date.now(),
        result: null,
        error,
        inflight: null,
      };
      throw error;
    });

  return setupCheckCache.inflight;
}

// ── Express mode: POST to the persistent nut_server.py worker ─────────────────
async function analyzeNutritionPhotoExpress({
  photoData,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  imageSize = DEFAULT_IMAGE_SIZE,
  modelPath = DEFAULT_MODEL_PATH,
  labelsPath = DEFAULT_LABELS_PATH,
} = {}) {
  const normalizedPhotoData = normalizeBase64Photo(photoData);
  if (!normalizedPhotoData) {
    throw new NutritionPhotoAnalysisError('Provide a valid meal photo.', {
      status: 400,
      code: 'PHOTO_REQUIRED',
    });
  }

  const imageBuffer = Buffer.from(normalizedPhotoData, 'base64');
  if (!imageBuffer.length) {
    throw new NutritionPhotoAnalysisError('Provide a valid meal photo.', {
      status: 400,
      code: 'PHOTO_REQUIRED',
    });
  }

  const tempFile = path.join(
    os.tmpdir(),
    `msml-nutrition-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );
  await fs.writeFile(tempFile, imageBuffer);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(`${NUT_EXPRESS_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: tempFile, imageSize, modelPath, labelsPath }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errBody = null;
      try {
        errBody = await response.json();
      } catch {}
      const msg = errBody?.error || `NUT worker responded with ${response.status}`;
      throw new NutritionPhotoAnalysisError(msg, { status: 502, code: 'PHOTO_ANALYSIS_FAILED' });
    }

    const raw = await response.json();
    // Re-use parsePredictionPayload so normalisation is identical to high-accuracy mode.
    return parsePredictionPayload(JSON.stringify(raw));
  } catch (error) {
    if (error instanceof NutritionPhotoAnalysisError) {
      throw error;
    }
    if (error?.name === 'AbortError') {
      throw new NutritionPhotoAnalysisError('Meal photo analysis timed out.', {
        status: 504,
        code: 'PHOTO_ANALYSIS_TIMEOUT',
      });
    }
    throw new NutritionPhotoAnalysisError(
      `NUT worker unavailable at ${NUT_EXPRESS_URL} — is nut_server.py running?`,
      { status: 503, code: 'NUT_WORKER_UNAVAILABLE' }
    );
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
}
// ──────────────────────────────────────────────────────────────────────────────

async function analyzeNutritionPhoto({
  photoData,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  imageSize = DEFAULT_IMAGE_SIZE,
  pythonBin = DEFAULT_PYTHON_BIN,
  scriptPath = DEFAULT_SCRIPT_PATH,
  modelPath = DEFAULT_MODEL_PATH,
  labelsPath = DEFAULT_LABELS_PATH,
} = {}) {
  // ── MODE SWITCH ─────────────────────────────────────────────────────────────
  // NUT_EXPRESS_MODE=true  → persistent worker (model in memory, USDA parallel)
  // default / false        → subprocess per request (high accuracy, no sidecar)
  if (NUT_EXPRESS_MODE) {
    return analyzeNutritionPhotoExpress({ photoData, timeoutMs, imageSize, modelPath, labelsPath });
  }
  // ────────────────────────────────────────────────────────────────────────────
  const normalizedPhotoData = normalizeBase64Photo(photoData);
  if (!normalizedPhotoData) {
    throw new NutritionPhotoAnalysisError('Provide a valid meal photo.', {
      status: 400,
      code: 'PHOTO_REQUIRED',
    });
  }

  await ensureFileExists(scriptPath, 'inference script');
  await ensureFileExists(modelPath, 'model weights');
  if (labelsPath) {
    await ensureFileExists(labelsPath, 'label map');
  }

  const imageBuffer = Buffer.from(normalizedPhotoData, 'base64');
  if (!imageBuffer.length) {
    throw new NutritionPhotoAnalysisError('Provide a valid meal photo.', {
      status: 400,
      code: 'PHOTO_REQUIRED',
    });
  }

  const tempFile = path.join(
    os.tmpdir(),
    `msml-nutrition-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );

  await fs.writeFile(tempFile, imageBuffer);

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      buildCommandArgs({
        scriptPath,
        imagePath: tempFile,
        imageSize,
        modelPath,
        labelsPath,
      }),
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }
    );

    const trimmedOutput = String(stdout || '').trim();
    if (!trimmedOutput) {
      throw new NutritionPhotoAnalysisError(
        String(stderr || '').trim() || 'NUT model did not return a prediction.',
        {
          status: 502,
          code: 'PHOTO_ANALYSIS_EMPTY',
        }
      );
    }

    return parsePredictionPayload(trimmedOutput);
  } catch (error) {
    throw mapExecutionError(
      error,
      'Unable to analyze the uploaded meal photo.',
      'PHOTO_ANALYSIS_FAILED',
      pythonBin
    );
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
}

module.exports = {
  analyzeNutritionPhoto,
  NutritionPhotoAnalysisError,
  verifyNutritionPhotoModelSetup,
};
