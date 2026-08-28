import { useWorkout } from '../../src/contexts/WorkoutContext';
import EnvironmentGeneratingScreen from './generating-environment';
import LegacyGeneratingScreen from './generating-legacy';

export default function GeneratingScreen() {
  const { preparation } = useWorkout();
  const environmentCode = String(
    preparation?.environmentCode ?? 'HOME'
  )
    .trim()
    .toUpperCase();

  if (['GYM', 'OUTDOOR'].includes(environmentCode)) {
    return <EnvironmentGeneratingScreen />;
  }

  return <LegacyGeneratingScreen />;
}
