import { createWidget } from 'expo-widgets';

import type { DailyCaloriesWidgetProps } from '../dailyCaloriesWidget';

type WidgetLayoutFactory = (props: DailyCaloriesWidgetProps, environment: unknown) => any;

const DAILY_CALORIES_WIDGET_LAYOUT = String.raw`(props, environment) => {
  const family = environment ? environment.widgetFamily : undefined;
  const showsContainerBackground = !environment || environment.showsContainerBackground !== false;
  const titleLabel = typeof props.titleLabel === 'string' && props.titleLabel ? props.titleLabel : 'Daily calories';
  const consumedCalories = Number.isFinite(props.consumedCalories) ? Math.max(0, Math.round(props.consumedCalories)) : 0;
  const targetCalories = Number.isFinite(props.targetCalories) ? Math.max(1, Math.round(props.targetCalories)) : 1;
  const progressPercent = Number.isFinite(props.progressPercent) ? Math.max(0, Math.min(999, Math.round(props.progressPercent))) : 0;
  const statusLabel = typeof props.statusLabel === 'string' && props.statusLabel ? props.statusLabel : 'Open the app to sync calories';
  const compactConsumedLabel = typeof props.compactConsumedLabel === 'string' && props.compactConsumedLabel ? props.compactConsumedLabel : String(consumedCalories);
  const compactProgressLabel = typeof props.compactProgressLabel === 'string' && props.compactProgressLabel ? props.compactProgressLabel : progressPercent + '%';
  const cardBackground = showsContainerBackground
    ? [background('#102519', shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' }))]
    : [];

  if (family === 'accessoryInline') {
    return jsx(Text, {
      modifiers: [font({ size: 13, weight: 'semibold' }), monospacedDigit(), lineLimit(1)],
      children: compactConsumedLabel + '/' + targetCalories + ' kcal',
    });
  }

  if (family === 'accessoryCircular') {
    return jsxs(ZStack, {
      children: [
        showsContainerBackground ? jsx(AccessoryWidgetBackground, {}) : null,
        jsx(Gauge, {
          value: Math.min(progressPercent, 100),
          min: 0,
          max: 100,
          currentValueLabel: jsx(Text, {
            modifiers: [font({ size: 12, weight: 'bold' }), monospacedDigit()],
            children: compactProgressLabel,
          }),
          modifiers: [gaugeStyle('circularCapacity'), tint('#7CF29A')],
          children: jsx(Text, { children: 'Calories' }),
        }),
      ],
    });
  }

  if (family === 'accessoryRectangular') {
    return jsxs(ZStack, {
      children: [
        showsContainerBackground ? jsx(AccessoryWidgetBackground, {}) : null,
        jsxs(VStack, {
          spacing: 2,
          modifiers: [padding({ all: 6 })],
          children: [
            jsx(Text, {
              modifiers: [font({ size: 11, weight: 'semibold' }), lineLimit(1)],
              children: titleLabel,
            }),
            jsx(Text, {
              modifiers: [font({ size: 17, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
              children: compactConsumedLabel + ' kcal',
            }),
            jsx(Text, {
              modifiers: [font({ size: 11 }), lineLimit(1)],
              children: statusLabel,
            }),
          ],
        }),
      ],
    });
  }

  if (family === 'systemSmall') {
    return jsxs(VStack, {
      spacing: 6,
      modifiers: [padding({ all: 14 }), ...cardBackground],
      children: [
        jsx(Text, {
          modifiers: [font({ size: 12, weight: 'semibold' }), lineLimit(1)],
          children: titleLabel,
        }),
        jsx(Text, {
          modifiers: [font({ size: 30, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
          children: compactConsumedLabel,
        }),
        jsx(Text, {
          modifiers: [font({ size: 12 }), monospacedDigit(), lineLimit(1)],
          children: 'Goal ' + targetCalories + ' kcal',
        }),
        jsx(Text, {
          modifiers: [font({ size: 12 }), lineLimit(1)],
          children: statusLabel,
        }),
      ],
    });
  }

  return jsxs(VStack, {
    spacing: 10,
    modifiers: [padding({ all: 16 }), ...cardBackground],
    children: [
      jsxs(HStack, {
        spacing: 12,
        children: [
          jsx(Gauge, {
            value: Math.min(progressPercent, 100),
            min: 0,
            max: 100,
            currentValueLabel: jsx(Text, {
              modifiers: [font({ size: 18, weight: 'bold' }), monospacedDigit()],
              children: compactProgressLabel,
            }),
            modifiers: [gaugeStyle('circularCapacity'), tint('#7CF29A')],
            children: jsx(Text, { children: 'Calories' }),
          }),
          jsxs(VStack, {
            spacing: 3,
            children: [
              jsx(Text, {
                modifiers: [font({ size: 12, weight: 'semibold' }), lineLimit(1)],
                children: titleLabel,
              }),
              jsx(Text, {
                modifiers: [font({ size: 26, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
                children: compactConsumedLabel + ' kcal',
              }),
              jsx(Text, {
                modifiers: [font({ size: 12 }), monospacedDigit(), lineLimit(1)],
                children: 'Goal ' + targetCalories + ' kcal',
              }),
              jsx(Text, {
                modifiers: [font({ size: 12 }), lineLimit(1)],
                children: statusLabel,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}`;

const DailyCaloriesWidgetView = DAILY_CALORIES_WIDGET_LAYOUT as unknown as WidgetLayoutFactory;

export default createWidget<DailyCaloriesWidgetProps>('DailyCaloriesWidget', DailyCaloriesWidgetView);
