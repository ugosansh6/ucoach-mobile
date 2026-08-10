import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { supabase } from '../../src/lib/supabase';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

export default function AuthCallbackScreen() {
  const [message, setMessage] = useState(
    'Validation de ton compte...'
  );

  useEffect(() => {
    let mounted = true;
    let alreadyHandled = false;

    async function handleUrl(url) {
      if (!url || alreadyHandled) {
        return;
      }

      alreadyHandled = true;

      try {
        /*
         * Supabase peut renvoyer :
         *
         * ugerod://auth/callback#access_token=...
         * &refresh_token=...
         * &type=signup
         *
         * Les tokens sont donc récupérés dans le fragment
         * situé après le caractère "#".
         */
        const hashIndex = url.indexOf('#');

        if (hashIndex === -1) {
          throw new Error(
            'Le lien de confirmation ne contient pas de session.'
          );
        }

        const fragment = url.substring(hashIndex + 1);

        const params = new URLSearchParams(fragment);

        const accessToken =
          params.get('access_token');

        const refreshToken =
          params.get('refresh_token');

        const errorDescription =
          params.get('error_description');

        if (errorDescription) {
          throw new Error(
            decodeURIComponent(errorDescription)
          );
        }

        if (!accessToken || !refreshToken) {
          throw new Error(
            'Le lien de confirmation est invalide ou a expiré.'
          );
        }

        const {
          data,
          error,
        } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          throw error;
        }

        if (!data?.session?.user) {
          throw new Error(
            "Impossible d'ouvrir ta session UGEROD."
          );
        }

        if (!mounted) {
          return;
        }

        setMessage(
          'Compte confirmé. Préparation de ton profil...'
        );

        /*
         * Première connexion :
         * on lance l'onboarding.
         */
        router.replace('/onboarding/level');
      } catch (error) {
        alreadyHandled = false;

        if (!mounted) {
          return;
        }

        setMessage(
          error?.message ??
            'Impossible de confirmer ton compte.'
        );
      }
    }

    async function initialize() {
      const initialUrl =
        await Linking.getInitialURL();

      if (initialUrl) {
        await handleUrl(initialUrl);
      }
    }

    initialize();

    /*
     * Important lorsque l'application est déjà ouverte
     * au moment où l'utilisateur clique sur le mail.
     */
    const subscription =
      Linking.addEventListener(
        'url',
        ({ url }) => {
          handleUrl(url);
        }
      );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaView
      style={styles.screen}
    >
      <View
        style={styles.content}
      >
        <ActivityIndicator
          size="large"
          color={colors.primary}
        />

        <Text
          style={styles.title}
        >
          UGEROD
          <Text
            style={styles.blueDot}
          >
            .
          </Text>
        </Text>

        <Text
          style={styles.message}
        >
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal:
      spacing.xl,
  },

  title: {
    ...typography.display,
    color:
      colors.textPrimary,
    fontSize: 38,
    marginTop:
      spacing.xl,
  },

  blueDot: {
    color:
      colors.primary,
  },

  message: {
    ...typography.body,
    color:
      colors.textSecondary,
    textAlign: 'center',
    marginTop:
      spacing.md,
    maxWidth: 320,
  },
});