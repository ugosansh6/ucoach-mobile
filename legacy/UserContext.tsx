import React, { createContext, useState, useContext, ReactNode } from 'react';

// Structure de données Athlète (Data Architect schema)
export interface AthleteProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'RX' | 'ELITE';
  equipment?: string[];
  injuries?: string[];
  weeklyAvailability?: number;
  isAuthenticated: boolean;
}

interface UserContextType {
  user: AthleteProfile;
  updateUser: (data: Partial<AthleteProfile>) => void;
  logout: () => void;
}

const defaultState: AthleteProfile = {
  id: '',
  email: '',
  isAuthenticated: false,
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AthleteProfile>(defaultState);

  const updateUser = (data: Partial<AthleteProfile>) => {
    setUser((prev: AthleteProfile) => ({ ...prev, ...data }));
  };

  const logout = () => {
    setUser(defaultState);
  };

  return (
    <UserContext.Provider value={{ user, updateUser, logout }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser doit être utilisé à l’intérieur d’un UserProvider');
  }
  return context;
};