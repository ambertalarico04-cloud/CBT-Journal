import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        try {
          setUser(user);
          if (user) {
            const userRef = doc(db, 'users', user.uid);
            let userDoc;
            try {
              userDoc = await getDoc(userRef);
            } catch (err: any) {
              handleFirestoreError(err, OperationType.GET, 'users');
              throw err;
            }
            
            if (!userDoc.exists()) {
              const newProfile: UserProfile = {
                uid: user.uid,
                email: user.email || 'no-email',
                displayName: user.displayName || '',
                theme: 'amoled',
                favoriteFonts: [],
                createdAt: new Date().toISOString()
              };
              await setDoc(userRef, newProfile).catch(e => handleFirestoreError(e, OperationType.CREATE, 'users'));
              setProfile(newProfile);
            } else {
              setProfile(userDoc.data() as UserProfile);
            }

            onSnapshot(userRef, (doc) => {
              if (doc.exists()) setProfile(doc.data() as UserProfile);
            }, (error) => {
              handleFirestoreError(error, OperationType.GET, 'users');
            });
          } else {
            setProfile(null);
          }
        } catch (e: any) {
          console.error(e);
          setErrorMsg(e.message || String(e));
        } finally {
          setLoading(false);
        }
      });
      return () => unsubscribe();
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Auth Init Error: ' + err.message);
      setLoading(false);
    }
  }, []);

  if (errorMsg) {
    return (
      <div style={{ color: 'red', margin: '20px', fontFamily: 'monospace' }}>
        <h3>Auth Error:</h3>
        <p>{errorMsg}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="text-neon-cyan uppercase tracking-widest animate-pulse">Initializing Neural Link...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
