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

export async function signIn(phone, pin) {
  const { data, error } = await supabase.functions.invoke('rider-auth', {
    body: { phone, pin },
  });
  if (error) return { error };
  if (!data?.success || !data.token_hash) {
    return { error: new Error(data?.error || 'Wrong phone number or PIN.') };
  }
  return supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'magiclink',
  });
}

export const signOut = () => supabase.auth.signOut();
