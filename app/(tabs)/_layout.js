import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../../src/constants';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        tabBarActiveTintColor: colors.primaryLight,
        tabBarInactiveTintColor: colors.textMuted,

        tabBarLabelStyle: {
          fontFamily: 'Oswald_600SemiBold',
          fontSize: 10,
          letterSpacing: 0.2,
        },

        tabBarItemStyle: {
          paddingTop: 5,
        },

        tabBarStyle: {
          height: 72,
          paddingTop: 5,
          paddingBottom: 7,

          backgroundColor: '#090C10',

          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.10)',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="home-outline"
              size={23}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="planning"
        options={{
          title: 'Planning',
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="calendar-outline"
              size={23}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="progression"
        options={{
          title: 'Progression',
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="stats-chart-outline"
              size={23}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="library"
        options={{
          title: 'Bibliothèque',
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="barbell-outline"
              size={23}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}