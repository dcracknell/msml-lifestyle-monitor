import { createWidget } from 'expo-widgets';

import type { CurrentRunWidgetProps } from '../currentRunWidget';

type WidgetLayoutFactory = (props: CurrentRunWidgetProps, environment: unknown) => any;

const CURRENT_RUN_WIDGET_LAYOUT = String.raw`(props, environment) => {
  const family = environment ? environment.widgetFamily : undefined;
  const showsContainerBackground = !environment || environment.showsContainerBackground !== false;
  const titleLabel = typeof props.titleLabel === 'string' && props.titleLabel ? props.titleLabel : 'Run';
  const statusLabel = typeof props.statusLabel === 'string' && props.statusLabel ? props.statusLabel : 'Open the app to start a run';
  const distanceLabel = typeof props.distanceLabel === 'string' && props.distanceLabel ? props.distanceLabel : '0.00 km';
  const elapsedLabel = typeof props.elapsedLabel === 'string' && props.elapsedLabel ? props.elapsedLabel : '0:00';
  const paceLabel = typeof props.paceLabel === 'string' && props.paceLabel ? props.paceLabel : 'Pace --';
  const caloriesLabel = typeof props.caloriesLabel === 'string' && props.caloriesLabel ? props.caloriesLabel : 'Calories --';
  const compactDistanceLabel = typeof props.compactDistanceLabel === 'string' && props.compactDistanceLabel ? props.compactDistanceLabel : '0.0k';
  const compactStatusLabel = typeof props.compactStatusLabel === 'string' && props.compactStatusLabel ? props.compactStatusLabel : 'Ready';
  const cardBackground = showsContainerBackground
    ? [background('#10131C', shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' }))]
    : [];

  if (family === 'accessoryInline') {
    return jsx(Text, {
      modifiers: [font({ size: 13, weight: 'semibold' }), monospacedDigit(), lineLimit(1)],
      children: compactDistanceLabel + ' · ' + compactStatusLabel,
    });
  }

  if (family === 'accessoryCircular') {
    return jsxs(ZStack, {
      children: [
        showsContainerBackground ? jsx(AccessoryWidgetBackground, {}) : null,
        jsxs(VStack, {
          spacing: 0,
          modifiers: [padding({ all: 6 })],
          children: [
            jsx(Text, {
              modifiers: [font({ size: 13, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
              children: compactDistanceLabel,
            }),
            jsx(Text, {
              modifiers: [font({ size: 9 }), lineLimit(1)],
              children: compactStatusLabel,
            }),
          ],
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
              children: distanceLabel,
            }),
            jsx(Text, {
              modifiers: [font({ size: 11 }), monospacedDigit(), lineLimit(1)],
              children: elapsedLabel + ' · ' + compactStatusLabel,
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
          modifiers: [font({ size: 28, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
          children: distanceLabel,
        }),
        jsx(Text, {
          modifiers: [font({ size: 12 }), monospacedDigit(), lineLimit(1)],
          children: elapsedLabel,
        }),
        jsx(Text, {
          modifiers: [font({ size: 12 }), monospacedDigit(), lineLimit(1)],
          children: paceLabel,
        }),
        jsx(Text, {
          modifiers: [font({ size: 11 }), lineLimit(1)],
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
        spacing: 10,
        modifiers: [frame({ maxWidth: 'infinity' }, { alignment: 'leading' })],
        children: [
          jsxs(VStack, {
            spacing: 2,
            children: [
              jsx(Text, {
                modifiers: [font({ size: 12, weight: 'semibold' }), lineLimit(1)],
                children: titleLabel,
              }),
              jsx(Text, {
                modifiers: [font({ size: 30, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
                children: distanceLabel,
              }),
            ],
          }),
          jsxs(VStack, {
            spacing: 4,
            children: [
              jsx(Text, {
                modifiers: [font({ size: 13 }), monospacedDigit(), lineLimit(1)],
                children: elapsedLabel,
              }),
              jsx(Text, {
                modifiers: [font({ size: 13 }), monospacedDigit(), lineLimit(1)],
                children: paceLabel,
              }),
              jsx(Text, {
                modifiers: [font({ size: 13 }), lineLimit(1)],
                children: caloriesLabel,
              }),
            ],
          }),
        ],
      }),
      jsx(Text, {
        modifiers: [font({ size: 12 }), lineLimit(1)],
        children: statusLabel,
      }),
    ],
  });
}`;

const CurrentRunWidgetView = CURRENT_RUN_WIDGET_LAYOUT as unknown as WidgetLayoutFactory;

export default createWidget<CurrentRunWidgetProps>('CurrentRunWidget', CurrentRunWidgetView);
