import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppInput, AppText, Card } from '../../components';
import { colors } from '../../theme';
import { useAuth } from '../../providers/AuthProvider';
import { useApiConfig } from '../../providers/ApiConfigProvider';
import { getImagePickerMissingMessage, getImagePickerModule } from '../../utils/imagePicker';

export type AuthStackParamList = {
  AuthLanding: undefined;
  ForgotPassword: undefined;
};

type Props = NativeStackScreenProps<AuthStackParamList, 'AuthLanding'>;

type Mode = 'login' | 'signup';

export function AuthScreen({ navigation }: Props) {
  const { signIn, signUp, isAuthenticating } = useAuth();
  const { apiBaseUrl, updateBaseUrl, resetBaseUrl } = useApiConfig();
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    avatar: '',
    avatarPhoto: null as string | null,
  });
  const [error, setError] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [apiUrlInput, setApiUrlInput] = useState(apiBaseUrl);
  const [apiUrlFeedback, setApiUrlFeedback] = useState<string | null>(null);
  const [apiUrlSaving, setApiUrlSaving] = useState(false);

  useEffect(() => {
    setApiUrlInput(apiBaseUrl);
  }, [apiBaseUrl]);

  const handleChange = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      if (mode === 'login') {
        await signIn({ email: form.email.trim(), password: form.password });
      } else {
        await signUp({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          avatar: form.avatar.trim() ? form.avatar.trim() : null,
          avatarPhoto: form.avatarPhoto || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authenticate.');
    }
  };

  const handleApplyApiUrl = async () => {
    setApiUrlFeedback(null);
    setApiUrlSaving(true);
    try {
      await updateBaseUrl(apiUrlInput);
      setApiUrlFeedback('API base URL updated.');
    } catch (err) {
      setApiUrlFeedback(err instanceof Error ? err.message : 'Unable to update API base URL.');
    } finally {
      setApiUrlSaving(false);
    }
  };

  const handleResetApiUrl = async () => {
    setApiUrlFeedback(null);
    setApiUrlSaving(true);
    try {
      await resetBaseUrl();
      setApiUrlFeedback('Reverted to the default API server.');
    } catch (err) {
      setApiUrlFeedback(err instanceof Error ? err.message : 'Unable to reset API base URL.');
    } finally {
      setApiUrlSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.brandBlock}>
        <View style={styles.brandDot} />
        <View>
          <AppText variant="eyebrow">MSML</AppText>
          <AppText variant="heading">Lifestyle Monitor</AppText>
          <AppText variant="muted">Performance intelligence at your fingertips.</AppText>
        </View>
      </View>
      <Card>
        <View style={styles.toggleRow}>
          <AppButton
            title="Sign In"
            variant={mode === 'login' ? 'primary' : 'ghost'}
            onPress={() => setMode('login')}
          />
          <AppButton
            title="Create Account"
            variant={mode === 'signup' ? 'primary' : 'ghost'}
            onPress={() => setMode('signup')}
          />
        </View>
        {mode === 'signup' ? (
          <AppInput
            label="Full name"
            placeholder="Jordan Castillo"
            autoCapitalize="words"
            value={form.name}
            onChangeText={(value) => handleChange('name', value)}
          />
        ) : null}
        <AppInput
          label="Email or username"
          placeholder="coach@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={(value) => handleChange('email', value)}
        />
        <AppInput
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          value={form.password}
          onChangeText={(value) => handleChange('password', value)}
        />
        {mode === 'signup' ? (
          <>
            <AppInput
              label="Avatar URL (optional)"
              placeholder="https://images..."
              autoCapitalize="none"
              value={form.avatar}
              onChangeText={(value) => handleChange('avatar', value)}
            />
            <AppButton
              title={form.avatarPhoto ? 'Retake profile photo' : 'Take profile photo'}
              variant="ghost"
              onPress={async () => {
                setPhotoStatus(null);
                const imagePicker = getImagePickerModule();
                if (!imagePicker) {
                  setPhotoStatus(getImagePickerMissingMessage());
                  return;
                }
                const permission = await imagePicker.requestCameraPermissionsAsync();
                if (!permission.granted) {
                  setPhotoStatus('Camera permission is required.');
                  return;
                }
                const result = await imagePicker.launchCameraAsync({
                  allowsEditing: false,
                  quality: 0.5,
                  base64: true,
                });
                if (result.canceled) {
                  setPhotoStatus('Capture cancelled.');
                  return;
                }
                const base64 = result.assets?.[0]?.base64;
                if (base64) {
                  handleChange('avatarPhoto', base64);
                  handleChange('avatar', '');
                  setPhotoStatus('Profile photo attached.');
                } else {
                  setPhotoStatus('Unable to attach photo.');
                }
              }}
            />
            {form.avatarPhoto ? (
              <View style={styles.photoPreviewRow}>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${form.avatarPhoto}` }}
                  style={styles.photoPreview}
                />
                <AppButton
                  title="Remove photo"
                  variant="ghost"
                  onPress={() => {
                    handleChange('avatarPhoto', null);
                    setPhotoStatus(null);
                  }}
                />
              </View>
            ) : null}
            {photoStatus ? (
              <AppText variant="muted" style={styles.helper}>
                {photoStatus}
              </AppText>
            ) : null}
          </>
        ) : null}
        {error ? (
          <AppText variant="muted" style={styles.error}>
            {error}
          </AppText>
        ) : null}
        <AppButton
          title={mode === 'login' ? 'Enter dashboard' : 'Create account'}
          onPress={handleSubmit}
          loading={isAuthenticating}
          style={styles.submit}
        />
        {mode === 'login' ? (
          <AppButton
            title="Forgot password?"
            variant="ghost"
            onPress={() => navigation.navigate('ForgotPassword')}
          />
        ) : null}
        <View style={styles.connectionBlock}>
          <AppButton
            title={connectionExpanded ? 'Hide connection settings' : 'Connection settings'}
            variant="ghost"
            onPress={() => setConnectionExpanded((prev) => !prev)}
          />
          {!connectionExpanded ? (
            <AppText variant="muted" style={styles.connectionHint}>
              Current server: {apiBaseUrl}
            </AppText>
          ) : (
            <>
              <AppInput
                label="API base URL"
                autoCapitalize="none"
                autoCorrect={false}
                value={apiUrlInput}
                onChangeText={setApiUrlInput}
              />
              {apiUrlFeedback ? (
                <AppText variant="muted" style={styles.connectionHint}>
                  {apiUrlFeedback}
                </AppText>
              ) : null}
              <View style={styles.connectionActions}>
                <AppButton title="Apply" onPress={handleApplyApiUrl} loading={apiUrlSaving} />
                <AppButton
                  title="Reset"
                  variant="ghost"
                  onPress={handleResetApiUrl}
                  disabled={apiUrlSaving}
                />
              </View>
            </>
          )}
        </View>
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
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 16,
  },
  brandDot: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: colors.accentStrong,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  submit: {
    marginTop: 8,
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  photoPreview: {
    width: 72,
    height: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  helper: {
    marginTop: 8,
  },
  connectionBlock: {
    marginTop: 16,
    gap: 8,
  },
  connectionHint: {
    marginTop: 4,
  },
  connectionActions: {
    flexDirection: 'row',
    gap: 12,
  },
});
