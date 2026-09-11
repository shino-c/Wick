import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

function validateUsername(v: string): string | undefined {
  if (!v) return 'Username is required';
  if (v.length < 3) return 'Username must be at least 3 characters';
  if (v.length > 20) return 'Username must be 20 characters or less';
  if (!USERNAME_RE.test(v)) return 'Only letters, numbers, and underscores';
  return undefined;
}

function validateEmail(v: string): string | undefined {
  if (!v) return 'Email is required';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address';
  return undefined;
}

function validatePassword(v: string): string | undefined {
  if (!v) return 'Password is required';
  if (v.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  return undefined;
}

function validateConfirmPassword(
  password: string,
  confirm: string,
): string | undefined {
  if (!confirm) return 'Please confirm your password';
  if (password !== confirm) return 'Passwords do not match';
  return undefined;
}

/* ─── username availability ─────────────────────────────────────────────── */

// Usernames live in the profiles table (the handle_new_user() trigger puts
// them there), so uniqueness is checked against it. Prefers the
// is_username_taken() RPC and falls back to a plain profile lookup, so the
// check still works before the RPC is deployed.
async function usernameTaken(username: string): Promise<boolean> {
  const name = username.trim().toLowerCase();
  if (!name) return false;

  const { data, error } = await supabase.rpc('is_username_taken', {
    p_username: name,
  });
  if (!error) return data === true;

  // RPC missing — fall back to reading the profiles table directly.
  const { data: rows, error: lookupError } = await supabase
    .from('profiles')
    .select('username')
    .eq('username', name)
    .limit(1);
  if (lookupError) throw lookupError;
  return (rows?.length ?? 0) > 0;
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

export default function SignupScreen() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Track which fields have been touched (blurred) so we only show
  // errors after the user has interacted with a field.
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Username availability — probed (debounced) against the profiles table.
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken'
  >('idle');
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live validation — recomputed on every render (cheap).
  const errors: FieldErrors = {
    username: validateUsername(username),
    email: validateEmail(email),
    password: validatePassword(password),
    confirmPassword: validateConfirmPassword(password, confirmPassword),
  };

  const hasAnyError =
    Object.values(errors).some(Boolean) || usernameStatus === 'taken';

  const markTouched = useCallback(
    (field: string) =>
      setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
    [],
  );

  /* ── username availability check ────────────────────────────────────────── */

  // Malformed usernames skip the probe — the local validation already shows
  // why. A failed probe (offline, permissions) is ignored here; submitting
  // still re-checks, and the server-side unique constraint is the final
  // authority.
  const checkUsername = useCallback(async (value: string) => {
    const name = value.trim();
    if (!USERNAME_RE.test(name) || !hasSupabase) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    try {
      setUsernameStatus((await usernameTaken(name)) ? 'taken' : 'available');
    } catch {
      setUsernameStatus('idle');
    }
  }, []);

  // Debounce: wait for a pause in typing before probing.
  useEffect(() => {
    if (!username.trim()) {
      setUsernameStatus('idle');
      return;
    }
    usernameTimer.current = setTimeout(() => checkUsername(username), 500);
    return () => {
      if (usernameTimer.current) clearTimeout(usernameTimer.current);
    };
  }, [username, checkUsername]);

  /* ── submit ────────────────────────────────────────────────────────────── */

  const handleSignup = async () => {
    // Touch all fields so errors become visible.
    setTouched({ username: true, email: true, password: true, confirmPassword: true });
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
      // 0. Re-check the username right before creating the account — the
      //    debounced probe can be stale if the user submits quickly.
      if (await usernameTaken(username.trim())) {
        setServerError(
          'This username is already taken. Please choose another.',
        );
        return;
      }

      // 1. Sign up. The `username` goes into raw_user_meta_data so the
      //    handle_new_user() database trigger picks it up and inserts it
      //    into the profiles table automatically.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { username: username.trim() },
        },
      });

      if (error) throw error;

      // If email confirmation is required, Supabase returns a user but
      // no session. Inform the user and send them to login.
      if (data.user && !data.session) {
        setServerError(
          'A confirmation email has been sent. Please verify your email and then log in.',
        );
        setLoading(false);
        // Navigate to login after a brief delay so the user can read the message.
        setTimeout(() => router.replace('/login'), 2000);
        return;
      }

      // Sign out so the user lands on the login screen (Supabase may
      // auto-sign-in on signup when email confirmation is disabled).
      await supabase.auth.signOut();
      router.replace('/login');
    } catch (err: any) {
      const msg = err?.message ?? 'Sign up failed. Please try again.';
      // A duplicate username can slip past the pre-check when two people
      // sign up at the same moment — the profiles unique constraint catches
      // it and we surface it here.
      if (msg.includes('duplicate key') || msg.includes('username_key')) {
        setServerError('This username is already taken. Please choose another.');
      } else if (
        msg.includes('already registered') ||
        msg.includes('already been registered')
      ) {
        setServerError('An account with this email already exists. Try logging in instead.');
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
          <Text style={styles.tagline}>Your calm starts here</Text>
        </View>

        {/* ── Card ─────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.heading}>Create Account</Text>

          {serverError && <Text style={styles.serverError}>{serverError}</Text>}

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              placeholder="e.g. wick_user"
              placeholderTextColor={colors.inkFaint}
              value={username}
              onChangeText={(v) => {
                setUsername(v);
                setServerError(null);
              }}
              onBlur={() => {
                markTouched('username');
                checkUsername(username);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                (touched.username && errors.username) ||
                usernameStatus === 'taken'
                  ? styles.inputError
                  : null,
              ]}
            />
            {touched.username && errors.username && (
              <Text style={styles.fieldError}>{errors.username}</Text>
            )}
            {usernameStatus === 'checking' && (
              <Text style={styles.fieldHint}>Checking availability…</Text>
            )}
            {usernameStatus === 'taken' && (
              <Text style={styles.fieldError}>
                This username is already taken
              </Text>
            )}
            {usernameStatus === 'available' && (
              <Text style={styles.fieldOk}>✓ Username available</Text>
            )}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              placeholder="you@example.com"
              placeholderTextColor={colors.inkFaint}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setServerError(null);
              }}
              onBlur={() => markTouched('email')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              style={[
                styles.input,
                touched.email && errors.email ? styles.inputError : null,
              ]}
            />
            {touched.email && errors.email && (
              <Text style={styles.fieldError}>{errors.email}</Text>
            )}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              placeholder="At least 6 characters"
              placeholderTextColor={colors.inkFaint}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setServerError(null);
              }}
              onBlur={() => markTouched('password')}
              secureTextEntry
              textContentType="newPassword"
              style={[
                styles.input,
                touched.password && errors.password ? styles.inputError : null,
              ]}
            />
            {touched.password && errors.password && (
              <Text style={styles.fieldError}>{errors.password}</Text>
            )}
          </View>

          {/* Confirm password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              placeholder="Re-enter your password"
              placeholderTextColor={colors.inkFaint}
              value={confirmPassword}
              onChangeText={(v) => {
                setConfirmPassword(v);
                setServerError(null);
              }}
              onBlur={() => markTouched('confirmPassword')}
              secureTextEntry
              textContentType="newPassword"
              style={[
                styles.input,
                touched.confirmPassword && errors.confirmPassword
                  ? styles.inputError
                  : null,
              ]}
            />
            {touched.confirmPassword && errors.confirmPassword && (
              <Text style={styles.fieldError}>{errors.confirmPassword}</Text>
            )}
          </View>

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </Pressable>

          {/* Navigate to login */}
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push('/login')}
          >
            <Text style={styles.secondaryText}>
              Already have an account?{' '}
              <Text style={styles.secondaryLink}>Log in</Text>
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
  fieldHint: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.inkFaint,
    marginTop: spacing(1),
    marginLeft: spacing(1),
  },
  fieldOk: {
    fontFamily: font.medium,
    fontSize: 12,
    color: colors.calm,
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

