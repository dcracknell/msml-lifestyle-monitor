import { createWidget } from 'expo-widgets';

import type { ActivityProgressWidgetProps } from '../activityWidget';

type WidgetLayoutFactory = (props: ActivityProgressWidgetProps, environment: unknown) => any;

// Expo SDK 54 does not serialize widget functions for expo-widgets 55, so pass the layout source directly.
const ACTIVITY_PROGRESS_WIDGET_LAYOUT = String.raw`(props, environment) => {
  const family = environment ? environment.widgetFamily : undefined;
  const showsContainerBackground = !environment || environment.showsContainerBackground !== false;
  const athleteName = typeof props.athleteName === 'string' && props.athleteName ? props.athleteName : 'MSML Lifestyle';
  const overallPercent = Number.isFinite(props.overallPercent) ? Math.max(0, Math.min(100, Math.round(props.overallPercent))) : 0;
  const statusLabel = typeof props.statusLabel === 'string' && props.statusLabel ? props.statusLabel : 'Open the app to sync activity';
  const distanceSummary = typeof props.distanceSummary === 'string' && props.distanceSummary ? props.distanceSummary : '0/0 km';
  const durationSummary = typeof props.durationSummary === 'string' && props.durationSummary ? props.durationSummary : '0/0 min';
  const trainingLoadSummary = typeof props.trainingLoadSummary === 'string' && props.trainingLoadSummary ? props.trainingLoadSummary : '0 pts';
  const cardBackground = showsContainerBackground
    ? [background('#0C1222', shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' }))]
    : [];

  if (family === 'accessoryInline') {
    return jsx(Text, {
      modifiers: [font({ size: 13, weight: 'semibold' }), monospacedDigit(), lineLimit(1)],
      children: overallPercent + '% complete \u00b7 ' + distanceSummary,
    });
  }

  if (family === 'accessoryCircular') {
    return jsxs(ZStack, {
      children: [
        showsContainerBackground ? jsx(AccessoryWidgetBackground, {}) : null,
        jsx(Gauge, {
          value: overallPercent,
          min: 0,
          max: 100,
          currentValueLabel: jsx(Text, {
            modifiers: [font({ size: 13, weight: 'bold' }), monospacedDigit()],
            children: overallPercent + '%',
          }),
          modifiers: [gaugeStyle('circularCapacity'), tint('#00E5CC')],
          children: jsx(Text, { children: 'Goal' }),
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
              children: 'Weekly progress',
            }),
            jsx(Text, {
              modifiers: [font({ size: 17, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
              children: overallPercent + '% complete',
            }),
            jsx(Text, {
              modifiers: [font({ size: 11 }), lineLimit(1)],
              children: distanceSummary,
            }),
            jsx(Text, {
              modifiers: [font({ size: 11 }), lineLimit(1)],
              children: durationSummary,
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
          children: 'Weekly progress',
        }),
        jsx(Text, {
          modifiers: [font({ size: 30, weight: 'bold' }), monospacedDigit(), multilineTextAlignment('center')],
          children: overallPercent + '%',
        }),
        jsx(Text, {
          modifiers: [font({ size: 12 }), lineLimit(1)],
          children: distanceSummary,
        }),
        jsx(Text, {
          modifiers: [font({ size: 12 }), lineLimit(1)],
          children: durationSummary,
        }),
        jsx(Text, {
          modifiers: [font({ size: 11 }), lineLimit(1)],
          children: statusLabel,
        }),
      ],
    });
  }

  return jsxs(VStack, {
    spacing: 12,
    modifiers: [padding({ all: 16 }), ...cardBackground],
    children: [
      jsxs(HStack, {
        spacing: 12,
        children: [
          jsx(Gauge, {
            value: overallPercent,
            min: 0,
            max: 100,
            currentValueLabel: jsx(Text, {
              modifiers: [font({ size: 18, weight: 'bold' }), monospacedDigit()],
              children: overallPercent + '%',
            }),
            modifiers: [gaugeStyle('circularCapacity'), tint('#00E5CC')],
            children: jsx(Text, { children: 'Goal' }),
          }),
          jsxs(VStack, {
            spacing: 3,
            children: [
              jsx(Text, {
                modifiers: [font({ size: 12, weight: 'semibold' }), lineLimit(1)],
                children: athleteName,
              }),
              jsx(Text, {
                modifiers: [font({ size: 20, weight: 'bold' }), lineLimit(1)],
                children: 'Weekly progress',
              }),
              jsx(Text, {
                modifiers: [font({ size: 12 }), lineLimit(1)],
                children: statusLabel,
              }),
              jsxs(Text, {
                modifiers: [font({ size: 12 }), lineLimit(1)],
                children: ['Load ', trainingLoadSummary],
              }),
            ],
          }),
        ],
      }),
      jsxs(Text, {
        modifiers: [font({ size: 13 }), lineLimit(1)],
        children: ['Distance ', distanceSummary],
      }),
      jsxs(Text, {
        modifiers: [font({ size: 13 }), lineLimit(1)],
        children: ['Duration ', durationSummary],
      }),
    ],
  });
}`;

const ActivityProgressWidgetView = ACTIVITY_PROGRESS_WIDGET_LAYOUT as unknown as WidgetLayoutFactory;

export default createWidget<ActivityProgressWidgetProps>('ActivityProgressWidget', ActivityProgressWidgetView);
