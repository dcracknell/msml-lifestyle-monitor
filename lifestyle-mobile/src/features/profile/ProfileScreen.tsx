import { useEffect, useState } from 'react';
import { StyleSheet, View, Image } from 'react-native';
import { updateProfileRequest } from '../../api/endpoints';
import { useAuth } from '../../providers/AuthProvider';
import { useApiConfig } from '../../providers/ApiConfigProvider';
import {
  AppButton,
  AppInput,
  AppText,
  Card,
  SectionHeader,
  RefreshableScrollView,
} from '../../components';
import { colors, spacing } from '../../theme';
import * as ImagePicker from 'expo-image-picker';

export function ProfileScreen() {
  const { user, setSessionFromPayload } = useAuth();
  const { apiBaseUrl, updateBaseUrl, resetBaseUrl } = useApiConfig();
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    weightCategory: user?.weight_category || '',
    password: '',
    currentPassword: '',
    stravaClientId: user?.strava_client_id || '',
    stravaClientSecret: user?.strava_client_secret || '',
    stravaRedirectUri: user?.strava_redirect_uri || '',
    avatarUrl: user?.avatar_url || '',
    avatarPhoto: user?.avatar_photo || null,
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const [apiUrlInput, setApiUrlInput] = useState(apiBaseUrl);
  const [apiUrlFeedback, setApiUrlFeedback] = useState<string | null>(null);
  const [apiUrlSaving, setApiUrlSaving] = useState(false);

  useEffect(() => {
    setApiUrlInput(apiBaseUrl);
  }, [apiBaseUrl]);

  const handleChange = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const derivedAvatarPhoto =
    typeof form.avatarPhoto === 'string' && form.avatarPhoto.length > 0
      ? form.avatarPhoto
      : form.avatarPhoto === null
      ? null
      : user?.avatar_photo || null;

  const previewUri = derivedAvatarPhoto
    ? `data:image/jpeg;base64,${derivedAvatarPhoto}`
    : form.avatarUrl || user?.avatar_url || null;

  const handleTakePhoto = async () => {
    setPhotoStatus(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setPhotoStatus('Camera permission is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
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
      handleChange('avatarUrl', '');
      setPhotoStatus('Profile photo updated.');
    } else {
      setPhotoStatus('Unable to attach photo.');
    }
  };

  const handlePickFromLibrary = async () => {
    setPhotoStatus(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoStatus('Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) {
      setPhotoStatus('Selection cancelled.');
      return;
    }
    const base64 = result.assets?.[0]?.base64;
    if (base64) {
      handleChange('avatarPhoto', base64);
      handleChange('avatarUrl', '');
      setPhotoStatus('Photo selected.');
    } else {
      setPhotoStatus('Unable to attach photo.');
    }
  };

  const handleRemovePhoto = () => {
    handleChange('avatarPhoto', null);
    handleChange('avatarUrl', '');
    setPhotoStatus('Photo removed.');
  };

  const handleSubmit = async () => {
    setFeedback(null);
    setLoading(true);
    try {
      const payload = await updateProfileRequest({
        name: form.name,
        email: form.email,
        weightCategory: form.weightCategory,
        password: form.password || undefined,
        currentPassword: form.currentPassword,
        stravaClientId: form.stravaClientId,
        stravaClientSecret: form.stravaClientSecret,
        stravaRedirectUri: form.stravaRedirectUri,
        avatar: form.avatarUrl.trim() ? form.avatarUrl.trim() : null,
        avatarPhoto:
          form.avatarPhoto === null ? null : form.avatarPhoto ? form.avatarPhoto : undefined,
      });
      await setSessionFromPayload(payload);
      setFeedback('Profile updated.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to update profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyApiUrl = async () => {
    setApiUrlFeedback(null);
    setApiUrlSaving(true);
    try {
      await updateBaseUrl(apiUrlInput);
      setApiUrlFeedback('API base URL updated. New requests will use this server.');
    } catch (error) {
      setApiUrlFeedback(error instanceof Error ? error.message : 'Unable to update API base URL.');
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
    } catch (error) {
      setApiUrlFeedback(error instanceof Error ? error.message : 'Unable to reset API base URL.');
    } finally {
      setApiUrlSaving(false);
    }
  };

  return (
    <RefreshableScrollView
      contentContainerStyle={styles.container}
      refreshing={false}
      onRefresh={() => {
        // no-op: profile data is already live through auth session
      }}
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <SectionHeader title="Profile photo" subtitle="Show who you are" />
        <View style={styles.avatarRow}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.avatarPreview} />
          ) : (
            <View style={[styles.avatarPreview, styles.avatarPlaceholder]}>
              <AppText variant="label">No photo</AppText>
            </View>
          )}
          <View style={styles.avatarActions}>
            <AppButton title="Take photo" variant="ghost" onPress={handleTakePhoto} />
            <AppButton title="Choose from library" variant="ghost" onPress={handlePickFromLibrary} />
            {form.avatarPhoto || form.avatarUrl ? (
              <AppButton title="Remove photo" variant="ghost" onPress={handleRemovePhoto} />
            ) : null}
          </View>
        </View>
        <AppInput
          label="Avatar URL (optional)"
          autoCapitalize="none"
          value={form.avatarUrl}
          onChangeText={(value) => handleChange('avatarUrl', value)}
        />
        {photoStatus ? (
          <AppText variant="muted" style={styles.helperText}>
            {photoStatus}
          </AppText>
        ) : null}
      </Card>
      <Card>
        <SectionHeader title="Profile" subtitle="Account details" />
        <AppInput label="Name" value={form.name} onChangeText={(value) => handleChange('name', value)} />
        <AppInput label="Email" autoCapitalize="none" value={form.email} onChangeText={(value) => handleChange('email', value)} />
        <AppInput label="Weight category" value={form.weightCategory} onChangeText={(value) => handleChange('weightCategory', value)} />
        <AppInput
          label="New password"
          secureTextEntry
          value={form.password}
          onChangeText={(value) => handleChange('password', value)}
        />
      </Card>
      <Card>
        <SectionHeader title="Strava API" subtitle="Personal client keys" />
        <AppInput
          label="Client ID"
          autoCapitalize="none"
          value={form.stravaClientId}
          onChangeText={(value) => handleChange('stravaClientId', value)}
        />
        <AppInput
          label="Client secret"
          autoCapitalize="none"
          value={form.stravaClientSecret}
          onChangeText={(value) => handleChange('stravaClientSecret', value)}
        />
        <AppInput
          label="Redirect URL"
          autoCapitalize="none"
          value={form.stravaRedirectUri}
          onChangeText={(value) => handleChange('stravaRedirectUri', value)}
        />
      </Card>
      <Card>
        <SectionHeader title="Confirm changes" subtitle="Enter your current password to save" />
        <AppText variant="muted" style={styles.helperText}>
          For security, you must confirm any updates with your current password. This protects profile,
          Strava, and photo changes.
        </AppText>
        <AppInput
          label="Current password"
          secureTextEntry
          value={form.currentPassword}
          onChangeText={(value) => handleChange('currentPassword', value)}
        />
      </Card>
      <Card>
        <SectionHeader title="Connection" subtitle="Configure the backend server for this app" />
        <AppInput
          label="API base URL"
          autoCapitalize="none"
          autoCorrect={false}
          value={apiUrlInput}
          onChangeText={setApiUrlInput}
        />
        {apiUrlFeedback ? (
          <AppText variant="muted" style={styles.helperText}>
            {apiUrlFeedback}
          </AppText>
        ) : null}
        <View style={styles.connectionRow}>
          <AppButton title="Apply" onPress={handleApplyApiUrl} loading={apiUrlSaving} />
          <AppButton
            title="Reset to default"
            variant="ghost"
            onPress={handleResetApiUrl}
            disabled={apiUrlSaving}
          />
        </View>
      </Card>
      {feedback ? (
        <AppText variant="muted" style={styles.feedback}>
          {feedback}
        </AppText>
      ) : null}
      <AppButton title="Save changes" onPress={handleSubmit} loading={loading} />
    </RefreshableScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  feedback: {
    textAlign: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatarPreview: {
    width: 96,
    height: 96,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.glass,
  },
  avatarActions: {
    flex: 1,
    gap: spacing.sm,
  },
  helperText: {
    marginTop: spacing.sm,
  },
  connectionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
});
