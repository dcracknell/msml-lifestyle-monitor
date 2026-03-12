import { useState, Dispatch, SetStateAction, useEffect, useRef, ReactNode } from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  TrendChart,
  RefreshableScrollView,
} from '../../components';
import { colors, fonts, spacing } from '../../theme';
import {
  nutritionRequest,
  saveMacroTargetsRequest,
  deleteNutritionEntryRequest,
  searchNutritionRequest,
  lookupNutritionRequest,
} from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { formatDate, formatNumber } from '../../utils/format';
import { useSyncQueue } from '../../providers/SyncProvider';
import { getImagePickerMissingMessage, getImagePickerModule } from '../../utils/imagePicker';
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
  BarcodeType,
} from 'expo-camera';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { NutritionEntry, NutritionLookupProduct, NutritionSuggestion } from '../../api/types';
import { fetchSuggestionsWithCache, readSuggestionCache } from './suggestionCache';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type EntryFormState = {
  name: string;
  type: 'Food' | 'Liquid';
  barcode: string;
  calories: string;
  protein: string;
  carbs: string;
  fats: string;
  weightAmount: string;
  weightUnit: string;
  photoData: string | null;
};

type AddFoodMode = 'menu' | 'search' | 'photo' | 'manual';

type PhotoDetectedFood = {
  id: string;
  name: string;
  confidence: number | null;
};

const PHOTO_DETECTED_MAX_ITEMS = 6;
const PHOTO_DETECTED_MIN_CONFIDENCE = 0.08;
const PHOTO_UNCERTAIN_CODE = 'PHOTO_ANALYSIS_UNCERTAIN';

const NUMERIC_BARCODE_TYPE_HINTS = [
  'ean13',
  'ean_13',
  'ean8',
  'ean_8',
  'upc_a',
  'upca',
  'upc_e',
  'upce',
  'itf14',
  'itf_14',
  'itf',
  'codabar',
];

function normalizeScannedBarcode(rawValue: unknown, type?: unknown) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) {
    return '';
  }
  const typeToken = String(type || '').toLowerCase();
  const digitsOnly = trimmed.replace(/\D+/g, '');
  const likelyNumericType = NUMERIC_BARCODE_TYPE_HINTS.some((hint) => typeToken.includes(hint));
  if (likelyNumericType && digitsOnly.length >= 8) {
    return digitsOnly;
  }
  if (digitsOnly.length >= 8 && digitsOnly.length >= trimmed.length - 4) {
    return digitsOnly;
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizePhotoDetectedFoods(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as PhotoDetectedFood[];
  }
  const foods: PhotoDetectedFood[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const item = asRecord(entry);
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    const confidenceRaw = Number(item?.confidence);
    const confidence =
      Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1
        ? Number(confidenceRaw.toFixed(4))
        : null;
    if (confidence !== null && confidence < PHOTO_DETECTED_MIN_CONFIDENCE) {
      return;
    }
    seen.add(key);
    foods.push({
      id: `photo-${index}-${key.replace(/\s+/g, '-')}`,
      name,
      confidence,
    });
  });
  return foods.slice(0, PHOTO_DETECTED_MAX_ITEMS);
}

function mapDetectedFoodToSuggestion(food: PhotoDetectedFood): NutritionSuggestion {
  const confidence =
    typeof food.confidence === 'number' ? `${Math.round(food.confidence * 100)}% confidence` : null;
  return {
    id: food.id,
    name: food.name,
    source: 'Photo analysis',
    serving: confidence,
  };
}

function parsePhotoUncertainError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 422) {
    return null;
  }
  const payload = asRecord(error.data);
  if (!payload || String(payload.code || '') !== PHOTO_UNCERTAIN_CODE) {
    return null;
  }
  const analysis = asRecord(payload.photoAnalysis);
  const detectedFoods = normalizePhotoDetectedFoods(analysis?.detectedFoods);
  const fallbackFoods = detectedFoods.length
    ? detectedFoods
    : normalizePhotoDetectedFoods(analysis?.topMatches);
  return {
    message:
      typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'Meal photo needs review before logging.',
    detectedFoods: fallbackFoods,
  };
}

export function NutritionScreen() {
  const { subjectId } = useSubject();
  const { user } = useAuth();
  const { runOrQueue } = useSyncQueue();
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [entryForm, setEntryForm] = useState<EntryFormState>({
    name: '',
    type: 'Food',
    barcode: '',
    calories: '',
    protein: '',
    carbs: '',
    fats: '',
    weightAmount: '',
    weightUnit: 'g',
    photoData: null,
  });
  const [addFoodModalVisible, setAddFoodModalVisible] = useState(false);
  const [addFoodMode, setAddFoodMode] = useState<AddFoodMode>('menu');
  const [macroExpanded, setMacroExpanded] = useState(false);
  const [macroForm, setMacroForm] = useState({ calories: '', protein: '', carbs: '', fats: '' });
  const [macroFeedback, setMacroFeedback] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const [photoDetectedFoods, setPhotoDetectedFoods] = useState<PhotoDetectedFood[]>([]);
  const [suggestions, setSuggestions] = useState<NutritionSuggestion[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState('Type at least 2 characters to see suggestions.');
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [entryFeedback, setEntryFeedback] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerFeedback, setScannerFeedback] = useState<string | null>(null);
  const [scannerProcessing, setScannerProcessing] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [historyPhoto, setHistoryPhoto] = useState<{ uri: string; name: string } | null>(null);
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const [iosPickerDate, setIosPickerDate] = useState(dayjs().toDate());
  const suggestionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeSuggestionRequest = useRef<symbol | null>(null);
  const mountedRef = useRef(true);
  const scannerLockRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (suggestionTimerRef.current) {
        clearTimeout(suggestionTimerRef.current);
      }
    };
  }, []);

  const requestSubject = subjectId && subjectId !== user?.id ? subjectId : undefined;
  const todayIso = dayjs().format('YYYY-MM-DD');
  const subjectKey = requestSubject || user?.id;

  useEffect(() => {
    setSelectedDate(dayjs().format('YYYY-MM-DD'));
  }, [subjectKey]);

  useEffect(() => {
    setIosPickerDate(dayjs(selectedDate).toDate());
  }, [selectedDate]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['nutrition', requestSubject || user?.id, selectedDate],
    queryFn: () => nutritionRequest({ athleteId: requestSubject, date: selectedDate }),
    enabled: Boolean(user?.id),
  });
  const isToday = selectedDate === todayIso;

  useEffect(() => {
    if (!data) {
      return;
    }
    const calorieGoal = data.goals?.targetCalories ?? data.goals?.calories;
    setMacroForm({
      calories: calorieGoal === null || calorieGoal === undefined ? '' : String(calorieGoal),
      protein: data.goals?.protein === null || data.goals?.protein === undefined ? '' : String(data.goals.protein),
      carbs: data.goals?.carbs === null || data.goals?.carbs === undefined ? '' : String(data.goals.carbs),
      fats: data.goals?.fats === null || data.goals?.fats === undefined ? '' : String(data.goals.fats),
    });
  }, [data]);

  if (isLoading || !data) {
    return <LoadingView />;
  }

  if (isError) {
    return <ErrorView message="Unable to load nutrition" onRetry={refetch} />;
  }

  const resolveSuggestionMessage = (items: NutritionSuggestion[]) =>
    items.length
      ? 'Tap a suggestion below to auto-fill the form.'
      : 'No matches yet. Try refining the name or scan a barcode.';

  const handleEntryChange = <K extends keyof EntryFormState>(key: K, value: EntryFormState[K]) => {
    setEntryForm((prev) => ({ ...prev, [key]: value }));
  };
  const resetEntryForm = () => {
    setEntryForm((prev) => ({
      name: '',
      type: prev.type,
      barcode: '',
      calories: '',
      protein: '',
      carbs: '',
      fats: '',
      weightAmount: '',
      weightUnit: prev.weightUnit,
      photoData: null,
    }));
  };
  const clearSuggestions = (message?: string) => {
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
    activeSuggestionRequest.current = null;
    setSuggestionLoading(false);
    setSuggestions([]);
    if (message) {
      setSuggestionStatus(message);
    }
  };

  const applyPhotoDetectedFoods = (foods: PhotoDetectedFood[], feedbackMessage?: string) => {
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
    activeSuggestionRequest.current = null;
    setSuggestionLoading(false);
    const limitedFoods = foods.slice(0, PHOTO_DETECTED_MAX_ITEMS);
    setPhotoDetectedFoods(limitedFoods);
    const photoSuggestions = limitedFoods.map(mapDetectedFoodToSuggestion);
    setSuggestions(photoSuggestions);
    if (feedbackMessage) {
      setSuggestionStatus(feedbackMessage);
      return;
    }
    if (photoSuggestions.length) {
      setSuggestionStatus(
        'Meal photo has multiple possible foods. Choose one or log all detected foods below.'
      );
      return;
    }
    setSuggestionStatus('Photo is unclear. Type a food name or try another image.');
  };

  const ensureScannerPermission = async () => {
    if (cameraPermission?.granted) {
      return true;
    }
    const response = await requestCameraPermission();
    return Boolean(response?.granted);
  };

  const handleOpenScanner = async () => {
    setScannerFeedback(null);
    const allowed = await ensureScannerPermission();
    if (!allowed) {
      setScannerFeedback('Camera permission is required to scan barcodes.');
      return;
    }
    scannerLockRef.current = false;
    setScannerProcessing(false);
    setScannerActive(true);
  };

  const handleCloseScanner = () => {
    setScannerActive(false);
    setScannerProcessing(false);
    scannerLockRef.current = false;
  };

  const scheduleSuggestionFetch = (value: string) => {
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      clearSuggestions('Type a food name to see suggestions.');
      return;
    }
    if (trimmed.length < 2) {
      clearSuggestions('Keep typing to see suggestions.');
      return;
    }
    suggestionTimerRef.current = setTimeout(() => {
      suggestionTimerRef.current = null;
      const requestToken = Symbol('suggestions');
      activeSuggestionRequest.current = requestToken;
      const cached = readSuggestionCache(trimmed);
      if (cached) {
        setSuggestions(cached.suggestions);
        setSuggestionStatus(
          cached.isStale
            ? cached.suggestions.length
              ? 'Refreshing suggestions...'
              : 'Searching for suggestions...'
            : resolveSuggestionMessage(cached.suggestions)
        );
      } else {
        setSuggestions([]);
        setSuggestionStatus('Searching for suggestions...');
      }
      setSuggestionLoading(true);
      const fetcher = () =>
        searchNutritionRequest(trimmed).then((payload) => payload?.suggestions || []);
      (async () => {
        try {
          const results = await fetchSuggestionsWithCache(trimmed, fetcher, {
            forceRefresh: true,
          });
          if (!mountedRef.current || activeSuggestionRequest.current !== requestToken) {
            return;
          }
          if (Array.isArray(results)) {
            setSuggestions(results);
            setSuggestionStatus(resolveSuggestionMessage(results));
          } else if (cached) {
            setSuggestionStatus('Network is slow. Showing recent results for now.');
          } else {
            setSuggestionStatus('Still searching... this is taking longer than expected.');
          }
        } catch (error) {
          if (!mountedRef.current || activeSuggestionRequest.current !== requestToken) {
            return;
          }
          if (!cached) {
            setSuggestions([]);
          }
          setSuggestionStatus(
            cached
              ? 'Unable to refresh suggestions. Showing recent results.'
              : error instanceof Error
                ? error.message
                : 'Unable to fetch suggestions right now.'
          );
        } finally {
          if (mountedRef.current && activeSuggestionRequest.current === requestToken) {
            setSuggestionLoading(false);
          }
        }
      })();
    }, 250);
  };

  const handleNameChange = (value: string) => {
    handleEntryChange('name', value);
    scheduleSuggestionFetch(value);
  };

  const applySuggestion = (suggestion?: NutritionSuggestion) => {
    if (!suggestion) return;
    handleEntryChange('name', suggestion.name);
    if (suggestion.barcode) {
      handleEntryChange('barcode', suggestion.barcode);
    }
    const prefill = suggestion.prefill;
    if (prefill) {
      handleEntryChange('type', prefill.type === 'Liquid' ? 'Liquid' : 'Food');
      const setNumericField = (
        key: keyof EntryFormState,
        value?: number | null,
        decimals?: boolean
      ) => {
        if (value === null || value === undefined || Number.isNaN(value)) return;
        const normalized = decimals ? Math.round(value * 10) / 10 : Math.round(value);
        handleEntryChange(key, String(normalized));
      };
      setNumericField('calories', prefill.calories);
      setNumericField('protein', prefill.protein);
      setNumericField('carbs', prefill.carbs);
      setNumericField('fats', prefill.fats);
      setNumericField('weightAmount', prefill.weightAmount, true);
      if (prefill.weightUnit) {
        handleEntryChange('weightUnit', prefill.weightUnit);
      }
      if (prefill.barcode) {
        handleEntryChange('barcode', prefill.barcode);
      }
    }
    clearSuggestions('Suggestion applied. Adjust anything before saving.');
  };

  const applyLookupProduct = (product?: NutritionLookupProduct | null) => {
    if (!product) return;
    if (product.name) {
      handleEntryChange('name', product.name);
    }
    if (product.barcode) {
      handleEntryChange('barcode', product.barcode);
    }
    const setNumericField = (
      key: keyof EntryFormState,
      value?: number | null,
      decimals?: boolean
    ) => {
      if (value === null || value === undefined || Number.isNaN(value)) {
        return;
      }
      const normalized = decimals ? Math.round(value * 10) / 10 : Math.round(value);
      handleEntryChange(key, String(normalized));
    };
    setNumericField('calories', product.calories);
    setNumericField('protein', product.protein);
    setNumericField('carbs', product.carbs);
    setNumericField('fats', product.fats);
    setNumericField('weightAmount', product.weightAmount, true);
    if (product.weightUnit) {
      handleEntryChange('weightUnit', product.weightUnit);
    }
  };

  const isFoodProduct = (product?: NutritionLookupProduct | null) => {
    if (!product || !product.name?.trim()) {
      return false;
    }
    const signals = [product.calories, product.protein, product.carbs, product.fats];
    if (signals.some((value) => typeof value === 'number' && Number.isFinite(value))) {
      return true;
    }
    return Boolean(product.barcode?.trim());
  };

  const formatSuggestionMeta = (suggestion: NutritionSuggestion) => {
    const parts: string[] = [];
    const calories = suggestion.prefill?.calories;
    if (typeof calories === 'number' && Number.isFinite(calories) && calories > 0) {
      parts.push(`${Math.round(calories)} kcal`);
    }
    if (suggestion.serving) {
      parts.push(suggestion.serving);
    }
    if (suggestion.source) {
      parts.push(suggestion.source);
    }
    return parts.join(' • ') || 'Suggestion';
  };

  const handleBarcodeDetected = async ({ data, type }: BarcodeScanningResult) => {
    if (scannerLockRef.current || scannerProcessing) {
      return;
    }
    const trimmed = normalizeScannedBarcode(data, type);
    if (!trimmed) {
      setScannerFeedback('Unable to read barcode. Try again.');
      return;
    }
    scannerLockRef.current = true;
    setScannerProcessing(true);
    setScannerFeedback('Barcode detected. Looking up nutrition info...');
    handleEntryChange('barcode', trimmed);
    try {
      const lookup = await lookupNutritionRequest({ barcode: trimmed });
      if (isFoodProduct(lookup.product)) {
        applyLookupProduct(lookup.product);
        setScannerFeedback('Food item detected! Values were added to the form.');
        setEntryFeedback('Nutrition data loaded from barcode—review before saving.');
        setScannerActive(false);
      } else {
        setScannerFeedback('Not a food item. Please try another barcode.');
        setEntryFeedback('Scanned barcode is not recognized as a food item.');
      }
    } catch (error) {
      setScannerFeedback(
        error instanceof Error ? error.message : 'Unable to fetch barcode details right now.'
      );
    } finally {
      setScannerProcessing(false);
      scannerLockRef.current = false;
    }
  };

  const handleMacroChange = (key: keyof typeof macroForm, value: string) => {
    setMacroForm((prev) => ({ ...prev, [key]: value }));
  };

  const adjustDate = (delta: number) => {
    setSelectedDate((prev) => {
      const next = dayjs(prev).add(delta, 'day');
      const today = dayjs();
      const target = next.isAfter(today, 'day') ? today : next;
      return target.format('YYYY-MM-DD');
    });
  };

  const handleJumpToToday = () => {
    setSelectedDate(todayIso);
  };

  const handleOpenDatePicker = () => {
    const baseDate = dayjs(selectedDate).toDate();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: baseDate,
        mode: 'date',
        maximumDate: new Date(),
        onChange: (event, date) => {
          if (event.type !== 'set' || !date) {
            return;
          }
          const formatted = dayjs(date).format('YYYY-MM-DD');
          const clamped = dayjs(formatted).isAfter(dayjs(), 'day') ? todayIso : formatted;
          setSelectedDate(clamped);
        },
      });
      return;
    }
    setIosPickerDate(baseDate);
    setIosPickerVisible(true);
  };

  const handleConfirmIosPicker = () => {
    setIosPickerVisible(false);
    const formatted = dayjs(iosPickerDate).format('YYYY-MM-DD');
    const clamped = dayjs(formatted).isAfter(dayjs(), 'day') ? todayIso : formatted;
    setSelectedDate(clamped);
  };

  const handleOpenAddFoodModal = (mode: AddFoodMode = 'menu') => {
    setEntryFeedback(null);
    setPhotoStatus(null);
    setScannerFeedback(null);
    setAddFoodMode(mode);
    setAddFoodModalVisible(true);
  };

  const handleCloseAddFoodModal = () => {
    setAddFoodModalVisible(false);
    setAddFoodMode('menu');
    setScannerFeedback(null);
    handleCloseScanner();
  };

  const handleBackToAddFoodMenu = () => {
    setAddFoodMode('menu');
    setScannerFeedback(null);
    handleCloseScanner();
  };

  const toggleSection = (setter: Dispatch<SetStateAction<boolean>>) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setter((prev) => !prev);
  };

  const asNumber = (value: string) => {
    if (!value.trim()) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const handleAddEntry = async () => {
    const trimmedName = entryForm.name.trim();
    const trimmedBarcode = entryForm.barcode.trim();
    if (!trimmedName && !trimmedBarcode && !entryForm.photoData) {
      setEntryFeedback('Enter a food name, barcode, or meal photo before logging.');
      return;
    }
    const payload = {
      name: trimmedName,
      type: entryForm.type,
      barcode: trimmedBarcode || undefined,
      calories: asNumber(entryForm.calories),
      protein: asNumber(entryForm.protein),
      carbs: asNumber(entryForm.carbs),
      fats: asNumber(entryForm.fats),
      weightAmount: asNumber(entryForm.weightAmount),
      weightUnit: entryForm.weightUnit.trim() || undefined,
      date: selectedDate,
      photoData: entryForm.photoData || undefined,
    };
    setEntryFeedback('Logging entry...');
    try {
      const result = await runOrQueue<{ message?: string }>({ endpoint: '/api/nutrition', payload });
      if (result.status === 'sent') {
        setEntryFeedback(result.result?.message || 'Entry saved.');
        refetch();
      } else {
        setEntryFeedback('Offline detected - entry queued and will sync automatically.');
      }
      resetEntryForm();
      setPhotoStatus(null);
      setPhotoDetectedFoods([]);
      clearSuggestions('Type at least 2 characters to see suggestions.');
      setAddFoodModalVisible(false);
      setAddFoodMode('menu');
      handleCloseScanner();
    } catch (error) {
      const uncertain = parsePhotoUncertainError(error);
      if (uncertain) {
        applyPhotoDetectedFoods(uncertain.detectedFoods, uncertain.message);
        setEntryFeedback(uncertain.message);
        if (entryForm.photoData) {
          setPhotoStatus(
            uncertain.detectedFoods.length
              ? 'Photo detected multiple foods. Review suggestions or log detected foods.'
              : 'Photo result is uncertain. Try another angle or type the food name.'
          );
        }
        if (!trimmedName && !trimmedBarcode && uncertain.detectedFoods[0]) {
          handleEntryChange('name', uncertain.detectedFoods[0].name);
        }
        return;
      }
      setEntryFeedback(
        error instanceof Error ? error.message : 'Unable to log entry. Try again in a moment.'
      );
    }
  };

  const handleSaveMacros = async () => {
    setMacroFeedback('Saving targets...');
    try {
      const result = await saveMacroTargetsRequest({
        athleteId: requestSubject,
        date: selectedDate,
        calories: asNumber(macroForm.calories) ?? null,
        protein: asNumber(macroForm.protein) ?? null,
        carbs: asNumber(macroForm.carbs) ?? null,
        fats: asNumber(macroForm.fats) ?? null,
      });
      setMacroFeedback(result.message || 'Targets saved.');
      refetch();
    } catch (error) {
      setMacroFeedback(
        error instanceof Error ? error.message : 'Unable to save macro targets right now.'
      );
    }
  };

  const handleDelete = async (entryId: number) => {
    await deleteNutritionEntryRequest(entryId);
    refetch();
  };

  const handleCapturePhoto = async () => {
    setPhotoStatus(null);
    setPhotoDetectedFoods([]);
    try {
      const imagePicker = getImagePickerModule();
      if (!imagePicker) {
        setPhotoStatus(getImagePickerMissingMessage());
        return;
      }
      const permission = await imagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoStatus('Camera permission is required to attach a meal photo.');
        return;
      }
      const result = await imagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });
      if (result.canceled) {
        setPhotoStatus('Capture cancelled.');
        return;
      }
      const asset = result.assets?.[0];
      if (asset?.base64) {
        handleEntryChange('photoData', asset.base64);
        setPhotoStatus('Photo attached.');
      } else {
        setPhotoStatus('Unable to read photo. Try again.');
      }
    } catch {
      setPhotoStatus(getImagePickerMissingMessage());
    }
  };

  const handleImportPhoto = async () => {
    setPhotoStatus(null);
    setEntryFeedback(null);
    setPhotoDetectedFoods([]);
    let importedPhotoData: string | null = null;
    try {
      const imagePicker = getImagePickerModule();
      if (!imagePicker) {
        setPhotoStatus(getImagePickerMissingMessage());
        return;
      }
      const permission = await imagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPhotoStatus('Photo library permission is required to import a meal photo.');
        return;
      }
      const result = await imagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });
      if (result.canceled) {
        setPhotoStatus('Import cancelled.');
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        setPhotoStatus('Unable to read the selected photo. Try another image.');
        return;
      }
      importedPhotoData = asset.base64;
      handleEntryChange('photoData', importedPhotoData);

      setEntryFeedback('Importing photo...');
      const upload = await runOrQueue<{ message?: string }>({
        endpoint: '/api/nutrition',
        payload: {
          type: entryForm.type,
          date: selectedDate,
          photoData: importedPhotoData,
        },
        description: 'Imported meal photo',
      });

      if (upload.status === 'sent') {
        setEntryFeedback(upload.result?.message || 'Photo imported into the food register.');
        setPhotoStatus('Imported photo logged.');
        handleEntryChange('photoData', null);
        refetch();
        resetEntryForm();
        setAddFoodModalVisible(false);
        setAddFoodMode('menu');
        return;
      }

      setEntryFeedback('Offline detected - photo import queued and will sync automatically.');
      setPhotoStatus('Imported photo queued for analysis.');
      resetEntryForm();
      setAddFoodModalVisible(false);
      setAddFoodMode('menu');
    } catch (error) {
      const uncertain = parsePhotoUncertainError(error);
      if (uncertain) {
        if (importedPhotoData) {
          handleEntryChange('photoData', importedPhotoData);
        }
        applyPhotoDetectedFoods(uncertain.detectedFoods, uncertain.message);
        setEntryFeedback(uncertain.message);
        setPhotoStatus(
          uncertain.detectedFoods.length
            ? 'Photo imported. Multiple foods detected, review suggestions before logging.'
            : 'Photo imported, but the result is uncertain. Type a food name or try another photo.'
        );
        if (uncertain.detectedFoods[0]) {
          handleEntryChange('name', uncertain.detectedFoods[0].name);
        }
        return;
      }
      setEntryFeedback(
        error instanceof Error ? error.message : 'Unable to import meal photo right now.'
      );
    }
  };

  const handleRemovePhoto = () => {
    handleEntryChange('photoData', null);
    setPhotoStatus(null);
    setPhotoDetectedFoods([]);
  };

  const handleViewHistoryPhoto = (entry: NutritionEntry) => {
    if (!entry.photoData) {
      return;
    }
    setHistoryPhoto({ uri: `data:image/jpeg;base64,${entry.photoData}`, name: entry.name });
  };

  const handleCloseHistoryPhoto = () => {
    setHistoryPhoto(null);
  };

  const calorieGoal = data.goals?.targetCalories ?? data.goals?.calories ?? null;
  const dailyTotals = data.dailyTotals || {
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    count: 0,
  };
  const summaryEyebrow = isToday ? 'Today' : formatDate(selectedDate, 'ddd');
  const dayLabel = isToday ? 'Today' : formatDate(selectedDate, 'MMMM D');
  const trendWindow = data.monthTrend.slice(-14);
  const trend = trendWindow.map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.calories,
  }));
  const hasTargetLine = trendWindow.some(
    (entry) => typeof (entry.targetCalories ?? calorieGoal) === 'number'
  );
  const targetTrend = hasTargetLine
    ? trendWindow.map((entry) => ({
        label: formatDate(entry.date, 'MMM D'),
        value: entry.targetCalories ?? calorieGoal ?? 0,
      }))
    : undefined;
  const previewUri = entryForm.photoData ? `data:image/jpeg;base64,${entryForm.photoData}` : null;
  const progressRows = [
    {
      key: 'calories',
      icon: 'flame-outline' as const,
      label: 'Calories',
      value: dailyTotals.calories,
      target: calorieGoal,
      unit: 'kcal',
      color: colors.accent,
    },
    {
      key: 'protein',
      icon: 'barbell-outline' as const,
      label: 'Protein',
      value: dailyTotals.protein,
      target: data.goals?.protein ?? null,
      unit: 'g',
      color: colors.success,
    },
    {
      key: 'carbs',
      icon: 'leaf-outline' as const,
      label: 'Carbs',
      value: dailyTotals.carbs,
      target: data.goals?.carbs ?? null,
      unit: 'g',
      color: '#78b8ff',
    },
    {
      key: 'fats',
      icon: 'water-outline' as const,
      label: 'Fats',
      value: dailyTotals.fats,
      target: data.goals?.fats ?? null,
      unit: 'g',
      color: colors.warning,
    },
  ];

  const renderTypeSelector = () => (
    <View style={styles.typeRow}>
      {['Food', 'Liquid'].map((type) => {
        const selected = entryForm.type === type;
        return (
          <Pressable
            key={type}
            style={[styles.typeChip, selected ? styles.typeChipSelected : null]}
            onPress={() => handleEntryChange('type', type as 'Food' | 'Liquid')}
          >
            <AppText
              variant="body"
              weight={selected ? 'semibold' : 'regular'}
              style={selected ? styles.typeChipTextSelected : styles.typeChipText}
            >
              {type}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );

  const renderSuggestionPanel = () => (
    <View style={styles.suggestionContainer}>
      <View style={styles.inlineRow}>
        <AppText variant="label" style={styles.modalSectionLabel}>
          Suggestions
        </AppText>
        {suggestionLoading ? (
          <AppText variant="muted" style={styles.suggestionStatus}>
            Searching...
          </AppText>
        ) : null}
      </View>
      {suggestions.length ? (
        suggestions.map((suggestion, index) => {
          const key = suggestion.id || `${suggestion.name}-${index}`;
          return (
            <TouchableOpacity
              key={key}
              style={styles.suggestionRow}
              onPress={() => applySuggestion(suggestion)}
              activeOpacity={0.85}
            >
              <View style={styles.suggestionInfo}>
                <AppText variant="body" weight="medium">
                  {suggestion.name}
                </AppText>
                <AppText variant="muted" style={styles.suggestionMeta}>
                  {formatSuggestionMeta(suggestion)}
                </AppText>
              </View>
              <View style={styles.inlineRow}>
                <AppText variant="label" style={styles.suggestionUseText}>
                  Use
                </AppText>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </View>
            </TouchableOpacity>
          );
        })
      ) : (
        <AppText variant="muted" style={styles.suggestionEmpty}>
          {suggestionStatus}
        </AppText>
      )}
    </View>
  );

  const handleLogDetectedFoodsFromPhoto = async () => {
    if (!entryForm.photoData) {
      setEntryFeedback('Attach a photo before logging detected foods.');
      return;
    }
    const detected = photoDetectedFoods.slice(0, PHOTO_DETECTED_MAX_ITEMS);
    if (!detected.length) {
      setEntryFeedback('No detected foods are available to log from this photo.');
      return;
    }

    setEntryFeedback('Logging detected foods...');
    const items = detected.map((food) => ({
      name: food.name,
      type: entryForm.type,
    }));

    try {
      const result = await runOrQueue<{ message?: string; entriesLogged?: Array<{ name?: string }> }>({
        endpoint: '/api/nutrition',
        payload: {
          type: entryForm.type,
          date: selectedDate,
          photoData: entryForm.photoData,
          items,
        },
        description: 'Detected meal photo foods',
      });

      if (result.status === 'sent') {
        const loggedCount = Array.isArray(result.result?.entriesLogged)
          ? result.result?.entriesLogged?.length || 0
          : 0;
        setEntryFeedback(
          result.result?.message ||
            (loggedCount > 0
              ? `${loggedCount} foods logged from one photo.`
              : 'Detected foods logged from photo.')
        );
        refetch();
      } else {
        setEntryFeedback('Offline detected - detected foods queued and will sync automatically.');
      }

      resetEntryForm();
      setPhotoStatus(null);
      setPhotoDetectedFoods([]);
      clearSuggestions('Type at least 2 characters to see suggestions.');
    } catch (error) {
      setEntryFeedback(
        error instanceof Error ? error.message : 'Unable to log detected foods right now.'
      );
    }
  };

  const renderScannerPanel = () =>
    scannerActive ? (
      <View style={styles.scannerPanel}>
        <View style={styles.scannerWrapper}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: SUPPORTED_BARCODE_TYPES }}
            onBarcodeScanned={scannerProcessing ? undefined : handleBarcodeDetected}
            onMountError={(error) => {
              setScannerFeedback(error?.message || 'Unable to start the camera scanner on this device.');
              setScannerProcessing(false);
              scannerLockRef.current = false;
            }}
          />
          {scannerProcessing ? (
            <View style={styles.scannerOverlay}>
              <AppText variant="body">Fetching nutrition info...</AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="muted" style={styles.scannerHelper}>
          Align a food barcode within the frame and hold still.
        </AppText>
      </View>
    ) : null;

  const renderMacroInputFields = () => (
    <>
      <AppInput
        label="Calories"
        keyboardType="numeric"
        value={entryForm.calories}
        onChangeText={(value) => handleEntryChange('calories', value)}
      />
      <AppInput
        label="Protein"
        keyboardType="numeric"
        value={entryForm.protein}
        onChangeText={(value) => handleEntryChange('protein', value)}
      />
      <AppInput
        label="Carbs"
        keyboardType="numeric"
        value={entryForm.carbs}
        onChangeText={(value) => handleEntryChange('carbs', value)}
      />
      <AppInput
        label="Fats"
        keyboardType="numeric"
        value={entryForm.fats}
        onChangeText={(value) => handleEntryChange('fats', value)}
      />
      <AppInput
        label="Weight amount"
        keyboardType="numeric"
        value={entryForm.weightAmount}
        onChangeText={(value) => handleEntryChange('weightAmount', value)}
      />
      <AppInput
        label="Unit"
        placeholder="g / ml"
        value={entryForm.weightUnit}
        onChangeText={(value) => handleEntryChange('weightUnit', value)}
      />
    </>
  );

  const renderEntryFeedback = () => (
    <>
      {photoStatus ? (
        <AppText variant="muted" style={styles.modalHelperText}>
          {photoStatus}
        </AppText>
      ) : null}
      {scannerFeedback ? (
        <AppText variant="muted" style={styles.modalHelperText}>
          {scannerFeedback}
        </AppText>
      ) : null}
      {entryFeedback ? (
        <AppText variant="muted" style={styles.modalHelperText}>
          {entryFeedback}
        </AppText>
      ) : null}
    </>
  );

  const renderAddFoodBody = () => {
    if (addFoodMode === 'menu') {
      return (
        <View style={styles.modalBody}>
          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => handleOpenAddFoodModal('search')}
            activeOpacity={0.88}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="search-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.actionText}>
              <AppText variant="body" weight="semibold">
                Search food
              </AppText>
              <AppText variant="muted">
                Find an item, use suggestions, or scan a barcode to pre-fill macros.
              </AppText>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => handleOpenAddFoodModal('photo')}
            activeOpacity={0.88}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="camera-outline" size={20} color={colors.warning} />
            </View>
            <View style={styles.actionText}>
              <AppText variant="body" weight="semibold">
                Snap meal photo
              </AppText>
              <AppText variant="muted">
                Attach a meal photo or import one for automatic nutrition analysis.
              </AppText>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionTile}
            onPress={() => handleOpenAddFoodModal('manual')}
            activeOpacity={0.88}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="create-outline" size={20} color={colors.success} />
            </View>
            <View style={styles.actionText}>
              <AppText variant="body" weight="semibold">
                Manual entry
              </AppText>
              <AppText variant="muted">
                Enter calories and macros directly for a precise custom food log.
              </AppText>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.modalBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderTypeSelector()}
        {addFoodMode === 'search' ? (
          <>
            <AppInput
              label="Search food"
              placeholder="Greek yogurt"
              value={entryForm.name}
              onChangeText={handleNameChange}
              selectTextOnFocus
            />
            {renderSuggestionPanel()}
            {photoDetectedFoods.length ? (
              <View style={styles.detectedFoodsContainer}>
                <AppText variant="muted">
                  Detected foods from this photo: {photoDetectedFoods.map((item) => item.name).join(', ')}.
                </AppText>
                <AppButton
                  title={`Log ${photoDetectedFoods.length} detected foods`}
                  variant="ghost"
                  onPress={handleLogDetectedFoodsFromPhoto}
                />
              </View>
            ) : null}
            <AppInput
              label="Barcode"
              placeholder="01234567890"
              keyboardType="number-pad"
              value={entryForm.barcode}
              onChangeText={(value) => handleEntryChange('barcode', value)}
            />
            <AppButton
              title={scannerActive ? 'Hide barcode scanner' : 'Scan barcode'}
              variant="ghost"
              onPress={scannerActive ? handleCloseScanner : handleOpenScanner}
            />
            {renderScannerPanel()}
            {renderMacroInputFields()}
            <AppButton title="Log food" onPress={handleAddEntry} />
            {renderEntryFeedback()}
          </>
        ) : null}
        {addFoodMode === 'photo' ? (
          <>
            <View style={styles.photoActionRow}>
              <AppButton
                title={entryForm.photoData ? 'Retake meal photo' : 'Snap meal photo'}
                variant="ghost"
                style={styles.photoActionButton}
                onPress={handleCapturePhoto}
              />
              <AppButton
                title="Import from library"
                variant="ghost"
                style={styles.photoActionButton}
                onPress={handleImportPhoto}
              />
            </View>
            <AppText variant="muted" style={styles.modalCopy}>
              Snap attaches a photo to the draft entry. Import sends the photo to the backend for
              automatic analysis and logs it immediately.
            </AppText>
            {previewUri ? (
              <View style={styles.photoPreviewCard}>
                <Image source={{ uri: previewUri }} style={styles.photoPreviewLarge} />
                <TouchableOpacity
                  style={styles.inlineIconButton}
                  onPress={handleRemovePhoto}
                  accessibilityLabel="Remove attached photo"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  <AppText variant="label" style={styles.inlineIconButtonText}>
                    Remove
                  </AppText>
                </TouchableOpacity>
              </View>
            ) : null}
            <AppInput
              label="Name"
              placeholder="Chicken rice bowl"
              value={entryForm.name}
              onChangeText={(value) => handleEntryChange('name', value)}
            />
            {renderMacroInputFields()}
            <AppButton title="Log meal photo entry" onPress={handleAddEntry} />
            {renderEntryFeedback()}
          </>
        ) : null}
        {addFoodMode === 'manual' ? (
          <>
            <AppInput
              label="Name"
              placeholder="Baked potato"
              value={entryForm.name}
              onChangeText={(value) => handleEntryChange('name', value)}
            />
            {renderMacroInputFields()}
            <View style={styles.photoActionRow}>
              <AppButton
                title="Add photo"
                variant="ghost"
                style={styles.photoActionButton}
                onPress={() => setAddFoodMode('photo')}
              />
              <AppButton
                title="Search database"
                variant="ghost"
                style={styles.photoActionButton}
                onPress={() => setAddFoodMode('search')}
              />
            </View>
            <AppButton title="Log food" onPress={handleAddEntry} />
            {renderEntryFeedback()}
          </>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <>
      <RefreshableScrollView
        contentContainerStyle={styles.container}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pageHeader}>
          <View style={styles.pageHeaderText}>
            <AppText variant="eyebrow">{summaryEyebrow}</AppText>
            <AppText variant="heading" style={styles.pageTitle}>
              Nutrition
            </AppText>
            <AppText variant="muted" style={styles.pageSubtitle}>
              Clean view of daily intake, macro balance, and meal history.
            </AppText>
          </View>
          <TouchableOpacity
            style={[styles.todayPill, isToday ? styles.todayPillActive : null]}
            onPress={handleJumpToToday}
            disabled={isToday}
          >
            <AppText variant="label" style={isToday ? styles.todayPillTextActive : styles.todayPillText}>
              {dayLabel}
            </AppText>
          </TouchableOpacity>
        </View>

        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.dateNavButton}
            onPress={() => adjustDate(-1)}
            accessibilityLabel="View previous day"
          >
            <Ionicons name="chevron-back" size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dateDisplay}
            onPress={handleOpenDatePicker}
            accessibilityRole="button"
            accessibilityLabel="Select a date"
          >
            <AppText variant="body" weight="semibold" style={styles.dateDisplayLabel}>
              {formatDate(selectedDate)}
            </AppText>
            <AppText variant="muted" style={styles.dateHint}>
              {isToday ? 'Today’s live summary' : 'Tap to choose another day'}
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dateNavButton, isToday ? styles.dateNavButtonDisabled : null]}
            onPress={() => adjustDate(1)}
            disabled={isToday}
            accessibilityLabel="View next day"
          >
            <Ionicons name="chevron-forward" size={18} color={isToday ? colors.muted : colors.text} />
          </TouchableOpacity>
        </View>

        <Card padded={false} style={styles.heroCard}>
          <LinearGradient
            colors={SUMMARY_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            <View style={styles.heroTopRow}>
              <View>
                <AppText variant="eyebrow">Daily Summary</AppText>
                <AppText variant="muted">
                  {dailyTotals.count ? `${dailyTotals.count} foods logged` : 'No foods logged yet'}
                </AppText>
              </View>
              <View style={styles.summaryBadge}>
                <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
                <AppText variant="label" style={styles.summaryBadgeText}>
                  {dayLabel}
                </AppText>
              </View>
            </View>

            <View style={styles.calorieHeroRow}>
              <View style={styles.calorieIconWrap}>
                <Ionicons name="flame" size={28} color={colors.accent} />
              </View>
              <View style={styles.calorieValueWrap}>
                <AppText style={styles.calorieValue}>{formatNumber(dailyTotals.calories)}</AppText>
                <AppText variant="body" style={styles.calorieUnit}>
                  kcal
                </AppText>
              </View>
            </View>

            <View style={styles.summaryMacroRow}>
              <SummaryMacroPill
                icon="barbell-outline"
                label="Protein"
                value={formatMacroValue(dailyTotals.protein)}
                color={colors.success}
              />
              <SummaryMacroPill
                icon="leaf-outline"
                label="Carbs"
                value={formatMacroValue(dailyTotals.carbs)}
                color="#78b8ff"
              />
              <SummaryMacroPill
                icon="water-outline"
                label="Fats"
                value={formatMacroValue(dailyTotals.fats)}
                color={colors.warning}
              />
            </View>
          </LinearGradient>
        </Card>

        <Card style={styles.sectionCard}>
          <NutritionSectionHeader
            title="Macro Progress"
            subtitle="Tracked against today’s targets"
            action={
              <TouchableOpacity
                style={styles.inlineActionButton}
                onPress={() => toggleSection(setMacroExpanded)}
              >
                <Ionicons
                  name={macroExpanded ? 'chevron-up' : 'create-outline'}
                  size={16}
                  color={colors.muted}
                />
                <AppText variant="label" style={styles.inlineActionText}>
                  {macroExpanded ? 'Hide' : 'Edit'}
                </AppText>
              </TouchableOpacity>
            }
          />
          <View style={styles.progressList}>
            {progressRows.map((row) => (
              <MacroProgressRow
                key={row.key}
                icon={row.icon}
                label={row.label}
                value={row.value}
                target={row.target}
                unit={row.unit}
                color={row.color}
              />
            ))}
          </View>
          {macroExpanded ? (
            <View style={styles.targetEditor}>
              <AppText variant="label" style={styles.targetEditorTitle}>
                Daily targets
              </AppText>
              <AppInput
                label="Calories"
                keyboardType="numeric"
                value={macroForm.calories}
                onChangeText={(value) => handleMacroChange('calories', value)}
              />
              <AppInput
                label="Protein"
                keyboardType="numeric"
                value={macroForm.protein}
                onChangeText={(value) => handleMacroChange('protein', value)}
              />
              <AppInput
                label="Carbs"
                keyboardType="numeric"
                value={macroForm.carbs}
                onChangeText={(value) => handleMacroChange('carbs', value)}
              />
              <AppInput
                label="Fats"
                keyboardType="numeric"
                value={macroForm.fats}
                onChangeText={(value) => handleMacroChange('fats', value)}
              />
              <AppButton title="Save targets" onPress={handleSaveMacros} variant="ghost" />
            </View>
          ) : null}
          {macroFeedback ? (
            <AppText variant="muted" style={styles.sectionHelperText}>
              {macroFeedback}
            </AppText>
          ) : null}
        </Card>

        <Card style={styles.sectionCard}>
          <NutritionSectionHeader title="Calorie Intake" subtitle="Last 14 Days" />
          <TrendChart
            data={trend}
            yLabel="kcal"
            color={colors.accent}
            areaOpacity={0.12}
            showPoints={false}
            targetData={targetTrend}
          />
          {hasTargetLine ? (
            <View style={styles.chartLegendRow}>
              <View style={styles.chartLegendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: colors.accent }]} />
                <AppText variant="muted">Intake</AppText>
              </View>
              <View style={styles.chartLegendItem}>
                <View style={styles.legendDashedWrap}>
                  <View style={styles.legendDashedLine} />
                </View>
                <AppText variant="muted">
                  {calorieGoal ? `Target ${formatNumber(calorieGoal)} kcal` : 'Target'}
                </AppText>
              </View>
            </View>
          ) : null}
        </Card>

        <Card style={styles.sectionCard}>
          <NutritionSectionHeader
            title="Food Log"
            subtitle={
              data.entries.length ? `${data.entries.length} entries logged` : 'No meals logged yet'
            }
          />
          {data.entries.length ? (
            <View style={styles.foodLogList}>
              {data.entries.map((entry) => (
                <FoodLogRow
                  key={entry.id}
                  entry={entry}
                  onDelete={handleDelete}
                  onViewPhoto={handleViewHistoryPhoto}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyStateIcon}>
                <Ionicons name="restaurant-outline" size={22} color={colors.muted} />
              </View>
              <AppText variant="body" weight="semibold">
                Nothing logged for this day
              </AppText>
              <AppText variant="muted" style={styles.emptyStateCopy}>
                Add a meal, scan a barcode, or import a photo to start tracking nutrition.
              </AppText>
              <AppButton title="Add Food" onPress={() => handleOpenAddFoodModal()} />
            </View>
          )}
        </Card>
      </RefreshableScrollView>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => handleOpenAddFoodModal()}
        accessibilityRole="button"
        accessibilityLabel="Add food"
        activeOpacity={0.9}
      >
        <Ionicons name="add" size={18} color={colors.background} />
        <AppText variant="body" weight="semibold" style={styles.fabText}>
          Add Food
        </AppText>
      </TouchableOpacity>
      {Platform.OS === 'ios' ? (
        <Modal
          visible={iosPickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIosPickerVisible(false)}
        >
          <View style={styles.viewerBackdrop}>
            <View style={styles.viewerCard}>
              <AppText variant="heading">Select a date</AppText>
              <DateTimePicker
                mode="date"
                display="spinner"
                value={iosPickerDate}
                maximumDate={new Date()}
                onChange={(_, date) => date && setIosPickerDate(date)}
              />
              <View style={styles.modalActions}>
                <AppButton title="Cancel" variant="ghost" onPress={() => setIosPickerVisible(false)} />
                <AppButton title="Use date" onPress={handleConfirmIosPicker} />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      <Modal
        visible={addFoodModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseAddFoodModal}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={styles.sheetDismissArea} onPress={handleCloseAddFoodModal} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              {addFoodMode === 'menu' ? (
                <View style={styles.sheetHeaderSpacer} />
              ) : (
                <TouchableOpacity
                  style={styles.sheetIconButton}
                  onPress={handleBackToAddFoodMenu}
                  accessibilityLabel="Back to add food options"
                >
                  <Ionicons name="chevron-back" size={18} color={colors.text} />
                </TouchableOpacity>
              )}
              <View style={styles.sheetHeaderText}>
                <AppText variant="heading">Add Food</AppText>
                <AppText variant="muted">
                  {ADD_FOOD_MODE_COPY[addFoodMode]}
                </AppText>
              </View>
              <TouchableOpacity
                style={styles.sheetIconButton}
                onPress={handleCloseAddFoodModal}
                accessibilityLabel="Close add food"
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            {renderAddFoodBody()}
          </View>
        </View>
      </Modal>
      <Modal
        visible={Boolean(historyPhoto)}
        transparent
        animationType="fade"
        onRequestClose={handleCloseHistoryPhoto}
      >
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewerCard}>
            <AppText variant="heading">{historyPhoto?.name || 'Meal photo'}</AppText>
            {historyPhoto ? (
              <Image source={{ uri: historyPhoto.uri }} style={styles.viewerImage} />
            ) : null}
            <AppButton title="Close photo" variant="ghost" onPress={handleCloseHistoryPhoto} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const SUMMARY_GRADIENT: readonly [string, string] = [
  'rgba(18, 58, 122, 0.95)',
  'rgba(7, 17, 38, 0.98)',
];

const ADD_FOOD_MODE_COPY: Record<AddFoodMode, string> = {
  menu: 'Choose the fastest way to log today’s intake.',
  search: 'Search, scan, and auto-fill food details.',
  photo: 'Capture a meal photo or import one for analysis.',
  manual: 'Add a custom entry with exact nutrition values.',
};

const SUPPORTED_BARCODE_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'itf14',
  'code128',
  'code39',
  'code93',
  'codabar',
  'datamatrix',
  'pdf417',
  'qr',
];

type NutritionSectionHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

function NutritionSectionHeader({ title, subtitle, action }: NutritionSectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <AppText variant="heading" style={styles.sectionTitle}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="muted" style={styles.sectionSubtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action ? <View style={styles.sectionHeaderAction}>{action}</View> : null}
    </View>
  );
}

function SummaryMacroPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.summaryMacroPill}>
      <View style={[styles.summaryMacroIcon, { backgroundColor: `${color}1c` }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={styles.summaryMacroText}>
        <AppText variant="label">{label}</AppText>
        <AppText variant="body" weight="semibold">
          {value}
        </AppText>
      </View>
    </View>
  );
}

function MacroProgressRow({
  icon,
  label,
  value,
  target,
  unit,
  color,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number;
  target: number | null | undefined;
  unit: string;
  color: string;
}) {
  const percent = target && target > 0 ? Math.min(value / target, 1) : 0;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressLabelRow}>
        <View style={styles.progressLabelGroup}>
          <View style={[styles.progressIcon, { backgroundColor: `${color}1c` }]}>
            <Ionicons name={icon} size={16} color={color} />
          </View>
          <AppText variant="body" weight="medium">
            {label}
          </AppText>
        </View>
        <AppText variant="muted" style={styles.progressValueText}>
          {formatProgressLabel(value, target, unit)}
        </AppText>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function FoodLogRow({
  entry,
  onDelete,
  onViewPhoto,
}: {
  entry: NutritionEntry;
  onDelete: (entryId: number) => void;
  onViewPhoto: (entry: NutritionEntry) => void;
}) {
  const thumbnail = entry.photoData ? (
    <TouchableOpacity
      style={styles.entryThumbButton}
      onPress={() => onViewPhoto(entry)}
      accessibilityLabel={`View photo for ${entry.name}`}
    >
      <Image source={{ uri: `data:image/jpeg;base64,${entry.photoData}` }} style={styles.entryThumbImage} />
    </TouchableOpacity>
  ) : (
    <View style={styles.entryThumbPlaceholder}>
      <Ionicons
        name={entry.type === 'Liquid' ? 'water-outline' : 'restaurant-outline'}
        size={18}
        color={colors.muted}
      />
    </View>
  );

  return (
    <View style={styles.foodLogRow}>
      {thumbnail}
      <View style={styles.foodLogText}>
        <View style={styles.foodLogTitleRow}>
          <AppText variant="body" weight="medium" style={styles.entryName} numberOfLines={1}>
            {entry.name}
          </AppText>
          <AppText variant="body" weight="semibold" style={styles.entryCalories}>
            {formatNumber(entry.calories)} kcal
          </AppText>
        </View>
        <AppText variant="muted" style={styles.entryMeta} numberOfLines={2}>
          {buildEntryMeta(entry)}
        </AppText>
      </View>
      <TouchableOpacity
        style={styles.deleteIconButton}
        onPress={() => onDelete(entry.id)}
        accessibilityLabel={`Delete ${entry.name}`}
      >
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

function formatMacroValue(value: number) {
  return `${formatNumber(value)} g`;
}

function formatProgressLabel(
  value: number,
  target: number | null | undefined,
  unit: string
) {
  const suffix = unit === 'kcal' ? ' kcal' : ` ${unit}`;
  const current = `${formatNumber(value)}${suffix}`;
  if (target === null || target === undefined || target <= 0) {
    return `${current} / no target`;
  }
  return `${current} / ${formatNumber(target)}${suffix}`;
}

function buildEntryMeta(entry: NutritionEntry) {
  const parts: string[] = [];
  if (entry.weightAmount && entry.weightUnit) {
    parts.push(`${formatNumber(entry.weightAmount)} ${entry.weightUnit}`);
  }
  parts.push(`P ${formatNumber(entry.protein)}g`);
  parts.push(`C ${formatNumber(entry.carbs)}g`);
  parts.push(`F ${formatNumber(entry.fats)}g`);
  if (entry.photoData) {
    parts.push('Photo');
  }
  return parts.join(' • ');
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl + 80,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  pageHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  pageTitle: {
    fontSize: 36,
    lineHeight: 40,
  },
  pageSubtitle: {
    lineHeight: 22,
  },
  todayPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  todayPillActive: {
    backgroundColor: 'rgba(77,245,255,0.12)',
    borderColor: 'rgba(77,245,255,0.28)',
  },
  todayPillText: {
    color: colors.text,
  },
  todayPillTextActive: {
    color: colors.accent,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateNavButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  dateNavButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  dateDisplay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  dateDisplayLabel: {
    fontSize: 18,
  },
  dateHint: {
    marginTop: 4,
    lineHeight: 18,
  },
  heroCard: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  heroGradient: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(1,9,21,0.28)',
  },
  summaryBadgeText: {
    color: colors.text,
  },
  calorieHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  calorieIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(77,245,255,0.12)',
  },
  calorieValueWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  calorieValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: -1.5,
  },
  calorieUnit: {
    color: colors.muted,
    fontSize: 18,
    paddingBottom: 6,
  },
  summaryMacroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryMacroPill: {
    flex: 1,
    minWidth: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(1,9,21,0.22)',
  },
  summaryMacroIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryMacroText: {
    flex: 1,
    gap: 2,
  },
  sectionCard: {
    backgroundColor: 'rgba(6,18,38,0.94)',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeaderText: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 24,
  },
  sectionSubtitle: {
    lineHeight: 20,
  },
  sectionHeaderAction: {
    alignSelf: 'center',
  },
  inlineActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  inlineActionText: {
    color: colors.muted,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  typeChip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  typeChipSelected: {
    borderColor: 'rgba(77,245,255,0.28)',
    backgroundColor: 'rgba(77,245,255,0.14)',
  },
  typeChipText: {
    color: colors.text,
  },
  typeChipTextSelected: {
    color: colors.accent,
  },
  suggestionContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  modalSectionLabel: {
    color: colors.muted,
  },
  suggestionStatus: {
    marginLeft: 'auto',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  suggestionInfo: {
    flex: 1,
    gap: 4,
  },
  suggestionMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  suggestionUseText: {
    color: colors.accent,
  },
  suggestionEmpty: {
    lineHeight: 20,
  },
  detectedFoodsContainer: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.glass,
  },
  scannerPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.glass,
  },
  scannerWrapper: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(77,245,255,0.28)',
  },
  scannerCamera: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(1,9,21,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerHelper: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  modalBody: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  actionTile: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  actionText: {
    flex: 1,
    gap: 4,
  },
  photoActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  photoActionButton: {
    flex: 1,
  },
  modalCopy: {
    lineHeight: 20,
  },
  photoPreviewCard: {
    borderRadius: 20,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPreviewLarge: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  inlineIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,107,129,0.24)',
    backgroundColor: 'rgba(255,107,129,0.08)',
  },
  inlineIconButtonText: {
    color: colors.danger,
  },
  modalHelperText: {
    lineHeight: 20,
  },
  progressList: {
    gap: spacing.md,
  },
  progressRow: {
    gap: spacing.xs,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  progressIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressValueText: {
    fontSize: 13,
    textAlign: 'right',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  targetEditor: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  targetEditorTitle: {
    marginBottom: spacing.sm,
  },
  sectionHelperText: {
    marginTop: spacing.sm,
  },
  chartLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  chartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendDashedWrap: {
    width: 18,
    alignItems: 'center',
  },
  legendDashedLine: {
    width: 18,
    borderTopWidth: 2,
    borderTopColor: colors.muted,
    borderStyle: 'dashed',
  },
  foodLogList: {
    gap: spacing.md,
  },
  foodLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryThumbButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  entryThumbImage: {
    width: '100%',
    height: '100%',
  },
  entryThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  foodLogText: {
    flex: 1,
    gap: 4,
  },
  foodLogTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryName: {
    flex: 1,
  },
  entryCalories: {
    fontSize: 15,
  },
  entryMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  deleteIconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,107,129,0.24)',
    backgroundColor: 'rgba(255,107,129,0.08)',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyStateIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  emptyStateCopy: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fabText: {
    color: colors.background,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetDismissArea: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.panel,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetHeaderSpacer: {
    width: 40,
  },
  sheetHeaderText: {
    flex: 1,
    gap: 4,
  },
  sheetIconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  viewerCard: {
    width: '100%',
    backgroundColor: colors.panel,
    borderRadius: 24,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  viewerImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
});
