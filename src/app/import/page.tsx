'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

interface PatientRow {
  email: string;
  name:  string;
  valid: boolean;
}

interface ImportResult {
  email:   string;
  success: boolean;
  error?:  string;
}

type Step = 'upload' | 'preview' | 'sending' | 'done';

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authed,   setAuthed]   = useState(false);
  const [step,     setStep]     = useState<Step>('upload');
  const [rows,     setRows]     = useState<PatientRow[]>([]);
  const [results,  setResults]  = useState<ImportResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error,    setError]    = useState('');
  const [token,    setToken]    = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      setToken(data.session.access_token);
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setAuthed(true);
    });
  }, [router]);

  function parseCSV(text: string): PatientRow[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return [];

    // Detect if first row is a header
    const firstLow = lines[0].toLowerCase();
    const hasHeader = firstLow.includes('email') || firstLow.includes('name');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map(line => {
      // Support comma, semicolon, tab delimiters
      const cols = line.split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
      const email = cols[0] ?? '';
      const name  = cols[1] ?? '';
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      return { email, name, valid };
    }).filter(r => r.email);
  }

  function handleFile(file: File) {
    setError('');
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setError('Please upload a .csv or .txt file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (!parsed.length) { setError('No rows found in file.'); return; }
      setRows(parsed);
      setStep('preview');
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function sendInvites() {
    const valid = rows.filter(r => r.valid);
    if (!valid.length) return;

    setStep('sending');

    try {
      const res = await fetch('/api/send-invite', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ patients: valid.map(r => ({ email: r.email, name: r.name || undefined })) }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
      setStep('done');
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('preview');
    }
  }

  function reset() {
    setRows([]);
    setResults([]);
    setStep('upload');
    setError('');
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#5fcfbf] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const validRows   = rows.filter(r => r.valid);
  const invalidRows = rows.filter(r => !r.valid);

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">

        <h1 className="text-2xl font-bold mb-1">Import Patients</h1>
        <p className="text-white/50 text-sm mb-8">
          Upload a CSV file with patient emails. Each patient gets a unique invite code sent to their inbox.
        </p>

        {/* ── Upload step ── */}
        {step === 'upload' && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors"
              style={{ borderColor: dragOver ? TEAL : 'rgba(255,255,255,0.15)', backgroundColor: dragOver ? 'rgba(95,207,191,0.05)' : 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-5xl mb-4">📂</div>
              <p className="text-white/70 font-semibold mb-1">Drop your CSV here or click to browse</p>
              <p className="text-white/30 text-sm">Accepts .csv or .txt · Columns: email, name (optional)</p>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            </div>

            {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}

            {/* Format guide */}
            <div className="mt-6 bg-white/5 border border-white/10 rounded-xl p-5">
              <p className="text-white/60 text-sm font-semibold mb-3">Expected format</p>
              <pre className="text-xs text-white/40 font-mono leading-6">
{`email,name
john.smith@example.com,John Smith
sarah.jones@example.com,Sarah Jones
mike@example.com`}
              </pre>
              <p className="text-white/30 text-xs mt-3">Name is optional. Comma, semicolon, or tab delimiters all work. Header row is auto-detected.</p>
            </div>
          </>
        )}

        {/* ── Preview step ── */}
        {step === 'preview' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-white/60 text-sm">
                <span style={{ color: TEAL }} className="font-bold">{validRows.length}</span> valid ·{' '}
                {invalidRows.length > 0 && <span className="text-red-400">{invalidRows.length} invalid (will be skipped)</span>}
              </p>
              <button onClick={reset} className="text-white/40 hover:text-white/60 text-sm transition-colors">
                Upload different file
              </button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-4 py-3 text-white/40 font-semibold">Email</th>
                    <th className="text-left px-4 py-3 text-white/40 font-semibold">Name</th>
                    <th className="text-right px-4 py-3 text-white/40 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3 text-white/80">{r.email || <span className="text-white/30 italic">empty</span>}</td>
                      <td className="px-4 py-3 text-white/50">{r.name || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {r.valid
                          ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(95,207,191,0.15)', color: TEAL }}>Ready</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-500/20 text-red-400">Invalid</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

            <button
              onClick={sendInvites}
              disabled={!validRows.length}
              className="w-full py-3 rounded-xl font-bold text-[#0f1117] text-base transition-opacity disabled:opacity-40"
              style={{ backgroundColor: TEAL }}
            >
              Send {validRows.length} Invite{validRows.length !== 1 ? 's' : ''}
            </button>
          </>
        )}

        {/* ── Sending step ── */}
        {step === 'sending' && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: TEAL }} />
            <p className="text-white/60">Sending invites…</p>
          </div>
        )}

        {/* ── Done step ── */}
        {step === 'done' && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-3xl">✅</span>
              <div>
                <p className="font-bold text-lg">Invites sent!</p>
                <p className="text-white/50 text-sm">
                  {results.filter(r => r.success).length} sent successfully
                  {results.filter(r => !r.success).length > 0 && ` · ${results.filter(r => !r.success).length} failed`}
                </p>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-4 py-3 text-white/40 font-semibold">Email</th>
                    <th className="text-right px-4 py-3 text-white/40 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3 text-white/70">{r.email}</td>
                      <td className="px-4 py-3 text-right">
                        {r.success
                          ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(95,207,191,0.15)', color: TEAL }}>Sent</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-500/20 text-red-400" title={r.error}>Failed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl font-bold border border-white/20 text-white/70 hover:bg-white/5 transition-colors"
              >
                Import Another File
              </button>
              <button
                onClick={() => router.push('/plans')}
                className="flex-1 py-3 rounded-xl font-bold text-[#0f1117]"
                style={{ backgroundColor: TEAL }}
              >
                Back to Plans
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
