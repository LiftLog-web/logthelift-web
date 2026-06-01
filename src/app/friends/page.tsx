'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

/* ── Types ──────────────────────────────────────────────────── */
interface FriendProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  friend_code: string;
  sharing_preferences: { share_workouts: boolean; share_prs: boolean } | null;
}

interface FriendEntry   { friendshipId: string; friend: FriendProfile; }
interface PendingIn     { friendshipId: string; requester: Pick<FriendProfile, 'id' | 'display_name' | 'avatar_url'>; }

interface Reaction  { id: string; reactor_id: string; reaction: string; }
interface Comment   { id: string; commenter_id: string; commenter_name: string; text: string; created_at: string; }

interface FeedItem {
  workoutId: string;
  userId: string;
  date: string;
  data: any;
  friend: Pick<FriendProfile, 'id' | 'display_name' | 'avatar_url'>;
  reactions: Reaction[];
  comments: Comment[];
}

type FshipStatus = 'none' | 'pending_out' | 'pending_in' | 'accepted';
interface SearchResult extends Pick<FriendProfile, 'id' | 'display_name' | 'avatar_url' | 'friend_code'> {
  status: FshipStatus;
}

/* ── Small helpers ───────────────────────────────────────────── */
function initials(name: string) {
  return name.split(' ').slice(0, 2).map(n => n[0] ?? '').join('').toUpperCase();
}
function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function Av({ p, size = 40 }: { p: Pick<FriendProfile, 'display_name' | 'avatar_url'>; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${TEAL}22`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: size * 0.36, fontWeight: 700, color: TEAL }}>
      {p.avatar_url
        ? <img src={p.avatar_url} alt={p.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initials(p.display_name)}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
export default function FriendsPage() {
  const router = useRouter();

  const [authed,     setAuthed]     = useState(false);
  const [userId,     setUserId]     = useState('');
  const [myName,     setMyName]     = useState('');
  const [myCode,     setMyCode]     = useState('');
  const [tab,        setTab]        = useState<'feed' | 'friends'>('feed');
  const [loading,    setLoading]    = useState(true);

  const [feed,       setFeed]       = useState<FeedItem[]>([]);
  const [friends,    setFriends]    = useState<FriendEntry[]>([]);
  const [pendingIn,  setPendingIn]  = useState<PendingIn[]>([]);
  const [pendingOut, setPendingOut] = useState<Set<string>>(new Set());

  const [search,     setSearch]     = useState('');
  const [searchRes,  setSearchRes]  = useState<SearchResult[]>([]);
  const [searching,  setSearching]  = useState(false);

  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [inputs,     setInputs]     = useState<Record<string, string>>({});
  const [copied,     setCopied]     = useState(false);

  /* ── Load data ─────────────────────────────────────────────── */
  const loadAll = useCallback(async (uid: string) => {
    const sb = getSupabase();

    const { data: fships } = await sb
      .from('friendships')
      .select('id, requester_id, recipient_id, status')
      .or(`requester_id.eq.${uid},recipient_id.eq.${uid}`);

    const accepted    = (fships ?? []).filter(f => f.status === 'accepted');
    const incomingReq = (fships ?? []).filter(f => f.status === 'pending' && f.recipient_id === uid);
    const outgoing    = new Set((fships ?? []).filter(f => f.status === 'pending' && f.requester_id === uid).map(f => f.recipient_id));
    setPendingOut(outgoing);

    const friendIds    = accepted.map(f => f.requester_id === uid ? f.recipient_id : f.requester_id);
    const requesterIds = incomingReq.map(f => f.requester_id);
    const allIds       = [...new Set([...friendIds, ...requesterIds])];

    let profileMap: Record<string, FriendProfile> = {};
    if (allIds.length > 0) {
      const { data: profs } = await sb
        .from('profiles')
        .select('id, display_name, avatar_url, friend_code, sharing_preferences')
        .in('id', allIds);
      (profs ?? []).forEach((p: FriendProfile) => { profileMap[p.id] = p; });
    }

    setFriends(accepted
      .map(f => {
        const fid = f.requester_id === uid ? f.recipient_id : f.requester_id;
        return { friendshipId: f.id, friend: profileMap[fid] };
      })
      .filter(e => e.friend));

    setPendingIn(incomingReq
      .map(f => ({ friendshipId: f.id, requester: profileMap[f.requester_id] }))
      .filter(e => e.requester));

    /* Feed: workouts from sharing-enabled friends */
    const sharingIds = friendIds.filter(fid => profileMap[fid]?.sharing_preferences?.share_workouts !== false);
    if (sharingIds.length === 0) return;

    const { data: workouts } = await sb
      .from('synced_workouts')
      .select('id, user_id, date, data')
      .in('user_id', sharingIds)
      .order('date', { ascending: false })
      .limit(40);

    if (!workouts?.length) return;

    const wids = workouts.map(w => w.id);
    const [{ data: rxns }, { data: cmts }] = await Promise.all([
      sb.from('workout_reactions').select('id, workout_id, reactor_id, reaction').in('workout_id', wids),
      sb.from('workout_comments').select('id, workout_id, commenter_id, commenter_name, text, created_at').in('workout_id', wids).order('created_at', { ascending: true }),
    ]);

    const rxnMap: Record<string, Reaction[]> = {};
    (rxns ?? []).forEach((r: any) => { (rxnMap[r.workout_id] ??= []).push(r); });
    const cmtMap: Record<string, Comment[]> = {};
    (cmts ?? []).forEach((c: any) => { (cmtMap[c.workout_id] ??= []).push(c); });

    setFeed(workouts
      .map(w => ({ workoutId: w.id, userId: w.user_id, date: w.date, data: w.data, friend: profileMap[w.user_id], reactions: rxnMap[w.id] ?? [], comments: cmtMap[w.id] ?? [] }))
      .filter(f => f.friend));
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const uid = data.session.user.id;
      const { data: prof } = await sb.from('profiles').select('display_name, friend_code, role').eq('id', uid).single();
      if (!prof || prof.role !== 'patient') { router.push('/profile'); return; }
      setUserId(uid);
      setMyName(prof.display_name ?? '');
      setMyCode(prof.friend_code ?? '');
      setAuthed(true);
      await loadAll(uid);
      setLoading(false);
    });
  }, [router, loadAll]);

  /* ── Friend actions ─────────────────────────────────────────── */
  const accept = async (fshipId: string) => {
    await getSupabase().from('friendships').update({ status: 'accepted' }).eq('id', fshipId);
    await loadAll(userId);
  };

  const decline = async (fshipId: string) => {
    await getSupabase().from('friendships').delete().eq('id', fshipId);
    setPendingIn(prev => prev.filter(p => p.friendshipId !== fshipId));
  };

  const removeFriend = async (fshipId: string) => {
    if (!confirm('Remove this friend?')) return;
    await getSupabase().from('friendships').delete().eq('id', fshipId);
    setFriends(prev => prev.filter(f => f.friendshipId !== fshipId));
    setFeed(prev => prev.filter(f => friends.find(e => e.friendshipId === fshipId)?.friend.id !== f.userId));
  };

  const sendRequest = async (targetId: string) => {
    await getSupabase().from('friendships').insert({ requester_id: userId, recipient_id: targetId, status: 'pending' });
    setPendingOut(prev => new Set([...prev, targetId]));
    setSearchRes(prev => prev.map(r => r.id === targetId ? { ...r, status: 'pending_out' as FshipStatus } : r));
  };

  /* ── Search ──────────────────────────────────────────────────── */
  const doSearch = async () => {
    if (!search.trim() || !userId) return;
    setSearching(true);
    const sb = getSupabase();
    const isCode = /^[A-Za-z0-9]{6}$/.test(search.trim());

    const { data: results } = isCode
      ? await sb.from('profiles').select('id, display_name, avatar_url, friend_code').ilike('friend_code', search.trim()).neq('id', userId)
      : await sb.from('profiles').select('id, display_name, avatar_url, friend_code').ilike('display_name', `%${search.trim()}%`).neq('id', userId).limit(10);

    const { data: fships } = await sb.from('friendships')
      .select('requester_id, recipient_id, status')
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);

    setSearchRes((results ?? []).map((r: any) => {
      const f = (fships ?? []).find((f: any) =>
        (f.requester_id === userId && f.recipient_id === r.id) ||
        (f.recipient_id === userId && f.requester_id === r.id));
      const status: FshipStatus = !f ? 'none'
        : f.status === 'accepted' ? 'accepted'
        : f.requester_id === userId ? 'pending_out' : 'pending_in';
      return { ...r, status };
    }));
    setSearching(false);
  };

  /* ── Reactions ───────────────────────────────────────────────── */
  const react = async (workoutId: string, ownerId: string, emoji: string) => {
    if (!userId) return;
    const sb = getSupabase();
    const item = feed.find(f => f.workoutId === workoutId);
    const existing = item?.reactions.find(r => r.reactor_id === userId);

    if (existing?.reaction === emoji) {
      await sb.from('workout_reactions').delete().eq('id', existing.id);
      setFeed(prev => prev.map(f => f.workoutId !== workoutId ? f : { ...f, reactions: f.reactions.filter(r => r.id !== existing.id) }));
    } else {
      const { data } = await sb.from('workout_reactions')
        .upsert({ workout_id: workoutId, reactor_id: userId, owner_id: ownerId, reaction: emoji }, { onConflict: 'workout_id,reactor_id' })
        .select('id, reactor_id, reaction').single();
      if (data) setFeed(prev => prev.map(f => f.workoutId !== workoutId ? f : { ...f, reactions: [...f.reactions.filter(r => r.reactor_id !== userId), data as Reaction] }));
    }
  };

  /* ── Comments ────────────────────────────────────────────────── */
  const postComment = async (workoutId: string) => {
    const text = (inputs[workoutId] ?? '').trim();
    if (!text || !userId) return;
    const { data } = await getSupabase().from('workout_comments')
      .insert({ workout_id: workoutId, commenter_id: userId, commenter_name: myName, text })
      .select('id, commenter_id, commenter_name, text, created_at').single();
    if (data) {
      setFeed(prev => prev.map(f => f.workoutId !== workoutId ? f : { ...f, comments: [...f.comments, data as Comment] }));
      setInputs(prev => ({ ...prev, [workoutId]: '' }));
    }
  };

  const delComment = async (workoutId: string, commentId: string) => {
    await getSupabase().from('workout_comments').delete().eq('id', commentId).eq('commenter_id', userId);
    setFeed(prev => prev.map(f => f.workoutId !== workoutId ? f : { ...f, comments: f.comments.filter(c => c.id !== commentId) }));
  };

  /* ── Guards ──────────────────────────────────────────────────── */
  if (!authed || loading) return (
    <SkPage>
      <SkNav />
      <main style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <Sk width={110} height={36} radius={999} />
          <Sk width={90} height={36} radius={999} />
        </div>
        {[0,1,2].map(i => (
          <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <Sk width={44} height={44} radius={999} />
              <div style={{ flex: 1 }}>
                <Sk width={130} height={14} style={{ marginBottom: 6 }} />
                <Sk width={80} height={11} radius={4} />
              </div>
              <Sk width={60} height={11} radius={4} />
            </div>
            <Sk width="90%" height={13} style={{ marginBottom: 8 }} />
            <Sk width="60%" height={13} radius={4} />
          </div>
        ))}
      </main>
    </SkPage>
  );

  /* ── Render ──────────────────────────────────────────────────── */
  const EMOJIS = ['🔥', '💪', '✅'];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/profile" style={{ color: TEAL, fontWeight: 800, fontSize: 20, textDecoration: 'none' }}>LiftLog</a>
          <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>/ Friends</span>
        </div>
        <a href="/log" style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>+ Log Workout</a>
      </nav>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 32px' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: 'var(--card)', borderRadius: 12, padding: 4, width: 'fit-content' }}>
          {(['feed', 'friends'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 24px', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: tab === t ? TEAL : 'transparent', color: tab === t ? '#0f1117' : 'rgba(255,255,255,0.5)', transition: 'all 0.15s', textTransform: 'capitalize' }}>
              {t === 'feed' ? 'Activity Feed' : `Friends${friends.length > 0 ? ` (${friends.length})` : ''}`}
              {t === 'friends' && pendingIn.length > 0 && (
                <span style={{ marginLeft: 6, background: PURPLE, color: 'var(--text)', borderRadius: 999, fontSize: 11, padding: '1px 6px', fontWeight: 700 }}>{pendingIn.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── FEED TAB ─────────────────────────────────────────── */}
        {tab === 'feed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {feed.length === 0 ? (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
                <p style={{ fontSize: 36, marginBottom: 12 }}>🏋️</p>
                <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
                  {friends.length === 0 ? 'Add friends to see their workouts here.' : 'No workouts from friends yet.'}
                </p>
                <button onClick={() => setTab('friends')} style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
                  {friends.length === 0 ? 'Find Friends' : 'Manage Friends'}
                </button>
              </div>
            ) : feed.map(item => {
              const exercises: any[] = item.data?.exercises ?? [];
              const duration: number = item.data?.duration ?? 0;
              const myReaction = item.reactions.find(r => r.reactor_id === userId);
              const isOpen = expanded.has(item.workoutId);

              return (
                <div key={item.workoutId} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>

                  {/* Card header */}
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Av p={item.friend} size={44} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 2px' }}>{item.friend.display_name}</p>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                        {fmtDate(item.date)}{duration > 0 ? ` · ${duration} min` : ''}
                        {exercises.length > 0 ? ` · ${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Exercises */}
                  {exercises.length > 0 && (
                    <div style={{ padding: '0 20px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {exercises.map((e: any, i: number) => (
                        <span key={i} style={{ background: 'var(--card-alt)', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                          {e.exercise?.name ?? 'Exercise'} <span style={{ color: 'var(--text-dim)' }}>×{e.sets?.length ?? 0}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {item.data?.notes?.trim() && (
                    <div style={{ margin: '0 20px 12px', background: 'var(--card)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      "{item.data.notes}"
                    </div>
                  )}

                  {/* Reactions */}
                  <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {EMOJIS.map(emoji => {
                      const count = item.reactions.filter(r => r.reaction === emoji).length;
                      const mine  = myReaction?.reaction === emoji;
                      return (
                        <button key={emoji} onClick={() => react(item.workoutId, item.userId, emoji)}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, background: mine ? `${TEAL}20` : 'rgba(255,255,255,0.06)', border: `1px solid ${mine ? `${TEAL}50` : 'transparent'}`, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 14, color: mine ? TEAL : 'rgba(255,255,255,0.7)', fontWeight: mine ? 700 : 400, transition: 'all 0.15s' }}>
                          {emoji}{count > 0 && <span style={{ fontSize: 12 }}>{count}</span>}
                        </button>
                      );
                    })}

                    <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(item.workoutId) ? n.delete(item.workoutId) : n.add(item.workoutId); return n; })}
                      style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', padding: '5px 8px' }}>
                      {item.comments.length > 0 ? `${item.comments.length} comment${item.comments.length !== 1 ? 's' : ''}` : 'Comment'} {isOpen ? '▴' : '▾'}
                    </button>
                  </div>

                  {/* Comments */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {item.comments.map(c => (
                        <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, background: 'var(--card)', borderRadius: 10, padding: '8px 12px' }}>
                            <span style={{ fontWeight: 700, fontSize: 12, color: TEAL, marginRight: 8 }}>{c.commenter_name}</span>
                            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{c.text}</span>
                          </div>
                          {c.commenter_id === userId && (
                            <button onClick={() => delComment(item.workoutId, c.id)}
                              style={{ background: 'transparent', border: 'none', color: 'rgba(239,68,68,0.5)', cursor: 'pointer', fontSize: 14, padding: '8px 4px', lineHeight: 1 }}>✕</button>
                          )}
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <input
                          value={inputs[item.workoutId] ?? ''}
                          onChange={e => setInputs(prev => ({ ...prev, [item.workoutId]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && postComment(item.workoutId)}
                          placeholder="Add a comment…"
                          style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                        />
                        <button onClick={() => postComment(item.workoutId)}
                          disabled={!(inputs[item.workoutId] ?? '').trim()}
                          style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (inputs[item.workoutId] ?? '').trim() ? 1 : 0.4 }}>
                          Post
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── FRIENDS TAB ──────────────────────────────────────── */}
        {tab === 'friends' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Your friend code */}
            <div style={{ background: `${TEAL}0d`, border: `1px solid ${TEAL}30`, borderRadius: 16, padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px' }}>Your Friend Code</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: TEAL, letterSpacing: '0.12em', margin: 0 }}>{myCode || '——'}</p>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0' }}>Share this code so others can add you</p>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(myCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ background: copied ? `${TEAL}30` : 'rgba(255,255,255,0.08)', border: `1px solid ${copied ? TEAL : 'rgba(255,255,255,0.15)'}`, color: copied ? TEAL : '#fff', borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                {copied ? 'Copied!' : 'Copy Code'}
              </button>
            </div>

            {/* Pending incoming requests */}
            {pendingIn.length > 0 && (
              <div>
                <h3 style={{ fontWeight: 700, fontSize: 15, margin: '0 0 12px', color: YELLOW }}>Friend Requests ({pendingIn.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pendingIn.map(req => (
                    <div key={req.friendshipId} style={{ background: `${YELLOW}0a`, border: `1px solid ${YELLOW}25`, borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <Av p={req.requester} size={40} />
                      <p style={{ flex: 1, fontWeight: 600, fontSize: 14, margin: 0 }}>{req.requester.display_name}</p>
                      <button onClick={() => accept(req.friendshipId)}
                        style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Accept</button>
                      <button onClick={() => decline(req.friendshipId)}
                        style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>Decline</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search / Add friend */}
            <div>
              <h3 style={{ fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>Add a Friend</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Search by name or friend code…"
                  style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                />
                <button onClick={doSearch} disabled={searching || !search.trim()}
                  style={{ background: PURPLE, color: 'var(--text)', border: 'none', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: searching || !search.trim() ? 'not-allowed' : 'pointer', opacity: searching || !search.trim() ? 0.5 : 1 }}>
                  {searching ? '…' : 'Search'}
                </button>
              </div>

              {searchRes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {searchRes.map(r => (
                    <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Av p={r} size={38} />
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 2px' }}>{r.display_name}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0, letterSpacing: '0.08em' }}>{r.friend_code}</p>
                      </div>
                      {r.status === 'accepted'   && <span style={{ fontSize: 12, color: TEAL, fontWeight: 700 }}>Already friends</span>}
                      {r.status === 'pending_out' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Request sent</span>}
                      {r.status === 'pending_in'  && <span style={{ fontSize: 12, color: YELLOW }}>Sent you a request</span>}
                      {r.status === 'none' && (
                        <button onClick={() => sendRequest(r.id)}
                          style={{ background: PURPLE, color: 'var(--text)', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Add Friend</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {searchRes.length === 0 && search && !searching && (
                <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No users found. Try their exact friend code.</p>
              )}
            </div>

            {/* Friends list */}
            <div>
              <h3 style={{ fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>My Friends ({friends.length})</h3>
              {friends.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No friends added yet — search above to get started.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {friends.map(({ friendshipId, friend }) => (
                    <div key={friendshipId} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <Av p={friend} size={40} />
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 2px' }}>{friend.display_name}</p>
                        <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0, letterSpacing: '0.08em' }}>{friend.friend_code}</p>
                      </div>
                      {friend.sharing_preferences?.share_workouts === false && (
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--card-alt)', borderRadius: 6, padding: '2px 8px' }}>Private</span>
                      )}
                      <button onClick={() => removeFriend(friendshipId)}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
