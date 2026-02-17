import { forwardRef } from 'react';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { colors, fonts } from '../theme';
import { AppText } from './AppText';

interface Props extends TextInputProps {
  label?: string;
  helperText?: string | null;
}

export const AppInput = forwardRef<TextInput, Props>(function AppInput(
  { label, helperText, style, ...rest },
  ref
) {
  return (
    <View style={styles.container}>
      {label ? (
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...rest}
      />
      {helperText ? (
        <AppText variant="muted" style={styles.helper}>
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
  },
  label: {
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.glass,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
  },
  helper: {
    marginTop: 4,
    fontSize: 12,
  },
});
