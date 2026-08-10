import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../../src/lib/supabase';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const logo = require('../../assets/branding/ugerod-logo-white.png');

export default function EmailConfirmationScreen() {
  const { email } = useLocalSearchParams();

  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(null);

  const userEmail =
    typeof email === 'string'
      ? email.trim().toLowerCase()
      : '';

  function handleGoToLogin() {
    router.replace('/(auth)/login');
  }

  async function handleResendEmail() {
    if (!userEmail) {
      setMessageType('error');
      setMessage(
        "Impossible de retrouver l'adresse email. Recommence l'inscription."
      );
      return;
    }

    try {
      setIsResending(true);
      setMessage('');
      setMessageType(null);

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: userEmail,
        options: {
          emailRedirectTo: 'ugerod://auth/callback',
        },
      });

      if (error) {
        throw error;
      }

      setMessageType('success');
      setMessage(
        'Un nouvel email de confirmation vient de t’être envoyé.'
      );
    } catch (error) {
      console.log('RESEND CONFIRMATION ERROR', {
        message: error?.message,
        code: error?.code,
        status: error?.status,
      });

      setMessageType('error');
      setMessage(
        error?.message ??
          "Impossible de renvoyer l'email pour le moment."
      );
    } finally {
      setIsResending(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        style={styles.background}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(7,9,12,0.46)',
            'rgba(7,9,12,0.70)',
            'rgba(7,9,12,0.94)',
            'rgba(7,9,12,1)',
          ]}
          locations={[0, 0.32, 0.68, 1]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <View style={styles.content}>
            {/* HEADER */}
            <View style={styles.header}>
              <View style={styles.headerSpacer} />

              <Image
                source={logo}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <View style={styles.spacerTop} />

            {/* ICÔNE */}
            <View style={styles.iconWrapper}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="mail-outline"
                  size={34}
                  color={colors.brandWhite}
                />
              </View>
            </View>

            {/* TITRE */}
            <Text style={styles.eyebrow}>
              PLUS QU’UNE ÉTAPE
            </Text>

            <Text style={styles.title}>
              VÉRIFIE
              {'\n'}
              TON EMAIL
              <Text style={styles.blueDot}>.</Text>
            </Text>

            <Text style={styles.description}>
              Nous venons de t’envoyer un lien pour confirmer ton adresse email.
            </Text>

            {!!userEmail && (
              <Text style={styles.email}>
                {userEmail}
              </Text>
            )}

            <Text style={styles.descriptionSecondary}>
              Clique sur le lien reçu. UGEROD s’ouvrira ensuite automatiquement
              pour commencer ton profil.
            </Text>

            {/* INFO */}
            <View style={styles.infoCard}>
              <Ionicons
                name="information-circle-outline"
                size={21}
                color={colors.primaryLight}
              />

              <Text style={styles.infoText}>
                Si tu ne vois pas le message, vérifie aussi tes courriers
                indésirables.
              </Text>
            </View>

            {/* MESSAGE */}
            {!!message && (
              <View
                style={[
                  styles.messageCard,
                  messageType === 'success'
                    ? styles.messageSuccess
                    : styles.messageError,
                ]}
              >
                <Ionicons
                  name={
                    messageType === 'success'
                      ? 'checkmark-circle-outline'
                      : 'alert-circle-outline'
                  }
                  size={19}
                  color={
                    messageType === 'success'
                      ? '#43D17B'
                      : '#FF6B6B'
                  }
                />

                <Text style={styles.messageText}>
                  {message}
                </Text>
              </View>
            )}

            {/* RENVOYER EMAIL */}
            <Pressable
              onPress={handleResendEmail}
              disabled={isResending}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed &&
                  !isResending &&
                  styles.primaryButtonPressed,
                isResending &&
                  styles.primaryButtonDisabled,
              ]}
            >
              <Ionicons
                name="refresh-outline"
                size={19}
                color={colors.brandWhite}
              />

              <Text style={styles.primaryButtonText}>
                {isResending
                  ? 'ENVOI EN COURS...'
                  : 'RENVOYER L’EMAIL'}
              </Text>
            </Pressable>

            {/* RETOUR CONNEXION */}
            <Pressable
              onPress={handleGoToLogin}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="arrow-back-outline"
                size={17}
                color={colors.textSecondary}
              />

              <Text style={styles.secondaryButtonText}>
                RETOUR À LA CONNEXION
              </Text>
            </Pressable>

            <View style={styles.spacerBottom} />

            {/* FOOTER */}
            <Text style={styles.footer}>
              UGEROD · TON OBJECTIF. TA SÉANCE. TON ÉVOLUTION.
            </Text>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
    paddingBottom: 24,
    alignItems: 'center',
  },

  /* HEADER */

  header: {
    width: '100%',
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },

  headerSpacer: {
    flex: 1,
  },

  logo: {
    width: 105,
    height: 38,
  },

  spacerTop: {
    flex: 0.45,
  },

  spacerBottom: {
    flex: 1,
  },

  /* ICÔNE */

  iconWrapper: {
    alignItems: 'center',
    marginBottom: 19,
  },

  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* TITRE */

  eyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.1,
    color: colors.primaryLight,
    textAlign: 'center',
  },

  title: {
    ...typography.display,
    fontSize: 48,
    lineHeight: 51,
    letterSpacing: 2.2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 7,
  },

  blueDot: {
    color: colors.primary,
  },

  description: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 16,
  },

  email: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    color: colors.primaryLight,
    textAlign: 'center',
    marginTop: 6,
  },

  descriptionSecondary: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textPrimary,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 12,
  },

  /* INFO */

  infoCard: {
    width: '100%',
    minHeight: 68,
    marginTop: 26,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  infoText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  /* MESSAGE */

  messageCard: {
    width: '100%',
    minHeight: 52,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  messageSuccess: {
    backgroundColor: 'rgba(67,209,123,0.08)',
    borderColor: 'rgba(67,209,123,0.24)',
  },

  messageError: {
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderColor: 'rgba(255,107,107,0.24)',
  },

  messageText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  /* BOUTONS */

  primaryButton: {
    width: '100%',
    minHeight: 56,
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  primaryButtonDisabled: {
    opacity: 0.55,
  },

  primaryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },

  secondaryButton: {
    minHeight: 48,
    marginTop: 7,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  secondaryButtonText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.textSecondary,
  },

  /* FOOTER */

  footer: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.7,
    color: colors.textMuted,
    textAlign: 'center',
  },

  pressed: {
    opacity: 0.65,
  },
});