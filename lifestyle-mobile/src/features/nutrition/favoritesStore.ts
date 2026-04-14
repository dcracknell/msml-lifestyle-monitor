import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NutritionSuggestion } from '../../api/types';

const FAVORITES_STORAGE_KEY = 'msml:nutrition:favorites';
const FAVORITES_LIMIT = 12;

function buildStorageKey(userId?: number | null) {
  return `${FAVORITES_STORAGE_KEY}:${userId || 'anonymous'}`;
}

function normalizeSuggestionKey(suggestion: NutritionSuggestion) {
  const barcode = suggestion.barcode?.trim() || suggestion.prefill?.barcode?.trim() || '';
  const name = suggestion.name.trim().toLowerCase();
  return `${barcode}:${name}`;
}

function sanitizeSuggestion(suggestion: NutritionSuggestion): NutritionSuggestion | null {
  const name = suggestion.name.trim();
  if (!name) {
    return null;
  }
  return {
    id: suggestion.id || `favorite-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    source: suggestion.source || 'Favorite',
    barcode: suggestion.barcode?.trim() || suggestion.prefill?.barcode?.trim() || null,
    serving: suggestion.serving || null,
    prefill: suggestion.prefill
      ? {
          type: suggestion.prefill.type,
          calories: suggestion.prefill.calories ?? null,
          protein: suggestion.prefill.protein ?? null,
          carbs: suggestion.prefill.carbs ?? null,
          fats: suggestion.prefill.fats ?? null,
          fiber: suggestion.prefill.fiber ?? null,
          weightAmount: suggestion.prefill.weightAmount ?? null,
          weightUnit: suggestion.prefill.weightUnit ?? null,
          barcode: suggestion.prefill.barcode ?? null,
        }
      : undefined,
  };
}

export async function readNutritionFavorites(userId?: number | null): Promise<NutritionSuggestion[]> {
  if (!userId) {
    return [];
  }
  try {
    const raw = await AsyncStorage.getItem(buildStorageKey(userId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => sanitizeSuggestion(entry))
      .filter((entry): entry is NutritionSuggestion => entry !== null)
      .slice(0, FAVORITES_LIMIT);
  } catch {
    return [];
  }
}

async function writeNutritionFavorites(
  userId: number,
  suggestions: NutritionSuggestion[]
): Promise<NutritionSuggestion[]> {
  const sanitized = suggestions
    .map((suggestion) => sanitizeSuggestion(suggestion))
    .filter((entry): entry is NutritionSuggestion => entry !== null)
    .slice(0, FAVORITES_LIMIT);
  try {
    await AsyncStorage.setItem(buildStorageKey(userId), JSON.stringify(sanitized));
  } catch {
    // Ignore storage failures and still return the in-memory result.
  }
  return sanitized;
}

export async function toggleNutritionFavorite(
  userId: number | null | undefined,
  suggestion: NutritionSuggestion
): Promise<NutritionSuggestion[]> {
  if (!userId) {
    return [];
  }
  const sanitized = sanitizeSuggestion(suggestion);
  if (!sanitized) {
    return readNutritionFavorites(userId);
  }
  const existing = await readNutritionFavorites(userId);
  const targetKey = normalizeSuggestionKey(sanitized);
  const alreadySaved = existing.some((entry) => normalizeSuggestionKey(entry) === targetKey);
  if (alreadySaved) {
    return writeNutritionFavorites(
      userId,
      existing.filter((entry) => normalizeSuggestionKey(entry) !== targetKey)
    );
  }
  return writeNutritionFavorites(userId, [sanitized, ...existing]);
}

export function isNutritionFavorite(
  favorites: NutritionSuggestion[],
  suggestion: NutritionSuggestion | null | undefined
) {
  if (!suggestion) {
    return false;
  }
  const targetKey = normalizeSuggestionKey(suggestion);
  return favorites.some((entry) => normalizeSuggestionKey(entry) === targetKey);
}
