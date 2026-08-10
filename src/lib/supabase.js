import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const appEnv =
  process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error(
    `EXPO_PUBLIC_SUPABASE_URL est absente pour l'environnement ${appEnv}.`
  );
}

if (!supabaseAnonKey) {
  throw new Error(
    `EXPO_PUBLIC_SUPABASE_ANON_KEY est absente pour l'environnement ${appEnv}.`
  );
}

export const APP_ENV = appEnv;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}