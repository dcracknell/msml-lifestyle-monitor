import { Text, TextProps, StyleSheet } from 'react-native';
import { colors, fonts } from '../theme';

type Variant = 'body' | 'muted' | 'heading' | 'eyebrow' | 'label';

type Props = TextProps & {
  variant?: Variant;
  weight?: 'regular' | 'medium' | 'semibold';
};

const fontMap = {
  regular: fonts.sans,
  medium: fonts.sansMedium,
  semibold: fonts.sansSemi,
};

export function AppText({ style, children, variant = 'body', weight = 'regular', ...rest }: Props) {
  return (
    <Text style={[styles.base, variantStyles[variant], { fontFamily: fontMap[weight] }, style]} {...rest}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
  },
});

const variantStyles: Record<Variant, object> = {
  body: {},
  muted: { color: colors.muted },
  heading: {
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 3,
    fontSize: 12,
    color: colors.muted,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
};
