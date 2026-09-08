import { useCallback, useState } from 'react';
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
import Svg, { Circle, Path } from 'react-native-svg';

import { hasSupabase, supabase } from '@/lib/supabaseClient';
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

  // Live validation — recomputed on every render (cheap).
  const errors: FieldErrors = {
    username: validateUsername(username),
    email: validateEmail(email),
    password: validatePassword(password),
    confirmPassword: validateConfirmPassword(password, confirmPassword),
  };

  const hasAnyError = Object.values(errors).some(Boolean);

  const markTouched = useCallback(
    (field: string) =>
      setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
    [],
  );

  /* ── submit ────────────────────────────────────────────────────────────── */

  const handleSignup = async () => {
  setTouched({
    username: true,
    email: true,
    password: true,
    confirmPassword: true,
  });

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
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: username.trim(),
        },
      },
    });

    if (error) throw error;

    // Supabase can automatically create a session when email confirmation
    // is disabled. We don't want a newly registered user to enter the app
    // automatically, so explicitly sign them out before going to login.
    if (data.session) {
      await supabase.auth.signOut();
    }

    // If email confirmation is enabled, the user needs to verify their
    // email before logging in. Otherwise, they can log in immediately.
    if (data.user && !data.session) {
      setServerError(
        'Account created successfully. Please confirm your email, then log in.',
      );
    }

    // Always send the user to the login screen after successful signup.
    router.replace('/login');
  } catch (err: any) {
    const msg = err?.message ?? 'Sign up failed. Please try again.';

    if (
      msg.includes('already registered') ||
      msg.includes('already been registered')
    ) {
      setServerError(
        'An account with this email already exists. Try logging in instead.',
      );
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
              onBlur={() => markTouched('username')}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                touched.username && errors.username ? styles.inputError : null,
              ]}
            />
            {touched.username && errors.username && (
              <Text style={styles.fieldError}>{errors.username}</Text>
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

