import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://oiugmbbqigzswlndaidd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VX7YM-ESx-wpF77a1AkMqA_oRXXAuyM';

let _client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

const handler: ProxyHandler<object> = {
  get(_target, prop) {
    const client = getSupabase();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
};

export const supabase = new Proxy({}, handler) as SupabaseClient;
