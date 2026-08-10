'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { checkPractitionerAccess } from '@/lib/checkPractitionerAccess';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';
import { Dumbbell } from 'lucide-react';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Core', 'Quadriceps', 'Hamstrings', 'Glutes', 'Calves',
  'Cardio', 'Pilates', 'Yoga', 'Isometrics', 'Balance', 'Plyometrics',
];

interface CustomExercise {
  id: string;
  creator_id: string;
  name: string;
  muscle_group: string;
  equipment: string;
  type: 'weighted' | 'duration' | 'cardio';
  media_url: string | null;
  media_type: 'image' | 'video' | null;
  created_at: string;
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  weighted: { bg: 'var(--badge-teal-bg)',   color: 'var(--badge-teal-text)'   },
  duration: { bg: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)' },
  cardio:   { bg: 'var(--badge-yellow-bg)', color: 'var(--badge-yellow-text)' },
};

export default function ExercisesPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authed,    setAuthed]    = useState(false);
  const [userId,    setUserId]    = useState('');
  const [exercises, setExercises] = useState<CustomExercise[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [deleting,  setDeleting]  = useState<string | null>(null);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');

  const [name,        setName]        = useState('');
  const [muscleGroup, setMuscleGroup] = useState(MUSCLE_GROUPS[0]);
  const [equipment,   setEquipment]   = useState('Bodyweight');
  const [type,        setType]        = useState<'weighted' | 'duration' | 'cardio'>('weighted');
  const [mediaFile,   setMediaFile]   = useState<File | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      if (prof?.role === 'practitioner') {
        const hasAccess = await checkPractitionerAccess(sb, data.session.user.id);
        if (!hasAccess) { router.push('/profile?subscription=expired'); return; }
      }
      setUserId(data.session.user.id);
      setAuthed(true);
      await fetchExercises();
    });
  }, [router]);

  async function fetchExercises() {
    const { data } = await getSupabase()
      .from('custom_exercises')
      .select('id, creator_id, name, muscle_group, equipment, type, media_url, media_type, created_at')
      .order('created_at', { ascending: false });
    setExercises(data ?? []);
    setLoading(false);
  }

  function resetForm() {
    setName('');
    setMuscleGroup(MUSCLE_GROUPS[0]);
    setEquipment('Bodyweight');
    setType('weighted');
    setMediaFile(null);
    setFormError('');
    setUploadProgress('');
  }

  async function handleSave() {
    if (!name.trim()) { setFormError('Name is required.'); return; }
    setSaving(true);
    setFormError('');

    let media_url: string | null = null;
    let media_type: 'image' | 'video' | null = null;

    if (mediaFile) {
      setUploadProgress('Uploading media…');
      const sb = getSupabase();
      const path = `${userId}/${Date.now()}-${mediaFile.name}`;
      const { error: upErr } = await sb.storage.from('exercise-media').upload(path, mediaFile, { upsert: true });
      if (upErr) {
        setFormError('Media upload failed: ' + upErr.message);
        setSaving(false);
        setUploadProgress('');
        return;
      }
      const { data: urlData } = sb.storage.from('exercise-media').getPublicUrl(path);
      media_url = urlData.publicUrl;
      media_type = mediaFile.type.startsWith('video') ? 'video' : 'image';
      setUploadProgress('');
    }

    const { error } = await getSupabase().from('custom_exercises').insert({
      name: name.trim(),
      muscle_group: muscleGroup,
      equipment: equipment.trim() || 'Bodyweight',
      type,
      media_url,
      media_type,
    });

    if (error) {
      setFormError('Failed to save: ' + error.message);
      setSaving(false);
      return;
    }

    await fetchExercises();
    resetForm();
    setShowForm(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this exercise? This cannot be undone.')) return;
    setDeleting(id);
    await getSupabase().from('custom_exercises').delete().eq('id', id);
    setExercises(prev => prev.filter(e => e.id !== id));
    setDeleting(null);
  }

  if (!authed || loading) {
    return (
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <Sk width={170} height={26} radius={6} />
            <Sk width={140} height={36} radius={10} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
            {[0,1,2,3,4,5,6,7].map(i => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                <Sk width="100%" height={140} radius={0} />
                <div style={{ padding: '14px 16px' }}>
                  <Sk width="70%" height={14} style={{ marginBottom: 8 }} />
                  <Sk width="50%" height={11} radius={4} />
                </div>
              </div>
            ))}
          </div>
        </main>
      </SkPage>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Exercise Library</h1>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            style={{ background: TEAL, color: '#0f1117', borderRadius: 10, padding: '10px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
          >
            + Add Exercise
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>
          {exercises.length} custom exercise{exercises.length !== 1 ? 's' : ''}
        </p>

        {showForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
            <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <h2 style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>New Exercise</h2>
                <button onClick={() => { setShowForm(false); resetForm(); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Name *</span>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Bulgarian Split Squat"
                    style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Muscle Group</span>
                  <select
                    value={muscleGroup}
                    onChange={e => setMuscleGroup(e.target.value)}
                    style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
                  >
                    {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Equipment</span>
                  <input
                    value={equipment}
                    onChange={e => setEquipment(e.target.value)}
                    placeholder="Bodyweight"
                    style={{ background: 'var(--card-alt)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Type</span>
                  <select
                    value={type}
                    onChange={e => setType(e.target.value as 'weighted' | 'duration' | 'cardio')}
                    style={{ background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
                  >
                    <option value="weighted">Weighted</option>
                    <option value="duration">Duration</option>
                    <option value="cardio">Cardio</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>Media (optional)</span>
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{ border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '16px', textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
                  >
                    {mediaFile ? mediaFile.name : 'Click to upload image or video'}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/*"
                    style={{ display: 'none' }}
                    onChange={e => setMediaFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                {uploadProgress && <p style={{ color: TEAL, fontSize: 13 }}>{uploadProgress}</p>}
                {formError && <p style={{ color: '#EF4444', fontSize: 13 }}>{formError}</p>}

                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button
                    onClick={() => { setShowForm(false); resetForm(); }}
                    style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{ flex: 2, background: TEAL, color: '#0f1117', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                  >
                    {saving ? 'Saving…' : 'Save Exercise'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {exercises.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 60, textAlign: 'center' }}>
            <Dumbbell size={40} style={{ marginBottom: 16, color: 'var(--text-muted)' }} />
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>No custom exercises yet. Add your first one.</p>
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              style={{ background: TEAL, color: '#0f1117', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}
            >
              Add Exercise
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {exercises.map(ex => {
              const typeStyle = TYPE_COLORS[ex.type] ?? TYPE_COLORS.weighted;
              return (
                <div key={ex.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {ex.media_url && ex.media_type === 'image' && (
                    <img src={ex.media_url} alt={ex.name} style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                  )}
                  {ex.media_url && ex.media_type === 'video' && (
                    <video src={ex.media_url} style={{ width: '100%', height: 160, objectFit: 'cover' }} muted playsInline />
                  )}
                  <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>{ex.name}</h3>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>
                        {ex.muscle_group}
                      </span>
                      <span style={{ background: typeStyle.bg, color: typeStyle.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>
                        {ex.type.charAt(0).toUpperCase() + ex.type.slice(1)}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{ex.equipment}</p>
                    <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                      <button
                        onClick={() => handleDelete(ex.id)}
                        disabled={deleting === ex.id}
                        style={{ width: '100%', background: 'var(--btn-red-bg)', color: 'var(--btn-red-text)', borderRadius: 8, padding: '8px 0', fontWeight: 700, fontSize: 13, border: '1px solid var(--btn-red-border)', cursor: 'pointer', opacity: deleting === ex.id ? 0.5 : 1 }}
                      >
                        {deleting === ex.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
