import { useLocalSearchParams } from 'expo-router';

import PreparationCheckinV4 from '../../src/workout/PreparationCheckinV4';
import WeekComposerV3 from '../../src/workout/WeekComposerV3';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function PreparationScreen() {
  const params = useLocalSearchParams();
  const entry = firstParam(params?.entry);
  const date = firstParam(params?.date);
  const isWeekComposer =
    entry === 'week_assisted' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) &&
    date >= localDateKey();

  if (isWeekComposer) {
    return <WeekComposerV3 />;
  }

  return <PreparationCheckinV4 />;
}
