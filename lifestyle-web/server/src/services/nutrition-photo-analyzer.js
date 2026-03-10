const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.NUT_MODEL_TIMEOUT_MS, 10) || 15000;
const DEFAULT_PYTHON_BIN = process.env.NUT_MODEL_PYTHON_BIN || 'python';
const DEFAULT_SCRIPT_PATH =
  process.env.NUT_MODEL_SCRIPT ||
  path.resolve(__dirname, '..', '..', 'NUT_model', 'predict.py');
const DEFAULT_MODEL_PATH =
  process.env.NUT_MODEL_WEIGHTS ||
  path.resolve(__dirname, '..', '..', 'NUT_model', 'canet_NUT.pth');
const DEFAULT_LABELS_PATH =
  process.env.NUT_MODEL_LABELS ||
  path.resolve(__dirname, '..', '..', 'NUT_model', 'foodseg103_labels.json');
const SETUP_CACHE_TTL_MS = Number.parseInt(process.env.NUT_MODEL_SETUP_CACHE_TTL_MS, 10) || 60000;

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
  labelsPath,
  imagePath = null,
  selfCheck = false,
}) {
  const args = [scriptPath];
  if (selfCheck) {
    args.push('--self-check');
  }
  if (imagePath) {
    args.push('--image', imagePath);
  }
  args.push('--model', modelPath, '--labels', labelsPath);
  return args;
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
        .map((entry) => {
          const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
          if (!name) {
            return null;
          }
          return {
            name,
            confidence: normalizeNumericValue(entry.confidence, 4),
          };
        })
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
    confidence: normalizeNumericValue(parsed.confidence, 4),
    calories: normalizeNumericValue(parsed.calories, 0),
    protein: normalizeNumericValue(parsed.protein, 1),
    carbs: normalizeNumericValue(parsed.carbs, 1),
    fats: normalizeNumericValue(parsed.fats, 1),
    weightAmount: normalizeNumericValue(parsed.weightAmount, 1),
    weightUnit: typeof parsed.weightUnit === 'string' ? parsed.weightUnit.trim().toLowerCase() : null,
    topMatches,
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
  const stderr = String(error?.stderr || '').trim();
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
  await ensureFileExists(scriptPath, 'predict.py');
  await ensureFileExists(modelPath, 'model weights');
  await ensureFileExists(labelsPath, 'label map');

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

async function analyzeNutritionPhoto({
  photoData,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pythonBin = DEFAULT_PYTHON_BIN,
  scriptPath = DEFAULT_SCRIPT_PATH,
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

  await verifyNutritionPhotoModelSetup({
    timeoutMs,
    pythonBin,
    scriptPath,
    modelPath,
    labelsPath,
  });

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
