import { createLiveActivity } from 'expo-widgets';

import type { WorkoutLiveActivityProps } from '../workoutLiveActivity';

type LiveActivityLayoutFactory = (props: WorkoutLiveActivityProps, environment: unknown) => any;

// Expo SDK 54 does not serialize widget functions for expo-widgets 55, so pass the layout source directly.
const WORKOUT_LIVE_ACTIVITY_LAYOUT = String.raw`(props, _environment) => ({
  banner: jsxs(VStack, {
    spacing: 6,
    modifiers: [padding({ all: 12 })],
    children: [
      jsxs(HStack, {
        spacing: 8,
        children: [
          jsx(Text, {
            modifiers: [font({ size: 12, weight: 'semibold' }), lineLimit(1)],
            children: props.sportLabel,
          }),
          jsx(Text, {
            modifiers: [font({ size: 12 }), lineLimit(1)],
            children: props.statusLabel,
          }),
        ],
      }),
      jsx(Text, {
        modifiers: [font({ size: 24, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
        children: props.distanceLabel,
      }),
      jsxs(Text, {
        modifiers: [font({ size: 13 }), monospacedDigit(), lineLimit(1)],
        children: [props.elapsedLabel, ' \u00b7 ', props.paceLabel],
      }),
      jsx(Text, {
        modifiers: [font({ size: 12 }), lineLimit(1)],
        children: props.heartRateLabel,
      }),
    ],
  }),
  compactLeading: jsx(Text, {
    modifiers: [font({ size: 12, weight: 'semibold' }), monospacedDigit(), lineLimit(1)],
    children: props.compactDistanceLabel,
  }),
  compactTrailing: jsx(Text, {
    modifiers: [font({ size: 12, weight: 'semibold' }), monospacedDigit(), lineLimit(1)],
    children: props.compactElapsedLabel,
  }),
  minimal: jsx(Text, {
    modifiers: [font({ size: 12, weight: 'semibold' }), monospacedDigit(), lineLimit(1)],
    children: props.compactDistanceLabel,
  }),
  expandedLeading: jsxs(VStack, {
    spacing: 4,
    modifiers: [padding({ all: 12 })],
    children: [
      jsx(Text, {
        modifiers: [font({ size: 12, weight: 'semibold' }), lineLimit(1)],
        children: props.sportLabel,
      }),
      jsx(Text, {
        modifiers: [font({ size: 12 }), lineLimit(1)],
        children: props.statusLabel,
      }),
    ],
  }),
  expandedTrailing: jsxs(VStack, {
    spacing: 4,
    modifiers: [padding({ all: 12 })],
    children: [
      jsx(Text, {
        modifiers: [font({ size: 22, weight: 'bold' }), monospacedDigit(), lineLimit(1)],
        children: props.distanceLabel,
      }),
      jsx(Text, {
        modifiers: [font({ size: 12 }), monospacedDigit(), lineLimit(1)],
        children: props.elapsedLabel,
      }),
    ],
  }),
  expandedBottom: jsxs(VStack, {
    spacing: 4,
    modifiers: [padding({ all: 12 })],
    children: [
      jsx(Text, {
        modifiers: [font({ size: 12 }), monospacedDigit(), lineLimit(1)],
        children: props.paceLabel,
      }),
      jsx(Text, {
        modifiers: [font({ size: 12 }), lineLimit(1)],
        children: props.heartRateLabel,
      }),
    ],
  }),
})`;

const WorkoutLiveActivityView = WORKOUT_LIVE_ACTIVITY_LAYOUT as unknown as LiveActivityLayoutFactory;

export default createLiveActivity<WorkoutLiveActivityProps>('WorkoutLiveActivity', WorkoutLiveActivityView);
