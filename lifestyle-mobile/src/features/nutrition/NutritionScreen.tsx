import { useState, Dispatch, SetStateAction, useEffect, useRef } from 'react';
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
} from 'react-native';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  ErrorView,
  LoadingView,
  SectionHeader,
  TrendChart,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import {
  nutritionRequest,
  saveMacroTargetsRequest,
  deleteNutritionEntryRequest,
  searchNutritionRequest,
  lookupNutritionRequest,
} from '../../api/endpoints';
import { useSubject } from '../../providers/SubjectProvider';
import { useAuth } from '../../providers/AuthProvider';
import { formatDate, formatNumber } from '../../utils/format';
import { useSyncQueue } from '../../providers/SyncProvider';
import * as ImagePicker from 'expo-image-picker';
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
  const [logExpanded, setLogExpanded] = useState(true);
  const [macroExpanded, setMacroExpanded] = useState(false);
  const [macroForm, setMacroForm] = useState({ calories: '', protein: '', carbs: '', fats: '' });
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
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
    setScannerActive(true);
  };

  const handleCloseScanner = () => {
    setScannerActive(false);
    setScannerProcessing(false);
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
    return signals.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
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

  const handleApplyTopSuggestion = () => {
    if (suggestions.length) {
      applySuggestion(suggestions[0]);
    }
  };

  const handleBarcodeDetected = async ({ data }: BarcodeScanningResult) => {
    if (scannerProcessing) {
      return;
    }
    const trimmed = data?.trim();
    if (!trimmed) {
      setScannerFeedback('Unable to read barcode. Try again.');
      return;
    }
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
    if (!trimmedName && !trimmedBarcode) {
      setEntryFeedback('Enter a food name or a barcode before logging.');
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
      const result = await runOrQueue({ endpoint: '/api/nutrition', payload });
      if (result.status === 'sent') {
        setEntryFeedback('Entry saved.');
        refetch();
      } else {
        setEntryFeedback('Offline detected—entry queued and will sync automatically.');
      }
      setEntryForm({
        name: '',
        type: entryForm.type,
        barcode: '',
        calories: '',
        protein: '',
        carbs: '',
        fats: '',
        weightAmount: '',
        weightUnit: entryForm.weightUnit,
        photoData: null,
      });
      setPhotoStatus(null);
      clearSuggestions('Type at least 2 characters to see suggestions.');
    } catch (error) {
      setEntryFeedback(
        error instanceof Error ? error.message : 'Unable to log entry. Try again in a moment.'
      );
    }
  };

  const handleSaveMacros = async () => {
    await saveMacroTargetsRequest({
      athleteId: requestSubject,
      date: selectedDate,
      calories: Number(macroForm.calories),
      protein: Number(macroForm.protein),
      carbs: Number(macroForm.carbs),
      fats: Number(macroForm.fats),
    });
    refetch();
  };

  const handleDelete = async (entryId: number) => {
    await deleteNutritionEntryRequest(entryId);
    refetch();
  };

  const trend = data.monthTrend.slice(-14).map((entry) => ({
    label: formatDate(entry.date, 'MMM D'),
    value: entry.calories,
  }));
  const previewUri = entryForm.photoData ? `data:image/jpeg;base64,${entryForm.photoData}` : null;

  const handleCapturePhoto = async () => {
    setPhotoStatus(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setPhotoStatus('Camera permission is required to attach a meal photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
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
  };

  const handleRemovePhoto = () => {
    handleEntryChange('photoData', null);
    setPhotoStatus(null);
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

  return (
    <>
      <RefreshableScrollView
        contentContainerStyle={styles.container}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
      >
      <SectionHeader title="Daily nutrition" subtitle={formatDate(selectedDate)} />
      <View style={styles.dateRow}>
        <AppButton title="Prev" variant="ghost" onPress={() => adjustDate(-1)} />
        <TouchableOpacity
          style={styles.dateDisplay}
          onPress={handleOpenDatePicker}
          accessibilityRole="button"
          accessibilityLabel="Select a date"
        >
          <AppText variant="heading">{formatDate(selectedDate)}</AppText>
          <AppText variant="muted" style={styles.dateHint}>
            Tap to choose a day
          </AppText>
        </TouchableOpacity>
        <AppButton title="Next" variant="ghost" onPress={() => adjustDate(1)} disabled={isToday} />
      </View>
      <AppButton
        title="Jump to today"
        variant="ghost"
        onPress={handleJumpToToday}
        disabled={isToday}
        style={styles.todayButton}
      />
      <Card>
        <SectionHeader
          title="Log entry"
          subtitle="Fast capture"
          action={
            <TouchableOpacity
              style={styles.collapseButton}
              onPress={() => toggleSection(setLogExpanded)}
            >
              <AppText variant="muted">{logExpanded ? 'Hide' : 'Show'}</AppText>
            </TouchableOpacity>
          }
        />
        {logExpanded ? (
          <>
            <View style={styles.typeRow}>
              {['Food', 'Liquid'].map((type) => {
                const selected = entryForm.type === type;
                return (
                  <Pressable
                    key={type}
                    style={[styles.typeChip, selected && styles.typeChipSelected]}
                    onPress={() => handleEntryChange('type', type as 'Food' | 'Liquid')}
                  >
                    <AppText variant="body" style={selected ? styles.typeChipTextSelected : undefined}>
                      {type}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            <AppInput
              label="Name"
              placeholder="Greek yogurt"
              value={entryForm.name}
              onChangeText={handleNameChange}
              selectTextOnFocus
            />
            <View style={styles.suggestionContainer}>
              <View style={styles.suggestionHeader}>
                <AppText variant="body">Suggestions</AppText>
                {suggestionLoading ? <AppText variant="muted">Searching...</AppText> : null}
              </View>
              {suggestions.length ? (
                <>
                  <AppText variant="muted">Tap a suggestion or use the quick button to auto-fill.</AppText>
                  <AppButton
                    title="Use top suggestion"
                    variant="ghost"
                    style={styles.suggestionButton}
                    onPress={handleApplyTopSuggestion}
                  />
                  {suggestions.map((suggestion, index) => {
                    const key = suggestion.id || `${suggestion.name}-${index}`;
                    return (
                      <View key={key} style={styles.suggestionRow}>
                        <TouchableOpacity
                          style={styles.suggestionInfo}
                          onPress={() => applySuggestion(suggestion)}
                        >
                          <AppText variant="body">{suggestion.name}</AppText>
                          <AppText variant="muted" style={styles.suggestionMeta}>
                            {formatSuggestionMeta(suggestion)}
                          </AppText>
                        </TouchableOpacity>
                        <AppButton
                          title="Use"
                          variant="ghost"
                          style={styles.suggestionButton}
                          onPress={() => applySuggestion(suggestion)}
                        />
                      </View>
                    );
                  })}
                </>
              ) : (
                <AppText variant="muted">{suggestionStatus}</AppText>
              )}
            </View>
            <AppInput
              label="Barcode (optional)"
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
            {scannerActive ? (
              <View style={styles.scannerPanel}>
                <View style={styles.scannerWrapper}>
                  <CameraView
                    style={styles.scannerCamera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: SUPPORTED_BARCODE_TYPES }}
                    onBarcodeScanned={scannerProcessing ? undefined : handleBarcodeDetected}
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
            ) : null}
            {scannerFeedback ? (
              <AppText variant="muted" style={styles.helperText}>
                {scannerFeedback}
              </AppText>
            ) : null}
            <View style={styles.formRow}>
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
            </View>
            <View style={styles.formRow}>
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
            </View>
            <View style={styles.formRow}>
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
            </View>
            <AppButton
              title={entryForm.photoData ? 'Retake meal photo' : 'Snap meal photo'}
              variant="ghost"
              onPress={handleCapturePhoto}
            />
            {previewUri ? (
              <View style={styles.photoPreviewRow}>
                <Image source={{ uri: previewUri }} style={styles.photoPreview} />
                <AppButton title="Remove photo" variant="ghost" onPress={handleRemovePhoto} />
              </View>
            ) : null}
            {photoStatus ? (
              <AppText variant="muted" style={styles.helperText}>
                {photoStatus}
              </AppText>
            ) : null}
            <AppButton title="Log entry" onPress={handleAddEntry} />
            {entryFeedback ? (
              <AppText variant="muted" style={styles.helperText}>
                {entryFeedback}
              </AppText>
            ) : null}
            <AppText variant="muted" style={styles.helperText}>
              Entries sync to the `/api/nutrition` endpoint automatically—even offline logs are replayed
              when you reconnect.
            </AppText>
          </>
        ) : (
          <AppText variant="muted">Tap “Show” whenever you want to log a meal or drink.</AppText>
        )}
      </Card>
      <Card>
        <SectionHeader
          title="Macro targets"
          subtitle="Coach adjustable"
          action={
            <TouchableOpacity
              style={styles.collapseButton}
              onPress={() => toggleSection(setMacroExpanded)}
            >
              <AppText variant="muted">{macroExpanded ? 'Hide' : 'Show'}</AppText>
            </TouchableOpacity>
          }
        />
        {macroExpanded ? (
          <>
            <AppInput
              label="Calories"
              keyboardType="numeric"
              value={macroForm.calories}
              onChangeText={(value) => handleMacroChange('calories', value)}
            />
            <View style={styles.formRow}>
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
            </View>
            <AppInput
              label="Fats"
              keyboardType="numeric"
              value={macroForm.fats}
              onChangeText={(value) => handleMacroChange('fats', value)}
            />
            <AppButton title="Save targets" onPress={handleSaveMacros} variant="ghost" />
          </>
        ) : (
          <AppText variant="muted">Tap “Show” to adjust calories, protein, carbs, and fats.</AppText>
        )}
      </Card>
      <Card>
        <SectionHeader title="Entries" subtitle={`${data.entries.length} logged`} />
        {data.entries.map((entry) => (
          <View key={entry.id} style={styles.entryRow}>
            <View style={styles.entryInfo}>
              <AppText variant="body">{entry.name}</AppText>
              <AppText variant="muted">{entry.type} · {entry.calories} kcal</AppText>
              {entry.photoData ? (
                <TouchableOpacity
                  style={styles.entryPhotoWrapper}
                  onPress={() => handleViewHistoryPhoto(entry)}
                >
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${entry.photoData}` }}
                    style={styles.entryPhoto}
                  />
                  <View style={styles.photoInfo}>
                    <AppText variant="muted" style={styles.photoFlag}>
                      📷 Photo attached
                    </AppText>
                    <AppText variant="muted" style={styles.photoHint}>
                      Tap to view
                    </AppText>
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
            <AppButton title="Remove" variant="ghost" onPress={() => handleDelete(entry.id)} />
          </View>
        ))}
      </Card>
      <Card>
        <SectionHeader title="Monthly calories" subtitle="14-day view" />
        <TrendChart data={trend} yLabel="kcal" />
      </Card>
      <Card>
        <SectionHeader title="Daily totals" subtitle="Macros" />
        {data.dailyTotals ? (
          <View>
            <AppText variant="body">Calories {formatNumber(data.dailyTotals.calories)}</AppText>
            <AppText variant="body">Protein {formatNumber(data.dailyTotals.protein, { suffix: ' g' })}</AppText>
            <AppText variant="body">Carbs {formatNumber(data.dailyTotals.carbs, { suffix: ' g' })}</AppText>
            <AppText variant="body">Fats {formatNumber(data.dailyTotals.fats, { suffix: ' g' })}</AppText>
          </View>
        ) : (
          <AppText variant="muted">No entries yet.</AppText>
        )}
      </Card>
      </RefreshableScrollView>
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

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  dateDisplay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  dateHint: {
    marginTop: spacing.xs * 0.5,
    color: colors.muted,
  },
  todayButton: {
    alignSelf: 'flex-end',
    marginBottom: spacing.md,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(77,245,255,0.12)',
  },
  typeChipTextSelected: {
    color: colors.accent,
  },
  formRow: {
    width: '100%',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  helperText: {
    marginTop: spacing.sm,
  },
  collapseButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: colors.border,
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  photoPreview: {
    width: 96,
    height: 96,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  entryInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  entryPhotoWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryPhoto: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  photoFlag: {
    color: colors.muted,
  },
  photoHint: {
    color: colors.accent,
  },
  suggestionContainer: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  suggestionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  suggestionInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  suggestionMeta: {
    color: colors.muted,
  },
  suggestionButton: {
    height: 40,
    paddingHorizontal: spacing.sm,
  },
  scannerPanel: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.glass,
  },
  scannerWrapper: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  scannerCamera: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(1,9,21,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerHelper: {
    textAlign: 'center',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  viewerCard: {
    width: '100%',
    backgroundColor: colors.panel,
    borderRadius: 20,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
});
