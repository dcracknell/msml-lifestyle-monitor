import Svg, { Circle } from 'react-native-svg';
import { View, StyleSheet } from 'react-native';
import { colors, fonts } from '../theme';
import { AppText } from './AppText';

interface Props {
  value: number;
  max?: number;
  size?: number;
  label?: string;
}

export function ProgressRing({ value, max = 100, size = 140, label }: Props) {
  const normalized = Math.min(Math.max(value, 0), max);
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (normalized / max) * circumference;

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size} pointerEvents="none">
        <Circle
          stroke={colors.border}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          stroke={colors.accent}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.valueContainer}>
        <AppText variant="heading" style={styles.value}>
          {Math.round(normalized)}
        </AppText>
        {label ? (
          <AppText variant="muted" style={styles.label}>
            {label}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  valueContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  value: {
    fontFamily: fonts.display,
    fontSize: 32,
  },
  label: {
    marginTop: 4,
  },
});
