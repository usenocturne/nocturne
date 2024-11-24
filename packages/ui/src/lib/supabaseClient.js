import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient() {
  if (typeof window === 'undefined') return null;
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase credentials not found');
    return null;
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = getSupabaseClient();