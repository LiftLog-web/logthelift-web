import type { SupabaseClient } from '@supabase/supabase-js';

export async function checkPractitionerAccess(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('practitioner_subscriptions')
    .select('status, grandfathered, trial_end')
    .eq('practitioner_id', userId)
    .single();

  if (!data) return false;

  const now = new Date();
  const trialEnd = (data as any).trial_end ? new Date((data as any).trial_end) : null;
  const trialActive = data.status === 'trialing' && trialEnd !== null && trialEnd > now;

  return !!(data as any).grandfathered || data.status === 'active' || data.status === 'past_due' || trialActive;
}
