/// <reference types="@testing-library/jest-dom" />
import React, { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NutritionResponse, NutritionSuggestion } from '../../../api/types';

const mockUseQuery = jest.fn();
const mockSearchNutritionRequest = jest.fn();
const mockRunOrQueue = jest.fn();
const mockReadSuggestionCache = jest.fn();
const mockFetchSuggestionsWithCache = jest.fn();
const mockReadNutritionFavorites = jest.fn();

jest.mock('react-native', () => {
  const React = require('react');

  const mapDomProps = ({
    accessibilityLabel,
    accessibilityRole,
    testID,
    ...props
  }: Record<string, any>) => {
    const domProps: Record<string, unknown> = { ...props };
    if (accessibilityLabel) {
      domProps['aria-label'] = accessibilityLabel;
    }
    if (accessibilityRole) {
      domProps.role = accessibilityRole;
    }
    if (testID) {
      domProps['data-testid'] = testID;
    }
    return domProps;
  };

  const View = ({
    children,
    accessibilityLabel,
    accessibilityRole,
    testID,
    ...props
  }: PropsWithChildren<Record<string, any>>) => (
    <div {...mapDomProps({ accessibilityLabel, accessibilityRole, testID, ...props })}>{children}</div>
  );

  const ScrollView = React.forwardRef(function ScrollView(
    {
      children,
      accessibilityLabel,
      accessibilityRole,
      contentContainerStyle,
      keyboardShouldPersistTaps,
      showsVerticalScrollIndicator,
      testID,
      ...props
    }: PropsWithChildren<Record<string, any>>,
    ref: React.Ref<{ scrollTo: () => void }>
  ) {
    React.useImperativeHandle(ref, () => ({
      scrollTo: () => undefined,
    }));
    void contentContainerStyle;
    void keyboardShouldPersistTaps;
    void showsVerticalScrollIndicator;
    return <div {...mapDomProps({ accessibilityLabel, accessibilityRole, testID, ...props })}>{children}</div>;
  });

  const TouchableOpacity = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    activeOpacity,
    testID,
    ...props
  }: PropsWithChildren<{
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    activeOpacity?: number;
    testID?: string;
    [key: string]: any;
  }>) => {
    void activeOpacity;
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onPress}
        disabled={disabled}
        {...mapDomProps({ accessibilityLabel, accessibilityRole, testID, ...props })}
      >
      {children}
      </button>
    );
  };

  const Pressable = TouchableOpacity;

  const TextInput = React.forwardRef(function TextInput(
    {
      value = '',
      onChangeText,
      onKeyPress,
      onSubmitEditing,
      onFocus,
      onBlur,
      placeholder,
      accessibilityLabel,
      autoCapitalize,
      autoCorrect,
      blurOnSubmit,
      keyboardType,
      placeholderTextColor,
      returnKeyType,
      ...props
    }: {
      value?: string;
      onChangeText?: (value: string) => void;
      onKeyPress?: (event: { nativeEvent: { key: string } }) => void;
      onSubmitEditing?: (event: { nativeEvent: { text: string } }) => void;
      onFocus?: (event: unknown) => void;
      onBlur?: (event: unknown) => void;
      placeholder?: string;
      accessibilityLabel?: string;
      autoCapitalize?: string;
      autoCorrect?: boolean;
      blurOnSubmit?: boolean;
      keyboardType?: string;
      placeholderTextColor?: string;
      returnKeyType?: string;
      [key: string]: any;
    },
    ref: React.Ref<HTMLInputElement>
  ) {
    void autoCapitalize;
    void autoCorrect;
    void blurOnSubmit;
    void keyboardType;
    void placeholderTextColor;
    void returnKeyType;
    return (
      <input
        ref={ref}
        value={value}
        aria-label={accessibilityLabel || placeholder}
        placeholder={placeholder}
        onFocus={(event) => onFocus?.(event)}
        onBlur={(event) => onBlur?.(event)}
        onChange={(event) => onChangeText?.(event.currentTarget.value)}
        onKeyDown={(event) => {
          onKeyPress?.({ nativeEvent: { key: event.key } });
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmitEditing?.({ nativeEvent: { text: event.currentTarget.value } });
          }
        }}
        {...props}
      />
    );
  });

  const Image = ({ accessibilityLabel = 'image', ...props }: Record<string, unknown>) => (
    <img alt={String(accessibilityLabel)} {...props} />
  );

  const Modal = ({ visible, children }: PropsWithChildren<{ visible?: boolean }>) =>
    visible ? <div>{children}</div> : null;

  const ActivityIndicator = () => <div>Loading...</div>;

  return {
    ActivityIndicator,
    Image,
    LayoutAnimation: { configureNext: jest.fn(), Presets: { easeInEaseOut: {} } },
    Modal,
    Platform: { OS: 'ios' },
    Pressable,
    ScrollView,
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    TextInput,
    TouchableOpacity,
    UIManager: { setLayoutAnimationEnabledExperimental: jest.fn() },
    View,
  };
});

jest.mock('../../../components', () => {
  const React = require('react');

  const AppText = ({ children }: PropsWithChildren<Record<string, unknown>>) => <span>{children}</span>;

  const AppButton = ({
    title,
    onPress,
    disabled,
  }: {
    title: string;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={disabled ? undefined : onPress} disabled={disabled}>
      {title}
    </button>
  );

  const AppInput = React.forwardRef(function AppInput(
    {
      label,
      value = '',
      onChangeText,
      onSubmitEditing,
      keyboardType,
      placeholder,
      ...props
    }: {
      label?: string;
      value?: string;
      onChangeText?: (value: string) => void;
      onSubmitEditing?: (event: { nativeEvent: { text: string } }) => void;
      keyboardType?: string;
      placeholder?: string;
      [key: string]: any;
    },
    ref: React.Ref<HTMLInputElement>
  ) {
    void keyboardType;
    const ariaLabel = label || placeholder || 'input';
    return (
      <label>
        <span>{label}</span>
        <input
          ref={ref}
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => onChangeText?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmitEditing?.({ nativeEvent: { text: event.currentTarget.value } });
            }
          }}
          {...props}
        />
      </label>
    );
  });

  return {
    AppButton,
    AppInput,
    AppText,
    Card: ({ children }: PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
    ErrorView: ({ message }: { message: string }) => <div>{message}</div>,
    LoadingView: () => <div>Loading nutrition</div>,
    RefreshableScrollView: ({ children }: PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
    TrendChart: () => <div>Trend chart</div>,
  };
});

jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

jest.mock('../../../api/endpoints', () => ({
  analyzeNutritionPhotoRequest: jest.fn(),
  deleteNutritionEntryRequest: jest.fn(),
  lookupNutritionRequest: jest.fn(),
  nutritionRequest: jest.fn(),
  saveMacroTargetsRequest: jest.fn(),
  searchNutritionRequest: (...args: unknown[]) => mockSearchNutritionRequest(...args),
}));

jest.mock('../../../api/client', () => ({
  ApiError: class ApiError extends Error {
    code?: string;
    details?: unknown;

    constructor(message = 'ApiError', options: { code?: string; details?: unknown } = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = options.code;
      this.details = options.details;
    }
  },
}));

jest.mock('../../../providers/SubjectProvider', () => ({
  useSubject: () => ({ subjectId: null }),
}));

jest.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 7,
      name: 'Taylor',
      role: 'Athlete',
    },
  }),
}));

jest.mock('../../../providers/SyncProvider', () => ({
  useSyncQueue: () => ({
    runOrQueue: (...args: unknown[]) => mockRunOrQueue(...args),
  }),
}));

jest.mock('../../../utils/imagePicker', () => ({
  getImagePickerMissingMessage: jest.fn(() => 'Image picker unavailable'),
  getImagePickerModule: jest.fn(() => null),
}));

jest.mock('../suggestionCache', () => ({
  fetchSuggestionsWithCache: (...args: unknown[]) => mockFetchSuggestionsWithCache(...args),
  readSuggestionCache: (...args: unknown[]) => mockReadSuggestionCache(...args),
}));

jest.mock('../dailyCaloriesWidget', () => ({
  createDailyCaloriesWidgetSnapshot: jest.fn(() => ({})),
  syncDailyCaloriesWidget: jest.fn(),
}));

jest.mock('../favoritesStore', () => ({
  isNutritionFavorite: jest.fn(() => false),
  readNutritionFavorites: (...args: unknown[]) => mockReadNutritionFavorites(...args),
  toggleNutritionFavorite: jest.fn(async () => []),
}));

jest.mock('../nutritionMetrics', () => ({
  trackNutritionMetric: jest.fn(),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,
}));

jest.mock('expo-camera', () => ({
  CameraView: ({ children }: PropsWithChildren<Record<string, unknown>>) => <div>{children}</div>,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ value }: { value: Date }) => <input aria-label="date-picker" value={value.toISOString()} readOnly />,
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const { NutritionScreen } = require('../NutritionScreen') as typeof import('../NutritionScreen');

function buildSuggestion(
  name: string,
  overrides: Partial<NutritionSuggestion> = {}
): NutritionSuggestion {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    source: 'Food database',
    serving: '1 serving',
    prefill: {
      type: 'Food',
      calories: 100,
      protein: 10,
      carbs: 10,
      fats: 3,
      fiber: 2,
      weightAmount: 100,
      weightUnit: 'g',
    },
    ...overrides,
  };
}

const nutritionData: NutritionResponse = {
  date: '2026-04-16',
  goals: {
    targetCalories: 2200,
    calories: 2200,
    protein: 160,
    carbs: 240,
    fats: 70,
  },
  dailyTotals: {
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    fiber: 0,
    count: 0,
  },
  entries: [],
  monthTrend: [],
  subjectId: 7,
};

function flushMicrotasks() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openSearchComposer() {
  render(<NutritionScreen />);
  await flushMicrotasks();
  fireEvent.click(screen.getAllByRole('button', { name: /Add intake/i })[0]);
  await flushMicrotasks();
  if (!screen.queryByPlaceholderText('Type a food, then choose or press Enter')) {
    fireEvent.click(screen.getByRole('button', { name: /Search food/i }));
    await flushMicrotasks();
  }
  await advance(130);
  return screen.getByPlaceholderText('Type a food, then choose or press Enter');
}

beforeEach(() => {
  jest.useFakeTimers();
  mockUseQuery.mockReturnValue({
    data: nutritionData,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
  mockSearchNutritionRequest.mockResolvedValue({ suggestions: [] });
  mockRunOrQueue.mockResolvedValue({ status: 'sent', result: {} });
  mockReadSuggestionCache.mockReturnValue(null);
  mockFetchSuggestionsWithCache.mockImplementation(
    async (query: string, fetcher: (value: string) => Promise<NutritionSuggestion[]>) => fetcher(query)
  );
  mockReadNutritionFavorites.mockResolvedValue([]);
  global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof global.requestAnimationFrame;
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('NutritionScreen search flow', () => {
  it('keeps the empty state visible when search returns 0 results', async () => {
    const searchInput = await openSearchComposer();

    fireEvent.change(searchInput, { target: { value: 'zzz' } });
    await advance(250);

    await waitFor(() => {
      expect(mockSearchNutritionRequest).toHaveBeenCalledWith('zzz');
    });
    expect(screen.getByText('Suggestions')).toBeInTheDocument();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('keeps arrow-key navigation working', async () => {
    mockSearchNutritionRequest.mockResolvedValue({
      suggestions: [
        buildSuggestion('Apple', {
          prefill: { type: 'Food', calories: 120, protein: 1, carbs: 31, fats: 0, fiber: 4, weightAmount: 182, weightUnit: 'g' },
        }),
        buildSuggestion('Apricot', {
          prefill: { type: 'Food', calories: 17, protein: 0.5, carbs: 4, fats: 0.1, fiber: 1, weightAmount: 35, weightUnit: 'g' },
        }),
      ],
    });

    const searchInput = await openSearchComposer();

    fireEvent.change(searchInput, { target: { value: 'app' } });
    await advance(250);
    await waitFor(() => {
      expect(screen.getByText('Apple')).toBeInTheDocument();
    });

    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    await flushMicrotasks();

    expect(screen.getByText('Ready To Log')).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
  });

  it('shows the selected-item card only after selection or explicit custom commit', async () => {
    mockSearchNutritionRequest.mockImplementation(async (query: string) => {
      if (query === 'oat') {
        return {
          suggestions: [
            buildSuggestion('Oatmeal', {
              prefill: {
                type: 'Food',
                calories: 150,
                protein: 6,
                carbs: 27,
                fats: 3,
                fiber: 4,
                weightAmount: 240,
                weightUnit: 'g',
              },
            }),
          ],
        };
      }
      return { suggestions: [] };
    });

    const searchInput = await openSearchComposer();

    fireEvent.change(searchInput, { target: { value: 'oat' } });
    await advance(250);
    await waitFor(() => {
      expect(screen.getByText('Oatmeal')).toBeInTheDocument();
    });

    expect(screen.queryByText('Ready To Log')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Oatmeal'));
    await flushMicrotasks();
    expect(screen.getByText('Ready To Log')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Reset'));
    await flushMicrotasks();
    expect(screen.queryByText('Ready To Log')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Type a food, then choose or press Enter'), {
      target: { value: 'rare food' },
    });
    await advance(250);
    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Use "rare food" as a custom item'));
    await flushMicrotasks();

    expect(screen.getByText('Ready To Log')).toBeInTheDocument();
    expect(screen.getByText('rare food')).toBeInTheDocument();
  });

  it('clears stale macro preview state after clear or replace', async () => {
    mockSearchNutritionRequest.mockImplementation(async (query: string) => {
      if (query === 'apple') {
        return {
          suggestions: [
            buildSuggestion('Apple', {
              prefill: {
                type: 'Food',
                calories: 120,
                protein: 1,
                carbs: 31,
                fats: 0,
                fiber: 4,
                weightAmount: 182,
                weightUnit: 'g',
              },
            }),
          ],
        };
      }
      if (query === 'banana') {
        return {
          suggestions: [
            buildSuggestion('Banana', {
              prefill: {
                type: 'Food',
                calories: 90,
                protein: 1.1,
                carbs: 23,
                fats: 0.3,
                fiber: 2.6,
                weightAmount: 118,
                weightUnit: 'g',
              },
            }),
          ],
        };
      }
      return { suggestions: [] };
    });

    const searchInput = await openSearchComposer();

    fireEvent.change(searchInput, { target: { value: 'apple' } });
    await advance(250);
    await waitFor(() => {
      expect(screen.getByText('Apple')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Apple'));
    await flushMicrotasks();

    expect(screen.getByText('120 kcal')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search to replace Apple'), {
      target: { value: 'banana' },
    });
    expect(screen.queryByText('120 kcal')).not.toBeInTheDocument();

    await advance(250);
    await waitFor(() => {
      expect(screen.getByText('Banana')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Banana'));
    await flushMicrotasks();

    expect(screen.getByText('90 kcal')).toBeInTheDocument();
    expect(screen.queryByText('120 kcal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Reset'));
    await flushMicrotasks();

    expect(screen.queryByText('90 kcal')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready To Log')).not.toBeInTheDocument();
  });

  it('does not allow logging from typing alone', async () => {
    const searchInput = await openSearchComposer();

    fireEvent.change(searchInput, { target: { value: 'typed only' } });
    await advance(250);

    fireEvent.keyDown(searchInput, { key: 'Enter' });
    await flushMicrotasks();

    expect(mockRunOrQueue).not.toHaveBeenCalled();
    expect(screen.getByText('Ready To Log')).toBeInTheDocument();
  });
});
