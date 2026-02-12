import { createClient } from '@supabase/supabase-js';

// Supabase Configuration
// Try environment variables first, fall back to direct values
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://iqgglsbbmothqxfigeol.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_5EOMGS6inRAeSUaVr6bJTQ_F2AUadOv';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
