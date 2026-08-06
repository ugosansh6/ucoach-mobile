import { StyleSheet, Text, View } from 'react-native';

export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>UREGOD</Text>

      <View style={styles.tricolor}>
        <View style={[styles.segment, styles.blue]} />
        <View style={[styles.segment, styles.white]} />
        <View style={[styles.segment, styles.red]} />
      </View>

      <Text style={styles.message}>
        Expo Router est opérationnel.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#07090C',
    paddingHorizontal: 24,
  },

  brand: {
    color: '#F7F9FC',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 4,
  },

  tricolor: {
    flexDirection: 'row',
    width: 150,
    height: 5,
    marginTop: 10,
  },

  segment: {
    flex: 1,
  },

  blue: {
    backgroundColor: '#0868FF',
  },

  white: {
    backgroundColor: '#F7F9FC',
  },

  red: {
    backgroundColor: '#FF3B3B',
  },

  message: {
    color: '#98A2B3',
    fontSize: 16,
    marginTop: 32,
  },
});