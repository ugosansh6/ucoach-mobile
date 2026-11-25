import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';

export default function TabsLayout() {
  const { isDark } = useUgerodTheme();

  const palette = isDark
    ? {
        active: '#909C89',
        inactive: '#778178',
        background: '#0A0E0C',
        border: 'rgba(173,184,170,0.16)',
      }
    : {
        active: '#646F5E',
        inactive: '#7C8379',
        background: '#F4F2ED',
        border: 'rgba(54,61,52,0.13)',
      };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.active,
        tabBarInactiveTintColor: palette.inactive,
        tabBarLabelStyle: {
          fontFamily: 'Manrope_600SemiBold',
          fontSize: 9,
          letterSpacing: 0.15,
        },
        tabBarItemStyle: {
          paddingTop: 5,
        },
        tabBarStyle: {
          height: 72,
          paddingTop: 5,
          paddingBottom: 7,
          backgroundColor: palette.background,
          borderTopWidth: 1,
          borderTopColor: palette.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="planning"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="progression"
        options={{
          title: 'Progression',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="programmes"
        options={{
          title: 'Programmes',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'trophy' : 'trophy-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="library"
        options={{
          title: 'Bibliothèque',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'barbell' : 'barbell-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
