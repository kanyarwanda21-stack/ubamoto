import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// undefined = still loading, null = signed out, object = signed in.
export function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return session;
}

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email: email.trim(), password });

export const signOut = () => supabase.auth.signOut();
