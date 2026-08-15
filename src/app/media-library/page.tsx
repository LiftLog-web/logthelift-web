'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { checkPractitionerAccess } from '@/lib/checkPractitionerAccess';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';
import { EXERCISES } from '@/data/exercises';
import { ClipboardList, Clapperboard } from 'lucide-react';

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
  muscle_group: string | null;
  notes: string | null;
  created_at: string;
}

interface PlanViewer {
  planId: string;
  planName: string;
  patientId: string;
  patientName: string;
}

interface PatientOption {
  id: string;
  name: string;
}

interface ViewMedia {
  url: string;
  type: 'photo' | 'video';
  name: string;
}

type ModalMode = 'url' | 'upload';

export default function MediaLibraryPage() {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authed,      setAuthed]      = useState(false);
  const [isEmployer,  setIsEmployer]  = useState(false);
  const [userId,      setUserId]      = useState('');
  const [items,       setItems]       = useState<MediaItem[]>([]);
  const [signedUrls,  setSignedUrls]  = useState<Record<string, string>>({});
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [deleting,    setDeleting]    = useState<string | null>(null);
  const [viewMedia,   setViewMedia]   = useState<ViewMedia | null>(null);
  const [viewersItem, setViewersItem] = useState<MediaItem | null>(null);
  const [allPlans,    setAllPlans]    = useState<Array<{ id: string; name: string; patient_id: string; exercises: unknown[] }>>([]);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [patients,    setPatients]    = useState<PatientOption[]>([]);
  const [mediaShares, setMediaShares] = useState<Record<string, string[]>>({});
  const [showDirectShares, setShowDirectShares] = useState(false);
  const [removingShareId, setRemovingShareId]   = useState<string | null>(null);
  const [removeShareError, setRemoveShareError] = useState('');

  // Assign-to-patients modal
  const [assignItem,     setAssignItem]     = useState<MediaItem | null>(null);
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [assignSaving,   setAssignSaving]   = useState(false);
  const [assignError,    setAssignError]    = useState('');
  const [assignSearch,   setAssignSearch]   = useState('');

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
  const [customExNames,    setCustomExNames]    = useState<string[]>([]);
  const [exSearch,         setExSearch]         = useState('');
  const [exDropdownOpen,   setExDropdownOpen]   = useState(false);
  const [muscleGroupInput, setMuscleGroupInput] = useState('');
  const [notesInput,       setNotesInput]       = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_employer').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner') { router.push('/plans'); return; }
      const hasAccess = await checkPractitionerAccess(sb, data.session.user.id);
      if (!hasAccess) { router.push('/profile?subscription=expired'); return; }
      setIsEmployer(!!(prof as any)?.is_employer);
      setUserId(data.session.user.id);
      setAuthed(true);
      await loadAll(data.session.user.id);
    });
  }, [router]);

  async function loadAll(uid: string) {
    const sb = getSupabase();

    const [mediaRes, plansRes, customRes, linksRes, sharesRes] = await Promise.all([
      sb.from('exercise_media')
        .select('id, exercise_name, media_type, file_path, url_link, muscle_group, notes, created_at')
        .eq('practitioner_id', uid)
        .order('exercise_name', { ascending: true }),
      sb.from('workout_plans')
        .select('id, name, patient_id, exercises, patient:patient_id(display_name)')
        .eq('practitioner_id', uid),
      sb.from('custom_exercises')
        .select('name')
        .eq('creator_id', uid),
      sb.from('patient_links')
        .select('profiles:patient_id(id, display_name)')
        .eq('practitioner_id', uid),
      sb.from('exercise_media_shares')
        .select('media_id, patient_id')
        .eq('practitioner_id', uid),
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

    // Collect custom exercise names for the exercise picker in the modal
    const customNames: string[] = [];
    for (const ex of (customRes.data ?? [])) {
      if (ex.name) customNames.push(ex.name);
    }
    setCustomExNames(customNames);

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

    type LinkRow = { profiles: { id: string; display_name: string } | { id: string; display_name: string }[] | null };
    const pats: PatientOption[] = ((linksRes.data ?? []) as LinkRow[])
      .map(l => Array.isArray(l.profiles) ? l.profiles[0] : l.profiles)
      .filter((p): p is { id: string; display_name: string } => !!p)
      .map(p => ({ id: p.id, name: p.display_name }));
    setPatients(pats);

    const sharesMap: Record<string, string[]> = {};
    for (const row of (sharesRes.data ?? [])) {
      (sharesMap[row.media_id] ??= []).push(row.patient_id);
    }
    setMediaShares(sharesMap);

    setLoading(false);
  }

  function openEditModal(item: MediaItem) {
    setEditItem(item);
    setModalMode(item.media_type === 'link' ? 'url' : 'upload');
    setExerciseName(item.exercise_name);
    setNameLocked(true);
    setUrlInput(item.url_link ?? '');
    setMuscleGroupInput(item.muscle_group ?? '');
    setNotesInput(item.notes ?? '');
    setMediaFile(null);
    setModalError('');
    setUploadProgress('');
    setShowModal(true);
  }

  function openUrlModal(opts?: { item?: MediaItem; prefillName?: string }) {
    const item = opts?.item ?? null;
    setEditItem(item);
    setModalMode('url');
    setExerciseName(item?.exercise_name ?? opts?.prefillName ?? '');
    setNameLocked(!!item || !!opts?.prefillName);
    setUrlInput(item?.url_link ?? '');
    setMuscleGroupInput(item?.muscle_group ?? '');
    setNotesInput(item?.notes ?? '');
    setMediaFile(null);
    setModalError('');
    setUploadProgress('');
    setShowModal(true);
  }

  function openUploadModal(prefillName?: string) {
    if (atUploadCap) {
      alert(`You've reached the ${MEDIA_CAP}-file upload limit. Remove an existing uploaded file to add a new one. You can still add unlimited video links.`);
      return;
    }
    setEditItem(null);
    setModalMode('upload');
    setExerciseName(prefillName ?? '');
    setNameLocked(!!prefillName);
    setUrlInput('');
    setMuscleGroupInput('');
    setNotesInput('');
    setMediaFile(null);
    setModalError('');
    setUploadProgress('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditItem(null);
    setMediaFile(null);
    setExSearch('');
    setExDropdownOpen(false);
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
        { practitioner_id: userId, exercise_name: name, file_path: '', media_type: 'link', url_link: url, muscle_group: muscleGroupInput.trim() || null, notes: notesInput.trim() || null },
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
    // File is only required when adding a new entry; editing can update metadata alone
    if (!editItem && !mediaFile) { setModalError('Please select a file.'); return; }
    setSaving(true);
    setModalError('');
    const sb = getSupabase();

    if (mediaFile) {
      // Upload new (or replacement) file
      setUploadProgress('Uploading…');
      const slug     = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const path     = `${userId}/${slug}_${Date.now()}.${mediaFile.name.split('.').pop()}`;
      const mediaType: 'photo' | 'video' = mediaFile.type.startsWith('video') ? 'video' : 'photo';
      // Remove old file from storage when replacing
      if (editItem?.file_path) await sb.storage.from('exercise-media').remove([editItem.file_path]);
      const { error: upErr } = await sb.storage.from('exercise-media').upload(path, mediaFile, { upsert: false });
      if (upErr) { setModalError('Upload failed: ' + upErr.message); setSaving(false); setUploadProgress(''); return; }
      setUploadProgress('Saving…');
      const { error } = await sb.from('exercise_media').upsert(
        { practitioner_id: userId, exercise_name: name, file_path: path, media_type: mediaType, url_link: null, muscle_group: muscleGroupInput.trim() || null, notes: notesInput.trim() || null },
        { onConflict: 'practitioner_id,exercise_name' },
      );
      if (error) { setModalError(error.message); setSaving(false); setUploadProgress(''); return; }
    } else {
      // Editing existing: update muscle group and notes only, file unchanged
      setUploadProgress('Saving…');
      const { error } = await sb.from('exercise_media')
        .update({ muscle_group: muscleGroupInput.trim() || null, notes: notesInput.trim() || null })
        .eq('id', editItem!.id);
      if (error) { setModalError(error.message); setSaving(false); setUploadProgress(''); return; }
    }

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
  const filteredItems = items.filter(m => m.exercise_name.toLowerCase().includes(search.toLowerCase()));
  const linkCount     = items.filter(m => m.media_type === 'link').length;
  const uploadCount   = items.filter(m => m.media_type !== 'link').length;
  // Cap applies to uploaded files only — URL links are free (no server storage used)
  const atUploadCap   = uploadCount >= MEDIA_CAP;
  const usagePct      = Math.min(100, (uploadCount / MEDIA_CAP) * 100);
  const usageBarColor = atUploadCap ? '#EF4444' : usagePct >= 80 ? '#F97316' : TEAL;

  const typeIcon  = (t: string) => t === 'link' ? '🔗' : t === 'video' ? '📹' : '📷';
  const typeLabel = (t: string) => t === 'link' ? 'Video link' : t === 'video' ? 'Video' : 'Photo';
  const typeColor = (t: string) => t === 'link' ? TEAL : t === 'video' ? PURPLE : '#F9F295';
  const TYPE_CSS: Record<string, { bg: string; text: string }> = {
    link:  { bg: 'var(--badge-teal-bg)',    text: 'var(--badge-teal-text)' },
    video: { bg: 'var(--badge-purple-bg)',  text: 'var(--badge-purple-text)' },
    photo: { bg: 'var(--badge-yellow-bg)', text: 'var(--badge-yellow-text)' },
  };

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

  function openAssignModal(item: MediaItem) {
    setAssignItem(item);
    setAssignSelected(new Set(mediaShares[item.id] ?? []));
    setAssignError('');
    setAssignSearch('');
  }

  function closeAssignModal() {
    setAssignItem(null);
    setAssignError('');
    setAssignSearch('');
  }

  function toggleAssignPatient(patientId: string) {
    setAssignSelected(prev => {
      const next = new Set(prev);
      if (next.has(patientId)) next.delete(patientId); else next.add(patientId);
      return next;
    });
  }

  async function handleSaveAssign() {
    if (!assignItem) return;
    setAssignSaving(true);
    setAssignError('');
    const sb = getSupabase();
    const ids = [...assignSelected];
    const { error: deleteError } = await sb
      .from('exercise_media_shares')
      .delete()
      .eq('media_id', assignItem.id);
    if (deleteError) {
      setAssignError('Could not update sharing — please try again.');
      setAssignSaving(false);
      return;
    }
    if (ids.length > 0) {
      const { error: insertError } = await sb.from('exercise_media_shares').insert(
        ids.map(pid => ({ media_id: assignItem.id, patient_id: pid, practitioner_id: userId })),
      );
      if (insertError) {
        setAssignError('Could not assign to all selected patients — please try again.');
        setAssignSaving(false);
        return;
      }
    }
    setMediaShares(prev => ({ ...prev, [assignItem.id]: ids }));
    setAssignSaving(false);
    setAssignItem(null);
    setAssignSearch('');
  }

  async function handleRemoveShare(mediaId: string, patientId: string) {
    setRemovingShareId(patientId);
    setRemoveShareError('');
    const sb = getSupabase();
    const { error } = await sb
      .from('exercise_media_shares')
      .delete()
      .eq('media_id', mediaId)
      .eq('patient_id', patientId);
    if (error) {
      setRemoveShareError('Could not remove this patient — please try again.');
      setRemovingShareId(null);
      return;
    }
    setMediaShares(prev => ({ ...prev, [mediaId]: (prev[mediaId] ?? []).filter(id => id !== patientId) }));
    setRemovingShareId(null);
  }

  // Escape closes whichever modal is currently on top
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (assignItem) { setAssignItem(null); return; }
      if (showModal) { closeModal(); return; }
      if (viewMedia) { setViewMedia(null); return; }
      if (viewersItem) { setViewersItem(null); return; }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assignItem, showModal, viewMedia, viewersItem]);

  if (!authed || loading) {
    return (
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Sk width={150} height={26} radius={6} />
            <div style={{ display: 'flex', gap: 10 }}>
              <Sk width={110} height={36} radius={10} />
              <Sk width={100} height={36} radius={10} />
            </div>
          </div>
          <div style={{ background: 'var(--card)', borderRadius: 12, padding: '12px 16px', marginBottom: 20 }}>
            <Sk width="100%" height={8} radius={999} />
          </div>
          <Sk width={220} height={36} radius={10} style={{ marginBottom: 16 }} />
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                <Sk width={56} height={40} radius={8} />
                <Sk width={160} height={13} />
                <Sk width={90} height={11} radius={4} style={{ marginLeft: 'auto' }} />
                <Sk width={60} height={11} radius={4} />
                <Sk width={70} height={28} radius={8} />
              </div>
            ))}
          </div>
        </main>
      </SkPage>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Exercise Video Library</h1>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              <button
                onClick={() => openUploadModal()}
                disabled={atUploadCap}
                title={atUploadCap ? `Upload limit of ${MEDIA_CAP} files reached` : undefined}
                style={{ background: 'var(--btn-purple-bg)', border: '1px solid var(--btn-purple-border)', color: atUploadCap ? 'var(--text-dim)' : 'var(--btn-purple-text)', borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: atUploadCap ? 'not-allowed' : 'pointer', opacity: atUploadCap ? 0.5 : 1 }}
              >
                Upload File
              </button>
              <button
                onClick={() => openUrlModal()}
                style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
              >
                + Add Video Link
              </button>
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
            {items.length} demo{items.length !== 1 ? 's' : ''} · {linkCount} video link{linkCount !== 1 ? 's' : ''} · {uploadCount} upload{uploadCount !== 1 ? 's' : ''}
          </p>
          {/* Usage bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, height: 6, background: 'var(--input-bg)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePct}%`, background: usageBarColor, borderRadius: 999, transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ color: atUploadCap ? '#EF4444' : 'var(--text-muted)', fontSize: 13, fontWeight: atUploadCap ? 700 : 500, whiteSpace: 'nowrap' }}>
              {uploadCount} of {MEDIA_CAP} upload slots used{atUploadCap ? ' — upload limit reached' : ''} · unlimited URL links
            </span>
          </div>
        </div>

        <div style={{ background: 'var(--badge-teal-bg)', border: '1px solid var(--btn-teal-border)', borderRadius: 14, padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: TEAL }}>Video links</strong> are the easiest way to add demos from your PC — paste any YouTube, Vimeo, Instagram, or other video URL.
            {isEmployer ? 'Team members' : 'Patients'} tap the link in the app to open it in their browser. Demos sync instantly to the LiftLog app.
          </p>
        </div>

        {items.length > 0 && (
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search exercises…"
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 20, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: '11px 16px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
          />
        )}

        {items.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><Clapperboard size={48} color="var(--text-muted)" /></div>
            <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>No demos yet</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 28, fontSize: 15 }}>
              Add a video link or upload a file to get started.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => openUploadModal()} style={{ background: 'var(--btn-purple-bg)', border: '1px solid var(--btn-purple-border)', color: 'var(--btn-purple-text)', borderRadius: 12, padding: '12px 24px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Upload File</button>
              <button onClick={() => openUrlModal()} style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>+ Add Video Link</button>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 40, textAlign: 'center' }}>
                <p style={{ color: 'var(--text-muted)' }}>No exercises match "{search}"</p>
              </div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: PURPLE, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '12px 24px', textAlign: 'left', width: 80 }}>Preview</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left' }}>Exercise</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left' }}>Muscle Group</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left' }}>Type</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left' }}>Link / File</th>
                      <th style={{ padding: '12px 24px', textAlign: 'left' }}>Added</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, i) => {
                      const signedUrl = signedUrls[item.id];
                      return (
                        <tr
                          key={item.id}
                          onClick={() => { setViewersItem(item); setShowDirectShares(false); setRemoveShareError(''); }}
                          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'transparent' : 'var(--card)', cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(95,207,191,0.05)')}
                          onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--card)')}
                        >

                          {/* Preview */}
                          <td onClick={e => e.stopPropagation()} style={{ padding: '12px 24px' }}>
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
                                style={{ width: 64, height: 48, background: '#1a1a2e', borderRadius: 8, border: '1px solid var(--border-strong)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', fontSize: 18 }}
                              >
                                ▶
                              </button>
                            ) : item.media_type === 'link' ? (
                              <div style={{ width: 64, height: 48, background: '#0f2a1a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔗</div>
                            ) : (
                              <div style={{ width: 64, height: 48, background: 'var(--card)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ width: 16, height: 16, border: `2px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                              </div>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', fontWeight: 600 }}>{item.exercise_name}
                            {item.notes && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, fontWeight: 400 }}>{item.notes}</div>}
                            {(mediaShares[item.id]?.length ?? 0) > 0 && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, background: 'rgba(95,207,191,0.12)', color: TEAL, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                                ✓ Shared with {mediaShares[item.id]!.length}
                              </div>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                            {item.muscle_group ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                          </td>

                          <td style={{ padding: '12px 24px' }}>
                            <span style={{ background: (TYPE_CSS[item.media_type] ?? TYPE_CSS.link).bg, color: (TYPE_CSS[item.media_type] ?? TYPE_CSS.link).text, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {typeIcon(item.media_type)} {typeLabel(item.media_type)}
                            </span>
                          </td>

                          <td onClick={e => e.stopPropagation()} style={{ padding: '12px 24px', maxWidth: 260 }}>
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
                              <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{item.file_path.split('/').pop()}</span>
                            )}
                          </td>

                          <td style={{ padding: '12px 24px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {new Date(item.created_at).toLocaleDateString('en-CA')}
                          </td>

                          <td onClick={e => e.stopPropagation()} style={{ padding: '12px 24px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button onClick={() => openEditModal(item)} style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginRight: 16 }}>
                              Edit
                            </button>
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
      </main>

      {/* ── MEDIA VIEWER ── */}
      {viewMedia && (
        <div
          onClick={() => setViewMedia(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17, margin: 0 }}>{viewMedia.name}</p>
              <button onClick={() => setViewMedia(null)} style={{ background: 'var(--border)', border: 'none', color: 'var(--text)', borderRadius: 8, width: 36, height: 36, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            {viewMedia.type === 'photo' ? (
              <img src={viewMedia.url} alt={viewMedia.name} style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', objectFit: 'contain' }} />
            ) : (
              <video src={viewMedia.url} controls autoPlay style={{ width: '100%', borderRadius: 12, maxHeight: '80vh', background: '#000' }} />
            )}
            <p style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 12 }}>Click outside to close</p>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT MODAL ── */}
      {showModal && (() => {
        const query = exSearch.toLowerCase();
        const seenNames = new Set<string>();
        const allEx = [
          ...EXERCISES.map(e => ({ name: e.name, sub: `${e.muscleGroup} · ${e.equipment}`, custom: false })),
          ...customExNames.map(n => ({ name: n, sub: 'Custom exercise', custom: true })),
        ]
          .filter(e => { const key = e.name.toLowerCase(); if (seenNames.has(key)) return false; seenNames.add(key); return true; })
          .sort((a, b) => a.name.localeCompare(b.name));
        const filtered = query.length === 0 ? [] : allEx
          .filter(e => e.name.toLowerCase().includes(query))
          .sort((a, b) => {
            const aLow = a.name.toLowerCase();
            const bLow = b.name.toLowerCase();
            const aStarts = aLow.startsWith(query);
            const bStarts = bLow.startsWith(query);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return aLow.localeCompare(bLow);
          })
          .slice(0, 8);
        const hasExactMatch = allEx.some(e => e.name.toLowerCase() === query);
        const showCreate = query.length > 1 && !hasExactMatch;
        const listOpen = exDropdownOpen && query.length > 0 && (filtered.length > 0 || showCreate);

        const selectExercise = (name: string) => {
          setExerciseName(name); setExSearch(''); setExDropdownOpen(false);
        };

        const createCustom = async () => {
          const name = exSearch.trim();
          if (!name) return;
          await getSupabase().from('custom_exercises').insert({ creator_id: userId, name, muscle_group: 'Custom', equipment: '—', type: 'weighted' });
          setCustomExNames(prev => [...prev, name]);
          selectExercise(name);
        };

        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
            onClick={closeModal}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, width: '100%', maxWidth: 500, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>
                  {editItem ? 'Edit Demo' : modalMode === 'url' ? 'Add Video Link' : 'Upload Demo File'}
                </h2>
                <button onClick={closeModal} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>
                {modalMode === 'url' ? 'Paste any video URL — YouTube, Vimeo, Instagram, or anything else.' : 'Upload a photo or video file.'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Exercise picker — inline, no absolute overlay */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Exercise *</span>
                  {nameLocked ? (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--text-muted)', fontSize: 15 }}>
                      {exerciseName}
                    </div>
                  ) : (
                    <>
                      <input
                        value={exerciseName && !exDropdownOpen ? exerciseName : exSearch}
                        onChange={e => { setExSearch(e.target.value); setExerciseName(''); setExDropdownOpen(true); }}
                        onFocus={() => { setExDropdownOpen(true); if (exerciseName) setExSearch(exerciseName); }}
                        onKeyDown={e => { if (e.key === 'Escape') { setExDropdownOpen(false); setExSearch(''); } }}
                        placeholder="Search exercises…"
                        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-alt)', border: `1px solid ${exerciseName && !exDropdownOpen ? TEAL : 'var(--border-strong)'}`, borderRadius: listOpen ? '10px 10px 0 0' : 10, padding: '11px 14px', color: exerciseName && !exDropdownOpen ? TEAL : 'var(--text)', fontSize: 15, outline: 'none', fontWeight: exerciseName && !exDropdownOpen ? 600 : 400 }}
                      />
                      {listOpen && (
                        <div style={{ background: '#1e2130', border: '1px solid var(--border-strong)', borderTop: 'none', borderRadius: '0 0 10px 10px', marginTop: -6 }}>
                          {/* Scrollable results — capped so Create is always in view */}
                          <div style={{ maxHeight: 111, overflowY: 'auto' }}>
                            {filtered.map(ex => (
                              <button
                                key={ex.name}
                                onMouseDown={e => { e.preventDefault(); selectExercise(ex.name); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: 'none', padding: '9px 14px', cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--border-subtle)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{ex.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{ex.sub}</div>
                              </button>
                            ))}
                          </div>
                          {/* Create option — outside the scroll container, always visible */}
                          {showCreate && (
                            <button
                              onMouseDown={e => { e.preventDefault(); createCustom(); }}
                              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: filtered.length > 0 ? '1px solid var(--input-bg)' : 'none', padding: '10px 14px', cursor: 'pointer' }}
                              onMouseEnter={e => (e.currentTarget.style.background = `${TEAL}12`)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                            >
                              <div style={{ fontSize: 14, fontWeight: 700, color: TEAL }}>+ Create &ldquo;{exSearch.trim()}&rdquo;</div>
                              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>Add as a new custom exercise</div>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Muscle group + notes */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Muscle Group</span>
                  <input
                    value={muscleGroupInput}
                    onChange={e => setMuscleGroupInput(e.target.value)}
                    placeholder="e.g. Quadriceps"
                    style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>PT Notes <span style={{ fontWeight: 400 }}>(optional)</span></span>
                  <textarea
                    value={notesInput}
                    onChange={e => setNotesInput(e.target.value)}
                    placeholder="e.g. Focus on slow descent, keep knee aligned over second toe"
                    rows={2}
                    style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </label>

                {/* URL / File */}
                {modalMode === 'url' ? (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Video URL *</span>
                    <input
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      placeholder="https://youtube.com/watch?v=... or any video link"
                      type="url"
                      style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
                    />
                  </label>
                ) : (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
                      {editItem ? 'Replace File' : 'File *'}
                      {editItem && <span style={{ fontWeight: 400, marginLeft: 6 }}>(optional — leave blank to keep current)</span>}
                    </span>
                    <div onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${mediaFile ? TEAL : 'var(--border-strong)'}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', color: mediaFile ? TEAL : 'var(--text-muted)', fontSize: 14 }}>
                      {mediaFile ? `${mediaFile.name} (${(mediaFile.size / 1024 / 1024).toFixed(1)} MB)` : editItem ? 'Click to choose a replacement file' : 'Click to choose an image or video file'}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={e => setMediaFile(e.target.files?.[0] ?? null)} />
                  </label>
                )}

                {uploadProgress && <p style={{ color: TEAL, fontSize: 13, margin: 0 }}>{uploadProgress}</p>}
                {modalError && <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>{modalError}</p>}

                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <button onClick={closeModal} disabled={saving} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={modalMode === 'url' ? handleSaveUrl : handleSaveUpload} disabled={saving} style={{ flex: 2, background: TEAL, color: '#0f1117', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                    {saving ? 'Saving…' : editItem ? 'Save Changes' : modalMode === 'url' ? 'Save Link' : 'Upload & Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── VIEWERS MODAL ── */}
      {viewersItem && (() => {
        const viewers = getViewers(viewersItem.exercise_name);
        return (
          <div
            onClick={() => setViewersItem(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>{viewersItem.exercise_name}</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                    {isEmployer ? 'Team members' : 'Patients'} who have this exercise in one of their plans
                  </p>
                </div>
                <button onClick={() => setViewersItem(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', marginTop: 20 }}>
                {viewers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)', fontSize: 14 }}>
                    <p style={{ fontSize: 32, marginBottom: 12 }}>👤</p>
                    No {isEmployer ? 'team members' : 'patients'} have this exercise in any active plan yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {viewers.map(v => (
                      <div
                        key={v.planId}
                        style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{v.patientName}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><ClipboardList size={12} /> {v.planName}</div>
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

              {(mediaShares[viewersItem.id]?.length ?? 0) > 0 && (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <button
                    onClick={() => setShowDirectShares(s => !s)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
                      Directly shared with {mediaShares[viewersItem.id]!.length} {isEmployer ? 'team member' : 'patient'}{mediaShares[viewersItem.id]!.length !== 1 ? 's' : ''}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13, transform: showDirectShares ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>
                      ▾
                    </span>
                  </button>

                  {showDirectShares && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, maxHeight: 200, overflowY: 'auto' }}>
                      {mediaShares[viewersItem.id]!.map(patientId => {
                        const name = patients.find(p => p.id === patientId)?.name ?? 'Unknown';
                        return (
                          <div
                            key={patientId}
                            style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
                            <button
                              onClick={() => handleRemoveShare(viewersItem.id, patientId)}
                              disabled={removingShareId === patientId}
                              style={{ background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', border: '1px solid var(--btn-red-border)', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: removingShareId === patientId ? 'not-allowed' : 'pointer', opacity: removingShareId === patientId ? 0.6 : 1 }}
                            >
                              {removingShareId === patientId ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        );
                      })}
                      {removeShareError && (
                        <p style={{ color: '#EF4444', fontSize: 12, margin: '4px 0 0' }}>{removeShareError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 24, borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                  {viewers.length} {isEmployer ? 'team member' : 'patient'}{viewers.length !== 1 ? 's' : ''} · {viewers.length} plan{viewers.length !== 1 ? 's' : ''}
                  {(mediaShares[viewersItem.id]?.length ?? 0) > 0 && (
                    <> · {mediaShares[viewersItem.id]!.length} directly shared</>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button onClick={() => openAssignModal(viewersItem)} style={{ background: TEAL, color: '#0f1117', border: 'none', borderRadius: 10, padding: '8px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Assign to {isEmployer ? 'Team Members' : 'Patients'}
                  </button>
                  <button onClick={() => setViewersItem(null)} style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '8px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── ASSIGN TO PATIENTS MODAL ── */}
      {assignItem && (
        <div
          onClick={closeAssignModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, padding: 24 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Assign to {isEmployer ? 'Team Members' : 'Patients'}</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                  {assignItem.exercise_name} — share this demo directly, even if it&apos;s not in their plan yet.
                </p>
              </div>
              <button onClick={closeAssignModal} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>

            {patients.length > 0 && (
              <input
                type="text"
                value={assignSearch}
                onChange={e => setAssignSearch(e.target.value)}
                placeholder={isEmployer ? 'Search team members…' : 'Search patients…'}
                style={{ marginTop: 16, width: '100%', background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: 'var(--text-main)', outline: 'none' }}
              />
            )}

            <div style={{ flex: 1, overflowY: 'auto', marginTop: 12 }}>
              {patients.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)', fontSize: 14 }}>
                  <p style={{ fontSize: 32, marginBottom: 12 }}>👤</p>
                  You don&apos;t have any {isEmployer ? 'team members' : 'patients'} yet.
                </div>
              ) : (
                (() => {
                  const filtered = patients
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .filter(p => p.name.toLowerCase().includes(assignSearch.trim().toLowerCase()));
                  if (filtered.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)', fontSize: 14 }}>
                        No {isEmployer ? 'team members' : 'patients'} match &quot;{assignSearch}&quot;.
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {filtered.map(p => {
                        const checked = assignSelected.has(p.id);
                        return (
                          <label
                            key={p.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: checked ? 'rgba(95,207,191,0.1)' : 'var(--card-alt)', border: `1px solid ${checked ? TEAL : 'var(--border-subtle)'}`, cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAssignPatient(p.id)}
                              style={{ width: 16, height: 16, accentColor: TEAL, cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>

            {assignError && (
              <p style={{ color: '#EF4444', fontSize: 13, margin: '12px 0 0' }}>{assignError}</p>
            )}

            <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', gap: 12 }}>
              <button onClick={closeAssignModal} disabled={assignSaving} style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSaveAssign} disabled={assignSaving} style={{ flex: 2, background: TEAL, color: '#0f1117', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: assignSaving ? 'not-allowed' : 'pointer', opacity: assignSaving ? 0.7 : 1 }}>
                {assignSaving ? 'Saving…' : `Save${assignSelected.size > 0 ? ` (${assignSelected.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
