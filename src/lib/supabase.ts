import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

export const rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const rawSupabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

export const isSupabaseConfigured =
  Boolean(rawSupabaseUrl) &&
  !rawSupabaseUrl.includes('your-project-id') &&
  Boolean(rawSupabaseAnonKey) &&
  !rawSupabaseAnonKey.includes('your-supabase-anon-key');

// Fallback aman agar createClient tidak melempar Uncaught Error saat build/load awal di Vercel
export const supabaseUrl = isSupabaseConfigured ? rawSupabaseUrl : 'https://placeholder.supabase.co';
export const supabaseAnonKey = isSupabaseConfigured ? rawSupabaseAnonKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Client khusus pendaftaran akun oleh admin: TANPA persistSession supaya
// sesi admin yang sedang login tidak tertimpa menjadi user baru.
export const signUpClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-signup-temp',
  },
});
