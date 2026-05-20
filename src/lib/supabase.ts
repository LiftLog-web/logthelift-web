import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | undefined;

const handler: ProxyHandler<object> = {
  get(_target, prop, receiver) {
    if (!_client) {
      _client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
    }
    return Reflect.get(_client, prop, receiver);
  },
};

export const supabase = new Proxy({}, handler) as SupabaseClient;
