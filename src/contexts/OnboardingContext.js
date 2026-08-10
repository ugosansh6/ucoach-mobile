import { createContext, useContext, useMemo, useState } from 'react';

const OnboardingContext = createContext(null);

export function OnboardingProvider({ children }) {
  const [level, setLevel] = useState(null);
  const [goal, setGoal] = useState(null);
  const [weeklyTarget, setWeeklyTarget] = useState(null);
  const [precautions, setPrecautions] = useState([]);

  function resetOnboarding() {
    setLevel(null);
    setGoal(null);
    setWeeklyTarget(null);
    setPrecautions([]);
  }

  const value = useMemo(
    () => ({
      level,
      setLevel,

      goal,
      setGoal,

      weeklyTarget,
      setWeeklyTarget,

      precautions,
      setPrecautions,

      resetOnboarding,
    }),
    [level, goal, weeklyTarget, precautions]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error(
      'useOnboarding doit être utilisé dans OnboardingProvider'
    );
  }

  return context;
}