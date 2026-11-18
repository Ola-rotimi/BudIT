import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { AppText, Button, Field } from './ui';

const MIN_LENGTH = 8;

/**
 * Asks for a backup password. In `create` mode it asks twice and enforces a minimum length.
 * `onSubmit` returns an error message to show, or null when done.
 */
export function PasswordPrompt({
  visible,
  mode,
  title,
  message,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  mode: 'create' | 'enter';
  title: string;
  message: string;
  onSubmit: (password: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Remounted on each open so fields start empty. */}
      {visible && <PromptBody mode={mode} title={title} message={message} onSubmit={onSubmit} onCancel={onCancel} />}
    </Modal>
  );
}

function PromptBody({ mode, title, message, onSubmit, onCancel }: Omit<Parameters<typeof PasswordPrompt>[0], 'visible'>) {
  const t = useTheme();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === 'create') {
      if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
      if (password !== confirm) return setError('The passwords don’t match.');
    }
    if (!password) return setError('Enter the password.');
    setBusy(true);
    setError(null);
    const problem = await onSubmit(password);
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <View style={[styles.sheet, { backgroundColor: t.card }]}>
        <AppText variant="heading">{title}</AppText>
        <AppText variant="caption">{message}</AppText>
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          textContentType={mode === 'create' ? 'newPassword' : 'password'}
          autoFocus
        />
        {mode === 'create' && (
          <Field
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!shown}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
          />
        )}
        <Pressable onPress={() => setShown((s) => !s)} style={styles.show} hitSlop={8} accessibilityRole="button">
          <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={18} color={t.primary} />
          <AppText variant="caption" color={t.primary}>
            {shown ? 'Hide password' : 'Show password'}
          </AppText>
        </Pressable>
        {mode === 'create' && (
          <AppText variant="caption" color={t.warning}>
            Keep this password safe. Without it the backup can’t be opened, not even by BudT.
          </AppText>
        )}
        {error && (
          <AppText variant="caption" color={t.expense}>
            {error}
          </AppText>
        )}
        {busy ? (
          <ActivityIndicator color={t.primary} style={{ marginVertical: 12 }} />
        ) : (
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button title={mode === 'create' ? 'Encrypt' : 'Unlock'} icon="lock-closed" onPress={submit} style={{ flex: 1 }} />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderRadius: 18, padding: 18, gap: 12 },
  show: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', gap: 10 },
});
