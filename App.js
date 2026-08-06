import React from 'react';
import { StatusBar, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/LoginScreen';
import { UserProvider } from './src/context/UserContext';

const Stack = createNativeStackNavigator();

const PlaceholderScreen = ({ route }) => (
  <View style={styles.placeholderContainer}>
    <Text style={styles.placeholderTitle}>Écran {route.name}</Text>
    <Text style={styles.placeholderSub}>En cours de construction...</Text>
  </View>
);

export default function App() {
  return (
    <SafeAreaProvider>
      <UserProvider>
        <StatusBar barStyle="light-content" backgroundColor="#07090C" />
        <NavigationContainer 
          theme={{ 
            ...DarkTheme, 
            colors: { 
              ...DarkTheme.colors, 
              background: '#07090C',
              card: '#12161F',
              border: 'rgba(255, 255, 255, 0.07)',
              text: '#FFFFFF',
              primary: '#0055A4',
            } 
          }}
        >
          <Stack.Navigator 
            initialRouteName="Login"
            screenOptions={{ 
              headerShown: false,
              contentStyle: { backgroundColor: '#07090C' },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Onboarding" component={PlaceholderScreen} />
            <Stack.Screen name="Main" component={PlaceholderScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </UserProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  placeholderContainer: {
    flex: 1,
    backgroundColor: '#07090C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  placeholderSub: {
    color: '#94A3B8',
    marginTop: 8,
  },
});