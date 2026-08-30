import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wyanvkaoqxgceaxzlqvk.supabase.co";
const supabaseAnonKey = "sb_publishable_8B9yUBiabVYBcnhWoO2gWg_m6cSmPWd";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);