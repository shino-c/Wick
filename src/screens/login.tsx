import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';

import { supabase, hasSupabase } from '@/lib/supabaseClient';
import { colors, font, radius, shadow, spacing } from '@/theme';

/* ─── validation helpers ────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  identifier?: string;
  password?: string;
}

function validateIdentifier(v: string): string | undefined {
  if (!v) return 'Email or username is required';
  return undefined;
}

function validatePassword(v: string): string | undefined {
  if (!v) return 'Password is required';
  return undefined;
}

/* ─── WickMark (brand sparkle) ─────────────────────────────────────────── */

function WickMark({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2L14.4 8.6L21 11L14.4 13.4L12 20L9.6 13.4L3 11L9.6 8.6L12 2Z"
        fill="#C29569"
      />
      <Circle cx="19" cy="5" r="1.5" fill="#C29569" />
    </Svg>
  );
}

/* ─── component ─────────────────────────────────────────────────────────── */

export default function LoginScreen() {
  const router = useRouter();

  // Redirect already‑signed‑in users straight to the baseline step.
  useEffect(() => {
    async function checkAuth() {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        router.replace('/baseline');
      }
    }
    checkAuth();
  }, [router]);

  // The user can type either their email or username.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors: FieldErrors = {
    identifier: validateIdentifier(identifier),
    password: validatePassword(password),
  };

  const hasAnyError = Object.values(errors).some(Boolean);

  const markTouched = useCallback(
    (field: string) =>
      setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
    [],
  );

  /* ── resolve username → email ─────────────────────────────────────────── */

  async function resolveEmail(raw: string): Promise<string> {
    const trimmed = raw.trim().toLowerCase();

    // Looks like an email — use as-is.
    if (EMAIL_RE.test(trimmed)) return trimmed;

    // Try to look up the email by username via the profiles table.
    try {
      const { data, error } = await supabase.rpc('get_email_for_username', {
        lookup_username: trimmed,
      });
      if (!error && data) return data as string;
    } catch {
      // RPC not deployed — fall through.
    }

    // Last resort: let Supabase try it as an email (will fail with a clear
    // error message if it's really a username and the RPC isn't set up).
    return trimmed;
  }

  /* ── submit ────────────────────────────────────────────────────────────── */

  const handleLogin = async () => {
    setTouched({ identifier: true, password: true });
    if (hasAnyError) return;

    if (!hasSupabase) {
      setServerError(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file.',
      );
      return;
    }

    setLoading(true);
    setServerError(null);

    try {
      const email = await resolveEmail(identifier);

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      router.replace('/baseline');
    } catch (err: any) {
      const msg = err?.message ?? 'Login failed. Please try again.';
      if (msg.includes('Invalid login credentials')) {
        setServerError('Incorrect email/username or password.');
      } else if (msg.includes('Email not confirmed')) {
        setServerError('Please confirm your email before logging in.');
      } else {
        setServerError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ── render ─────────────────────────────────────────────────────────────── */

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.background}
      >
        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <View style={styles.logoContainer}>
          <View style={styles.logoRow}>
            <Text style={styles.logoText}>Wick</Text>
            <View style={styles.sparkle}>
              <WickMark size={28} />
            </View>
          </View>
          <Text style={styles.tagline}>Welcome back</Text>
        </View>

        {/* ── Card ─────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.heading}>Log In</Text>

          {serverError && <Text style={styles.serverError}>{serverError}</Text>}

          {/* Email or Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email or Username</Text>
            <TextInput
              placeholder="you@example.com or username"
              placeholderTextColor={colors.inkFaint}
              value={identifier}
              onChangeText={(v) => {
                setIdentifier(v);
                setServerError(null);
              }}
              onBlur={() => markTouched('identifier')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              style={[
                styles.input,
                touched.identifier && errors.identifier
                  ? styles.inputError
                  : null,
              ]}
            />
            {touched.identifier && errors.identifier && (
              <Text style={styles.fieldError}>{errors.identifier}</Text>
            )}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              placeholder="Your password"
              placeholderTextColor={colors.inkFaint}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setServerError(null);
              }}
              onBlur={() => markTouched('password')}
              secureTextEntry
              textContentType="password"
              style={[
                styles.input,
                touched.password && errors.password ? styles.inputError : null,
              ]}
            />
            {touched.password && errors.password && (
              <Text style={styles.fieldError}>{errors.password}</Text>
            )}
          </View>

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.buttonText}>Log In</Text>
            )}
          </Pressable>

          {/* Navigate to signup */}
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push('/signup')}
          >
            <Text style={styles.secondaryText}>
              Don't have an account?{' '}
              <Text style={styles.secondaryLink}>Sign up</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ─── styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  background: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing(6),
    paddingVertical: spacing(12),
  },

  /* Logo */
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing(10),
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 42,
    fontFamily: font.bold,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  sparkle: {
    marginLeft: spacing(1),
    marginTop: -4,
  },
  tagline: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.inkSoft,
    marginTop: spacing(1),
  },

  /* Card */
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(6),
    ...shadow.card,
  },
  heading: {
    fontFamily: font.semibold,
    fontSize: 22,
    color: colors.ink,
    marginBottom: spacing(5),
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  serverError: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.alert,
    backgroundColor: colors.alertWash,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    marginBottom: spacing(4),
    textAlign: 'center',
    overflow: 'hidden',
  },

  /* Fields */
  fieldGroup: {
    marginBottom: spacing(4),
  },
  label: {
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.inkSoft,
    marginBottom: spacing(1),
    marginLeft: spacing(1),
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing(4),
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.cream,
  },
  inputError: {
    borderColor: colors.alert,
    borderWidth: 1.5,
  },
  fieldError: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.alert,
    marginTop: spacing(1),
    marginLeft: spacing(1),
  },

  /* Buttons */
  button: {
    height: 50,
    borderRadius: radius.lg,
    backgroundColor: colors.brown,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing(2),
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: font.semibold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  secondaryButton: {
    marginTop: spacing(4),
    alignItems: 'center',
  },
  secondaryText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.inkSoft,
  },
  secondaryLink: {
    fontFamily: font.semibold,
    color: colors.brown,
  },
});