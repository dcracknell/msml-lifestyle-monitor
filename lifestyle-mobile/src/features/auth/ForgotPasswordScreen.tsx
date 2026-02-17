import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppInput, AppText, Card } from '../../components';
import { colors } from '../../theme';
import { forgotPasswordRequest } from '../../api/endpoints';
import { AuthStackParamList } from './AuthScreen';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setFeedback(null);
    setLoading(true);
    try {
      const response = await forgotPasswordRequest({ email });
      setFeedback(response.message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to notify the head coach.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <AppText variant="heading">Reset access</AppText>
        <AppText variant="muted" style={styles.subtitle}>
          Enter your account email and we’ll alert the head coach to help you reset your password.
        </AppText>
        <AppInput
          label="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
        />
        {feedback ? (
          <AppText variant="muted" style={styles.feedback}>
            {feedback}
          </AppText>
        ) : null}
        <AppButton title="Notify head coach" onPress={handleSubmit} loading={loading} />
        <AppButton
          title="Back to sign in"
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={styles.secondary}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  subtitle: {
    marginBottom: 16,
  },
  feedback: {
    marginBottom: 12,
  },
  secondary: {
    marginTop: 8,
  },
});
