import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const KAKI = '#909C89';
const TEXT_MUTED = '#778178';
const BORDER = 'rgba(173,184,170,0.16)';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: KAKI,
        tabBarInactiveTintColor: TEXT_MUTED,
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
          backgroundColor: '#0A0E0C',
          borderTopWidth: 1,
          borderTopColor: BORDER,
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
