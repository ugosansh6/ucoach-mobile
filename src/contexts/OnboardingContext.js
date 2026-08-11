import { createContext, useContext, useMemo, useState } from 'react';

const OnboardingContext = createContext(null);

const EMPTY_STARTING_PROFILE = {
  strengths: [],
  weaknesses: [],
  unsure: false,
};

export function OnboardingProvider({ children }) {
  const [level, setLevel] = useState(null);
  const [goal, setGoal] = useState(null);
  const [weeklyTarget, setWeeklyTarget] = useState(null);
  const [startingProfile, setStartingProfile] = useState(
    EMPTY_STARTING_PROFILE
  );
  const [precautions, setPrecautions] = useState([]);

  function resetOnboarding() {
    setLevel(null);
    setGoal(null);
    setWeeklyTarget(null);
    setStartingProfile(EMPTY_STARTING_PROFILE);
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

      startingProfile,
      setStartingProfile,

      precautions,
      setPrecautions,

      resetOnboarding,
    }),
    [level, goal, weeklyTarget, startingProfile, precautions]
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
