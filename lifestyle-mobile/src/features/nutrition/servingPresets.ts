export type NutritionServingSource = {
  serving?: string | null;
  prefill?: {
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fats?: number | null;
    fiber?: number | null;
    weightAmount?: number | null;
    weightUnit?: string | null;
  };
};

export type NutritionServingPreset = {
  id: string;
  label: string;
  amount: number;
  unit: 'g' | 'ml';
};

type NutritionServingScale = {
  calories: string;
  protein: string;
  carbs: string;
  fats: string;
  fiber: string;
  weightAmount: string;
  weightUnit: string;
};

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function pushPreset(
  presets: NutritionServingPreset[],
  seen: Set<string>,
  preset: NutritionServingPreset | null
) {
  if (!preset || !Number.isFinite(preset.amount) || preset.amount <= 0) {
    return;
  }
  const normalizedAmount = roundToOneDecimal(preset.amount);
  const key = `${preset.unit}:${normalizedAmount}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  presets.push({ ...preset, amount: normalizedAmount });
}

export function buildServingPresets(
  source: NutritionServingSource | null | undefined
): NutritionServingPreset[] {
  const baseAmount = Number(source?.prefill?.weightAmount);
  const baseUnit = source?.prefill?.weightUnit === 'ml' ? 'ml' : source?.prefill?.weightUnit === 'g' ? 'g' : null;
  if (!Number.isFinite(baseAmount) || baseAmount <= 0 || !baseUnit) {
    return [];
  }
  const presets: NutritionServingPreset[] = [];
  const seen = new Set<string>();
  const servingLabel = source?.serving?.trim();

  pushPreset(presets, seen, {
    id: 'serving-base',
    label: servingLabel || `${roundToOneDecimal(baseAmount)} ${baseUnit}`,
    amount: baseAmount,
    unit: baseUnit,
  });

  if (baseUnit === 'g') {
    pushPreset(presets, seen, {
      id: 'serving-100g',
      label: '100 g',
      amount: 100,
      unit: 'g',
    });
    pushPreset(presets, seen, {
      id: 'serving-oz',
      label: '1 oz',
      amount: 28.35,
      unit: 'g',
    });
  } else {
    pushPreset(presets, seen, {
      id: 'serving-100ml',
      label: '100 ml',
      amount: 100,
      unit: 'ml',
    });
    pushPreset(presets, seen, {
      id: 'serving-tbsp',
      label: '1 tbsp',
      amount: 15,
      unit: 'ml',
    });
    pushPreset(presets, seen, {
      id: 'serving-cup',
      label: '1 cup',
      amount: 240,
      unit: 'ml',
    });
    pushPreset(presets, seen, {
      id: 'serving-floz',
      label: '8 fl oz',
      amount: 236.6,
      unit: 'ml',
    });
  }

  return presets;
}

export function scaleNutritionToServing(
  source: NutritionServingSource | null | undefined,
  preset: NutritionServingPreset | null | undefined
): NutritionServingScale | null {
  const baseAmount = Number(source?.prefill?.weightAmount);
  const baseUnit = source?.prefill?.weightUnit === 'ml' ? 'ml' : source?.prefill?.weightUnit === 'g' ? 'g' : null;
  if (!preset || !Number.isFinite(baseAmount) || baseAmount <= 0 || !baseUnit || preset.unit !== baseUnit) {
    return null;
  }
  const ratio = preset.amount / baseAmount;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }
  const scaleMacro = (value?: number | null, decimals = true) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '';
    }
    const nextValue = value * ratio;
    return String(decimals ? roundToOneDecimal(nextValue) : Math.round(nextValue));
  };
  return {
    calories: scaleMacro(source?.prefill?.calories, false),
    protein: scaleMacro(source?.prefill?.protein),
    carbs: scaleMacro(source?.prefill?.carbs),
    fats: scaleMacro(source?.prefill?.fats),
    fiber: scaleMacro(source?.prefill?.fiber),
    weightAmount: String(roundToOneDecimal(preset.amount)),
    weightUnit: preset.unit,
  };
}
