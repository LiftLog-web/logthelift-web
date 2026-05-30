'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL      = '#5fcfbf';
const PURPLE    = '#C471ED';
const GREEN     = '#22c55e';
const MEDIA_CAP = 30;

interface MediaItem {
  id: string;
  exercise_name: string;
  media_type: 'photo' | 'video' | 'link';
  file_path: string;
  url_link: string | null;
  created_at: string;
}

interface CoverageItem {
  name: string;
  hasDemo: boolean;
  demoType: 'photo' | 'video' | 'link' | null;
  mediaItem: MediaItem | undefined;
}

interface PlanViewer {
  planId: string;
  planName: string;
  patientId: string;
  patientName: string;
}

interface ViewMedia {
  url: string;
  type: 'photo' | 'video';
  name: string;
}

type ModalMode = 'url' | 'upload';
type View = 'library' | 'coverage';

export default function MediaLibraryPage() {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authed,      setAuthed]      = useState(false);
  const [userId,      setUserId]      = useState('');
  const [items,       setItems]       = useState<MediaItem[]>([]);
  const [signedUrls,  setSignedUrls]  = useState<Record<string, string>>({});
  const [coverage,    setCoverage]    = useState<CoverageItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [view,        setView]        = useState<View>('library');
  const [search,      setSearch]      = useState('');
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [viewMedia,   setViewMedia]   = useState<ViewMedia | null>(null);
  const [viewersItem, setViewersItem] = useState<MediaItem | null>(null);
  const [allPlans,    setAllPlans]    = useState<Array<{ id: string; name: string; patient_id: string; exercises: unknown[] }>>([]);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});

  // Modal
  const [showModal,      setShowModal]      = useState(false);
  const [modalMode,      setModalMode]      = useState<ModalMode>('url');
  const [editItem,       setEditItem]       = useState<MediaItem | null>(null);
  const [exerciseName,   setExerciseName]   = useState('');
  const [nameLocked,     setNameLocked]     = useState(false);
  const [urlInput,       setUrlInput]       = useState('');
  const [mediaFile,      setMediaFile]      = useState<File | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [modalError,     setModalError]     = useState('');
  const [uploadProgress, setUploadProgress] = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner') { router.push('/plans'); return; }
      setUserId(data.session.user.id);
      setAuthed(true);
      await loadAll(data.session.user.id);
    });
  }, [router]);

  async function loadAll(uid: string) {
    const sb = getSupabase();

    const [mediaRes, plansRes, customRes] = await Promise.all([
      sb.from('exercise_media')
        .select('id, exercise_name, media_type, file_path, url_link, created_at')
        .eq('practitioner_id', uid)
        .order('exercise_name', { ascending: true }),
      sb.from('workout_plans')
        .select('id, name, patient_id, exercises, patient:patient_id(display_name)')
        .eq('practitioner_id', uid),
      sb.from('custom_exercises')
        .select('name')
        .eq('creator_id', uid),
    ]);

    const mediaItems: MediaItem[] = mediaRes.data ?? [];
    setItems(mediaItems);

    // Generate signed URLs for all uploaded (non-link) items
    const uploadedItems = mediaItems.filter(m => m.media_type !== 'link' && m.file_path);
    const urlEntries = await Promise.all(
      uploadedItems.map(async m => {
        const { data } = await sb.storage.from('exercise-media').createSignedUrl(m.file_path, 3600);
        return data?.signedUrl ? ([m.id, data.signedUrl] as const) : null;
      }),
    );
    setSignedUrls(Object.fromEntries(urlEntries.filter(Boolean) as [string, string][]));

    // Build coverage: exercise names from plans + custom exercises + existing demos
    const byName: Record<string, MediaItem> = {};
    for (const m of mediaItems) byName[m.exercise_name] = m;

    const namesSet = new Set<string>();
    for (const plan of (plansRes.data ?? [])) {
      if (Array.isArray(plan.exercises)) {
        for (const ex of plan.exercises) {
          if (ex?.name) namesSet.add(ex.name);
        }
      }
    }
    for (const ex of (customRes.data ?? [])) {
      if (ex.name) namesSet.add(ex.name);
    }
    for (const m of mediaItems) namesSet.add(m.exercise_name);

    const coverageList: CoverageItem[] = Array.from(namesSet)
      .sort((a, b) => a.localeCompare(b))
      .map(name => {
        const mediaItem = byName[name];
        return { name, hasDemo: !!mediaItem, demoType: mediaItem?.media_type ?? null, mediaItem };
      });

    coverageList.sort((a, b) => {
      if (a.hasDemo === b.hasDemo) return a.name.localeCompare(b.name);
      return a.hasDemo ? 1 : -1;
    });

    setCoverage(coverageList);

    // Build plan viewers map
    const plans = (plansRes.data ?? []).map(p => {
      const patientRow = Array.isArray(p.patient) ? p.patient[0] : p.patient;
      return {
        id: p.id as string,
        name: p.name as string,
        patient_id: p.patient_id as string,
        patientName: (patientRow as { display_name?: string } | null)?.display_name ?? 'Unknown Patient',
        exercises: (p.exercises ?? []) as unknown[],
      };
    });
    setAllPlans(plans as never);
    const nameMap: Record<string, string> = {};
    for (const p of plans) nameMap[p.patient_id] = p.patientName;
    setPatientNames(nameMap);

    setLoading(false);
  }

  function openUrlModal(opts?: { item?: MediaItem; prefillName?: string }) {
    if (!opts?.item && atCap) {
      alert(`You've reached the ${MEDIA_CAP}-demo limit. Remove an existing demo to add a new one.`);
      return;
    }
    const item = opts?.item ?? null;
    setEditItem(item);
    setModalMode('url');
    setExerciseName(item?.exercise_name ?? opts?.prefillName ?? '');
    setNameLocked(!!item || !!opts?.prefillName);
    setUrlInput(item?.url_link ?? '');
    setMediaFile(null);
    setModalError('');
    setUploadProgress('');
    setShowModal(true);
  }

  function openUploadModal(prefillName?: string) {
    if (atCap) {
      alert(`You've reached the ${MEDIA_CAP}-demo limit. Remove an existing demo to add a new one.`);
      return;
    }
    setEditItem(null);
    setModalMode('upload');
    setExerciseName(prefillName ?? '');
    setNameLocked(!!prefillName);
    setUrlInput('');
    setMediaFile(null);
    setModalError('');
    setUploadProgress('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditItem(null);
    setMediaFile(null);
  }

  async function handleSaveUrl() {
    const name = exerciseName.trim();
    const url  = urlInput.trim();
    if (!name) { setModalError('Exercise name is required.'); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setModalError('Please enter a valid URL starting with https://');
      return;
    }
    setSaving(true);
    setModalError('');
    const { error } = await getSupabase()
      .from('exercise_media')
      .upsert(
        { practitioner_id: userId, exercise_name: name, file_path: '', media_type: 'link', url_link: url },
        { onConflict: 'practitioner_id,exercise_name' },
      );
    if (error) { setModalError(error.message); setSaving(false); return; }
    await loadAll(userId);
    closeModal();
    setSaving(false);
  }

  async function handleSaveUpload() {
    const name = exerciseName.trim();
    if (!name) { setModalError('Exercise name is required.'); return; }
    if (!mediaFile) { setModalError('Please select a file.'); return; }
    setSaving(true);
    setModalError('');
    setUploadProgress('Uploading…');

    const sb = getSupabase();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const path = `${userId}/${slug}_${Date.now()}.${mediaFile.name.split('.').pop()}`;
    const mediaType: 'photo' | 'video' = mediaFile.type.startsWith('video') ? 'video' : 'photo';

    const { error: upErr } = await sb.storage.from('exercise-media').upload(path, mediaFile, { upsert: false });
    if (upErr) { setModalError('Upload failed: ' + upErr.message); setSaving(false); setUploadProgress(''); return; }

    setUploadProgress('Saving…');
    const { error } = await sb
      .from('exercise_media')
      .upsert(
        { practitioner_id: userId, exercise_name: name, file_path: path, media_type: mediaType, url_link: null },
        { onConflict: 'practitioner_id,exercise_name' },
      );
    if (error) { setModalError(error.message); setSaving(false); setUploadProgress(''); return; }

    await loadAll(userId);
    closeModal();
    setSaving(false);
    setUploadProgress('');
  }

  async function handleDelete(item: MediaItem) {
    if (!confirm(`Remove the demo for "${item.exercise_name}"? This cannot be undone.`)) return;
    setDeleting(item.id);
    const sb = getSupabase();
    if (item.file_path) await sb.storage.from('exercise-media').remove([item.file_path]);
    await sb.from('exercise_media').delete().eq('id', item.id);
    await loadAll(userId);
    setDeleting(null);
  }

  // Library helpers
  const filteredItems   = items.filter(m => m.exercise_name.toLowerCase().includes(search.toLowerCase()));
  const linkCount       = items.filter(m => m.media_type === 'link').length;
  const uploadCount     = items.filter(m => m.media_type !== 'link').length;
  const atCap           = items.length >= MEDIA_CAP;
  const usagePct        = Math.min(100, (items.length / MEDIA_CAP) * 100);
  const usageBarColor   = atCap ? '#EF4444' : usagePct >= 80 ? '#F97316' : TEAL;

  const typeIcon  = (t: string) => t === 'link' ? '🔗' : t === 'video' ? '📹' : '📷';
  const typeLabel = (t: string) => t === 'link' ? 'Video link' : t === 'video' ? 'Uploaded video' : 'Uploaded photo';
  const typeColor = (t: string) => t === 'link' ? TEAL : t === 'video' ? PURPLE : '#F9F295';

  function getViewers(exerciseName: string): PlanViewer[] {
    return (allPlans as Array<{ id: string; name: string; patient_id: string; patientName: string; exercises: unknown[] }>)
      .filter(plan =>
        Array.isArray(plan.exercises) &&
        plan.exercises.some(ex => {
          const e = ex as Record<string, unknown>;
          const nested = (e?.exercise as Record<string, unknown> | undefined)?.name;
          return nested === exerciseName || e?.name === exerciseName;
        }),
      )
      .map(plan => ({
        planId: plan.id,
        planName: plan.name,
        patientId: plan.patient_id,
        patientName: patientNames[plan.patient_id] ?? plan.patientName,
      }));
  }

  // Coverage helpers
  const filteredCoverage = coverage.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const coveredCount     = coverage.filter(c => c.hasDemo).length;
  const missingCount     = coverage.length - coveredCount;
  const coveragePct      = coverage.length > 0 ? Math.round((coveredCount / coverage.length) * 100) : 0;

  if (!authed || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: 'sans-serif' }}>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Exercise Video Library</h1>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              <button
                onClick={() => openUploadModal()}
                disabled={atCap}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: atCap ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: atCap ? 'not-allowed' : 'pointer' }}
              >
                Upload File
              </button>
              <button
                onClick={() => openUrlModal()}
                disabled={atCap}
                style={{ background: atCap ? 'rgba(255,255,255,0.1)' : TEAL, color: atCap ? 'rgba(255,255,255,0.3)' : '#0f1117', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: atCap ? 'not-allowed' : 'pointer' }}
              >
                + Add Video Link
              </button>
            </div>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 0, marginBottom: 16 }}>
            {items.length} demo{items.length !== 1 ? 's' : ''} · {linkCount} video link{linkCount !== 1 ? 's' : ''} · {uploadCount} upload{uploadCount !== 1 ? 's' : ''}
          </p>
          {/* Usage bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePct}%`, background: usageBarColor, borderRadius: 999, transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ color: atCap ? '#EF4444' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: atCap ? 700 : 500, whiteSpace: 'nowrap' }}>
              {items.length} of {MEDIA_CAP} demo slots used{atCap ? ' — limit reached' : ''}
            </span>
          </div>
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4, width: 'fit-content' }}>
          {(['library', 'coverage'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => { setView(v); setSearch(''); }}
              style={{
                background: view === v ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: 'none', borderRadius: 9,
                color: view === v ? '#fff' : 'rgba(255,255,255,0.4)',
                fontWeight: view === v ? 700 : 500,
                fontSize: 14, padding: '8px 20px', cursor: 'pointer',
              }}
            >
              {v === 'library' ? 'My Library' : `Coverage${coverage.length > 0 ? ` · ${coveredCount}/${coverage.length}` : ''}`}
            </button>
          ))}
        </div>

        {/* ── LIBRARY VIEW ── */}
        {view === 'library' && (
          <>
            <div style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}30`, borderRadius: 14, padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: TEAL }}>Video links</strong> are the easiest way to add demos from your PC — paste any YouTube, Vimeo, Instagram, or other video URL.
                Patients tap the link in the app to open it in their browser. Demos sync instantly to the LiftLog app.
              </p>
            </div>

            {items.length > 0 && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search exercises…"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 20, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '11px 16px', color: '#fff', fontSize: 15, outline: 'none' }}
              />
            )}

            {items.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
                <p style={{ fontSize: 48, marginBottom: 16 }}>🎬</p>
                <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>No demos yet</h2>
                <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 28, fontSize: 15 }}>
                  Add a video link or upload a file to get started.<br />
                  Switch to <strong style={{ color: TEAL }}>Coverage</strong> to see which exercises in your plans need demos.
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => openUploadModal()} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 12, padding: '12px 24px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Upload File</button>
                  <button onClick={() => openUrlModal()} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>+ Add Video Link</button>
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 40, textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)' }}>No exercises match "{search}"</p>
              </div>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600, width: 80 }}>Preview</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Exercise</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Link / File</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Added</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right', fontWeight: 600 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, i) => {
                      const signedUrl = signedUrls[item.id];
                      return (
                        <tr key={item.id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>

                          {/* Preview */}
                          <td style={{ padding: '12px 24px' }}>
                            {item.media_type === 'photo' && signedUrl ? (
                              <img
                                src={signedUrl}
                                alt={item.exercise_name}
                                onClick={() => setViewMedia({ url: signedUrl, type: 'photo', name: item.exercise_name })}
                                style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', display: 'block' }}
                              />
                            ) : item.media_type === 'video' && signedUrl ? (
                              <button
                                onClick={() => setViewMedia({ url: signedUrl, type: 'video', name: item.exercise_name })}
                                style={{ width: 64, height: 48, background: '#1a1a2e', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}
                              >
                                ▶
                              </button>
                            ) : item.media_type === 'link' ? (
                              <div style={{ width: 64, height: 48, background: '#0f2a1a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔗</div>
                            ) : (
                              <div style={{ width: 64, height: 48, background: 'rgba(255,255,255,0.05)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ width: 16, height: 16, border: `2px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                              </div>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', fontWeight: 600 }}>{item.exercise_name}</td>

                          <td style={{ padding: '12px 24px' }}>
                            <span style={{ background: `${typeColor(item.media_type)}18`, color: typeColor(item.media_type), padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {typeIcon(item.media_type)} {typeLabel(item.media_type)}
                            </span>
                          </td>

                          <td style={{ padding: '12px 24px', maxWidth: 260 }}>
                            {item.media_type === 'link' && item.url_link ? (
                              <a href={item.url_link} target="_blank" rel="noopener noreferrer" style={{ color: TEAL, fontSize: 13, wordBreak: 'break-all', textDecoration: 'none' }} title={item.url_link}>
                                {item.url_link.length > 45 ? item.url_link.slice(0, 45) + '…' : item.url_link}
                              </a>
                            ) : signedUrl ? (
                              <button
                                onClick={() => setViewMedia({ url: signedUrl, type: item.media_type as 'photo' | 'video', name: item.exercise_name })}
                                style={{ background: 'none', border: 'none', color: TEAL, fontSize: 13, cursor: 'pointer', padding: 0, fontWeight: 600 }}
                              >
                                {item.media_type === 'photo' ? 'View photo' : 'Play video'}
                              </button>
                            ) : (
                              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>{item.file_path.split('/').pop()}</span>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                            {new Date(item.created_at).toLocaleDateString('en-CA')}
                          </td>

                          <td style={{ padding: '12px 24px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => setViewersItem(item)}
                              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 16 }}
                              title="See which patients have this exercise"
                            >
                              👥 Viewers
                            </button>
                            {item.media_type === 'link' && (
                              <button onClick={() => openUrlModal({ item })} style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 16 }}>
                                Edit
                              </button>
                            )}
                            <button onClick={() => handleDelete(item)} disabled={deleting === item.id} style={{ background: 'none', border: 'none', color: '#EF4444', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: deleting === item.id ? 0.5 : 1 }}>
                              {deleting === item.id ? 'Removing…' : 'Remove'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── COVERAGE VIEW ── */}
        {view === 'coverage' && (
          <>
            {coverage.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <span style={{ fontSize: 26, fontWeight: 800, color: coveragePct === 100 ? GREEN : '#fff' }}>{coveragePct}%</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginLeft: 10 }}>
                      {coveredCount} of {coverage.length} exercises have a demo
                    </span>
                  </div>
                  {missingCount > 0 ? (
                    <span style={{ background: '#EF444420', color: '#EF4444', fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 999 }}>
                      {missingCount} missing
                    </span>
                  ) : (
                    <span style={{ background: `${GREEN}20`, color: GREEN, fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 999 }}>
                      All covered ✓
                    </span>
                  )}
                </div>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${coveragePct}%`, background: coveragePct === 100 ? GREEN : TEAL, borderRadius: 999 }} />
                </div>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                  Includes all exercises used across your patient plans and custom exercise library. Missing demos are shown first.
                </p>
              </div>
            )}

            {coverage.length > 0 && (
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search exercises…"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 20, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '11px 16px', color: '#fff', fontSize: 15, outline: 'none' }}
              />
            )}

            {coverage.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
                <p style={{ fontSize: 40, marginBottom: 16 }}>📋</p>
                <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>No plans yet</h2>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>
                  Coverage tracks exercises from your patient plans.<br />
                  Once you have plans, you'll see which exercises need demo videos here.
                </p>
              </div>
            ) : filteredCoverage.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 40, textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)' }}>No exercises match "{search}"</p>
              </div>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600, width: 80 }}>Preview</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Exercise</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Demo Status</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right', fontWeight: 600 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCoverage.map((c, i) => {
                      const signedUrl = c.mediaItem ? signedUrls[c.mediaItem.id] : undefined;
                      return (
                        <tr key={c.name} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>

                          {/* Preview */}
                          <td style={{ padding: '12px 24px' }}>
                            {c.demoType === 'photo' && signedUrl ? (
                              <img src={signedUrl} alt={c.name} onClick={() => setViewMedia({ url: signedUrl, type: 'photo', name: c.name })} style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', display: 'block' }} />
                            ) : c.demoType === 'video' && signedUrl ? (
                              <button onClick={() => setViewMedia({ url: signedUrl, type: 'video', name: c.name })} style={{ width: 64, height: 48, background: '#1a1a2e', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>▶</button>
                            ) : c.demoType === 'link' ? (
                              <div style={{ width: 64, height: 48, background: '#0f2a1a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔗</div>
                            ) : (
                              <div style={{ width: 64, height: 48, background: 'rgba(239,68,68,0.08)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>—</div>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', fontWeight: 600, color: c.hasDemo ? '#fff' : 'rgba(255,255,255,0.7)' }}>{c.name}</td>

                          <td style={{ padding: '12px 24px' }}>
                            {c.hasDemo ? (
                              <span style={{ background: `${GREEN}18`, color: GREEN, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>✓ Has demo</span>
                            ) : (
                              <span style={{ background: '#EF444418', color: '#EF4444', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>✗ Missing</span>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px' }}>
                            {c.demoType ? (
                              <span style={{ background: `${typeColor(c.demoType)}18`, color: typeColor(c.demoType), padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {typeIcon(c.demoType)} {typeLabel(c.demoType)}
                              </span>
                            ) : (
                              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>—</span>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {c.hasDemo ? (
                              <>
                                {c.demoType === 'link' && c.mediaItem && (
                                  <button onClick={() => openUrlModal({ item: c.mediaItem })} style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 16 }}>Edit link</button>
                                )}
                                {c.mediaItem?.url_link && (
                                  <a href={c.mediaItem.url_link} target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 700, fontSize: 13, textDecoration: 'none', marginRight: 16 }}>Open ↗</a>
                                )}
                                {(c.demoType === 'photo' || c.demoType === 'video') && signedUrl && (
                                  <button onClick={() => setViewMedia({ url: signedUrl, type: c.demoType as 'photo' | 'video', name: c.name })} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 16 }}>
                                    {c.demoType === 'photo' ? 'View' : 'Play'}
                                  </button>
                                )}
                                <button onClick={() => c.mediaItem && handleDelete(c.mediaItem)} disabled={!!deleting} style={{ background: 'none', border: 'none', color: '#EF4444', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: deleting ? 0.5 : 1 }}>Remove</button>
                              </>
                            ) : (
                              <div style={{ display: 'inline-flex', gap: 8 }}>
                                <button onClick={() => openUploadModal(c.name)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Upload</button>
                                <button onClick={() => openUrlModal({ prefillName: c.name })} style={{ background: TEAL, color: '#0f1117', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}>+ Add Link</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── MEDIA VIEWER ── */}
      {viewMedia && (
        <div
          onClick={() => setViewMedia(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 17, margin: 0 }}>{viewMedia.name}</p>
              <button onClick={() => setViewMedia(null)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {viewMedia.type === 'photo' ? (
              <img src={viewMedia.url} alt={viewMedia.name} style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', objectFit: 'contain' }} />
            ) : (
              <video src={viewMedia.url} controls autoPlay style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', background: '#000' }} />
            )}
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', marginTop: 12 }}>Click outside to close</p>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT MODAL ── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
          <div style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: 36, width: '100%', maxWidth: 500 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>
                {modalMode === 'url' ? (editItem ? 'Edit Video Link' : 'Add Video Link') : 'Upload Demo File'}
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 28 }}>
              {modalMode === 'url'
                ? "Paste any video URL — YouTube, Vimeo, Instagram, or anything else. The exercise name must match exactly what's used in the app."
                : "Upload a photo or video file. The exercise name must match exactly what's used in the app."}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600 }}>Exercise Name *</span>
                <input
                  value={exerciseName}
                  onChange={e => setExerciseName(e.target.value)}
                  placeholder="e.g. Barbell Squat"
                  disabled={nameLocked}
                  style={{ background: nameLocked ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '11px 14px', color: nameLocked ? 'rgba(255,255,255,0.5)' : '#fff', fontSize: 15, outline: 'none', cursor: nameLocked ? 'not-allowed' : 'text' }}
                />
                {!nameLocked && (
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Must match the exercise name exactly as it appears in the app (case-sensitive).</span>
                )}
              </label>

              {modalMode === 'url' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600 }}>Video URL *</span>
                  <input
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    placeholder="https://youtube.com/watch?v=... or any video link"
                    type="url"
                    autoFocus
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 15, outline: 'none' }}
                  />
                </label>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600 }}>File *</span>
                  <div onClick={() => fileRef.current?.click()} style={{ border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
                    {mediaFile ? mediaFile.name : 'Click to choose an image or video file'}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={e => setMediaFile(e.target.files?.[0] ?? null)} />
                </label>
              )}

              {uploadProgress && <p style={{ color: TEAL, fontSize: 13, margin: 0 }}>{uploadProgress}</p>}
              {modalError && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{modalError}</p>}

              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <button onClick={closeModal} disabled={saving} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
                <button onClick={modalMode === 'url' ? handleSaveUrl : handleSaveUpload} disabled={saving} style={{ flex: 2, background: TEAL, color: '#0f1117', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : modalMode === 'url' ? 'Save Link' : 'Upload & Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEWERS MODAL ── */}
      {viewersItem && (() => {
        const viewers = getViewers(viewersItem.exercise_name);
        return (
          <div
            onClick={() => setViewersItem(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>{viewersItem.exercise_name}</h2>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                    Patients who have this exercise in one of their plans
                  </p>
                </div>
                <button onClick={() => setViewersItem(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 24, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', marginTop: 20 }}>
                {viewers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
                    <p style={{ fontSize: 32, marginBottom: 12 }}>👤</p>
                    No patients have this exercise in any active plan yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {viewers.map(v => (
                      <div
                        key={v.planId}
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{v.patientName}</div>
                          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>📋 {v.planName}</div>
                        </div>
                        <a
                          href={`/patients/${v.patientId}`}
                          style={{ color: TEAL, fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: 12 }}
                        >
                          View →
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
                  {viewers.length} patient{viewers.length !== 1 ? 's' : ''} · {viewers.length} plan{viewers.length !== 1 ? 's' : ''}
                </span>
                <button onClick={() => setViewersItem(null)} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
