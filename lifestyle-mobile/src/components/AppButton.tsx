import { ActivityIndicator, Pressable, PressableProps, StyleSheet, Text } from 'react-native';
import { colors, fonts } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost';

interface Props extends PressableProps {
  title: string;
  variant?: Variant;
  loading?: boolean;
}

export function AppButton({ title, variant = 'primary', loading, style, disabled, ...rest }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        buttonVariants[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'ghost' ? colors.accent : colors.background} />
      ) : (
        <Text style={[styles.text, textVariants[variant]]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  text: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});

const buttonVariants: Record<Variant, object> = {
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.accentStrong,
  },
  ghost: {
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
};

const textVariants: Record<Variant, object> = {
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.text,
  },
  ghost: {
    color: colors.text,
  },
};
