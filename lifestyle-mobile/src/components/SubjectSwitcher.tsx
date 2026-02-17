import { ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppText } from './AppText';
import { colors } from '../theme';
import { useAuth } from '../providers/AuthProvider';
import { useSubject } from '../providers/SubjectProvider';
import { athletesRequest } from '../api/endpoints';
import { AthleteSummary } from '../api/types';
import { formatNumber } from '../utils/format';

export function SubjectSwitcher() {
  const { user } = useAuth();
  const { subjectId, setSubjectId } = useSubject();
  const isCoach = user?.role === 'Coach' || user?.role === 'Head Coach';

  const { data } = useQuery({
    queryKey: ['roster'],
    queryFn: athletesRequest,
    enabled: isCoach,
  });

  if (!isCoach) {
    return (
      <View style={styles.currentSubject}>
        <AppText variant="label">Viewing</AppText>
        <AppText variant="heading">{user?.name}</AppText>
      </View>
    );
  }

  const athletes: AthleteSummary[] = data?.athletes ?? [];
  const chips: Array<{
    id: number;
    label: string;
    description?: string;
    meta?: string;
    isSelf?: boolean;
  }> = [];

  if (user?.id) {
    chips.push({
      id: user.id,
      label: 'My dashboard',
      description: user.name,
      meta: user.role,
      isSelf: true,
    });
  }

  athletes
    .filter((athlete) => athlete.id !== user?.id)
    .forEach((athlete) => {
      const rankLabel = athlete.rank ? `Rank #${athlete.rank}` : null;
      const readiness =
        typeof athlete.readinessScore === 'number' ? `${athlete.readinessScore}% readiness` : null;
      const stepsValue = formatNumber(athlete.steps);
      const stepsLabel = stepsValue !== '--' ? `${stepsValue} steps` : null;
      const metaParts = [rankLabel, readiness, stepsLabel].filter(Boolean);
      chips.push({
        id: athlete.id,
        label: athlete.name,
        description: athlete.role,
        meta: metaParts.length ? metaParts.join(' • ') : undefined,
      });
    });

  if (!chips.length) {
    return (
      <View style={styles.currentSubject}>
        <AppText variant="label">Viewing</AppText>
        <AppText variant="heading">{user?.name}</AppText>
      </View>
    );
  }

  return (
    <View>
      <AppText variant="label" style={styles.label}>
        Viewing athlete
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.switcherRow}>
        {chips.map((chip) => {
          const isSelfSelected = chip.isSelf && (!subjectId || subjectId === user?.id);
          const selected = chip.isSelf ? isSelfSelected : subjectId === chip.id;
          const handlePress = () => {
            if (chip.isSelf) {
              setSubjectId(user?.id ?? null);
              return;
            }
            setSubjectId(chip.id);
          };
          return (
            <Pressable
              key={chip.isSelf ? 'self' : chip.id}
              style={[styles.pill, selected && styles.pillSelected]}
              onPress={handlePress}
            >
              <AppText variant="body" style={selected ? styles.pillTextSelected : undefined}>
                {chip.label}
              </AppText>
              {chip.description ? (
                <AppText
                  variant="muted"
                  style={[styles.pillDescription, selected && styles.pillTextSelected]}
                  numberOfLines={1}
                >
                  {chip.description}
                </AppText>
              ) : null}
              {chip.meta ? (
                <AppText
                  variant="muted"
                  style={[styles.pillMeta, selected && styles.pillTextSelected]}
                  numberOfLines={1}
                >
                  {chip.meta}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: 8,
  },
  switcherRow: {
    gap: 12,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    minWidth: 180,
  },
  pillSelected: {
    backgroundColor: 'rgba(77,245,255,0.15)',
    borderColor: colors.accent,
  },
  pillTextSelected: {
    color: colors.accent,
  },
  pillDescription: {
    marginTop: 4,
  },
  pillMeta: {
    marginTop: 2,
    fontSize: 12,
  },
  currentSubject: {
    marginBottom: 12,
  },
});
