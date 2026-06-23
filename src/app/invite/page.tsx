'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Status = 'loading' | 'ready' | 'success' | 'already' | 'error';

export default function InvitePage() {
  const [status, setStatus]   = useState<Status>('loading');
  const [action, setAction]   = useState<'accepted' | 'declined' | null>(null);
  const [gymName, setGymName] = useState('');
  const [linkId, setLinkId]   = useState('');
  const [error, setError]     = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const act = params.get('action') as 'accepted' | 'declined' | null;

    if (!id || !act || !['accepted', 'declined'].includes(act)) {
      setStatus('error');
      setError('Invalid invite link. Please contact your gym owner for a new invitation.');
      return;
    }

    setLinkId(id);
    setAction(act);

    supabase
      .from('gym_pt_links')
      .select('status, gym:gym_id(gym_name)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setStatus('error');
          setError('Invite not found. The link may have expired or already been used.');
          return;
        }
        const gym = Array.isArray(data.gym) ? data.gym[0] : data.gym;
        setGymName(gym?.gym_name ?? 'your gym');
        if (data.status !== 'pending') {
          setStatus('already');
        } else {
          setStatus('ready');
        }
      });
  }, []);

  const handleRespond = async () => {
    if (!linkId || !action) return;
    setStatus('loading');
    const { error: err } = await supabase
      .from('gym_pt_links')
      .update({ status: action, responded_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('status', 'pending');

    if (err) {
      setStatus('error');
      setError('Something went wrong. Please try again or contact support.');
    } else {
      setStatus('success');
    }
  };

  const isAccept = action === 'accepted';

  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-10 flex flex-col items-center gap-6 text-center">

        <span className="text-5xl font-bold" style={{ color: '#5fcfbf' }}>LiftLog</span>

        {status === 'loading' && (
          <>
            <div className="w-8 h-8 border-2 border-[#5fcfbf] border-t-transparent rounded-full animate-spin" />
            <p className="text-white/50">Loading your invitation...</p>
          </>
        )}

        {status === 'ready' && (
          <>
            <span className="text-5xl">{isAccept ? '🏢' : '👋'}</span>
            <h1 className="text-2xl font-bold">
              {isAccept ? `Join ${gymName}?` : `Decline invitation from ${gymName}?`}
            </h1>
            <p className="text-white/50 text-sm">
              {isAccept
                ? `Confirming will make you an active member of ${gymName} on LiftLog. The gym owner will be able to see your patient activity.`
                : `You can always accept a new invitation from the gym owner later.`}
            </p>
            <button
              onClick={handleRespond}
              className="w-full py-3 rounded-xl font-bold text-[#0f1117] text-lg"
              style={{ backgroundColor: isAccept ? '#5fcfbf' : '#EF4444' }}
            >
              {isAccept ? 'Accept Invitation' : 'Decline Invitation'}
            </button>
            <a href="/" className="text-white/30 text-sm hover:text-white/50 transition-colors">
              Back to LiftLog
            </a>
          </>
        )}

        {status === 'success' && (
          <>
            <span className="text-5xl">{isAccept ? '✅' : '👍'}</span>
            <h1 className="text-2xl font-bold">
              {isAccept ? 'You&apos;re in!' : 'Invitation declined'}
            </h1>
            <p className="text-white/50 text-sm">
              {isAccept
                ? `You&apos;ve successfully joined ${gymName}. Open the LiftLog app to see your gym membership.`
                : `You&apos;ve declined the invitation from ${gymName}. No further action is needed.`}
            </p>
            <a
              href="https://apps.apple.com/app/id6762567982"
              className="w-full py-3 rounded-xl font-bold text-[#0f1117] text-center"
              style={{ backgroundColor: '#5fcfbf' }}
            >
              Open on App Store (iOS)
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.logthelift.app"
              className="w-full py-3 rounded-xl font-bold text-center"
              style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}
            >
              Open on Google Play (Android)
            </a>
          </>
        )}

        {status === 'already' && (
          <>
            <span className="text-5xl">ℹ️</span>
            <h1 className="text-2xl font-bold">Already responded</h1>
            <p className="text-white/50 text-sm">
              This invitation has already been responded to. Open the LiftLog app to view your gym membership status.
            </p>
            <a
              href="https://apps.apple.com/app/id6762567982"
              className="w-full py-3 rounded-xl font-bold text-[#0f1117] text-center"
              style={{ backgroundColor: '#5fcfbf' }}
            >
              Open on App Store (iOS)
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.logthelift.app"
              className="w-full py-3 rounded-xl font-bold text-center"
              style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}
            >
              Open on Google Play (Android)
            </a>
          </>
        )}

        {status === 'error' && (
          <>
            <span className="text-5xl">⚠️</span>
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-white/50 text-sm">{error}</p>
            <a href="/" className="text-[#5fcfbf] text-sm hover:underline">Back to LiftLog</a>
          </>
        )}
      </div>
    </div>
  );
}
