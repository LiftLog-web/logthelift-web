'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';
import * as XLSX from 'xlsx';

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

  const [authed,      setAuthed]      = useState(false);
  const [isEmployer,  setIsEmployer]  = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [step,        setStep]        = useState<Step>('upload');
  const [rows,        setRows]        = useState<PatientRow[]>([]);
  const [results,     setResults]     = useState<ImportResult[]>([]);
  const [dragOver,    setDragOver]    = useState(false);
  const [error,       setError]       = useState('');
  const [token,       setToken]       = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      setToken(data.session.access_token);
      const { data: prof } = await sb.from('profiles').select('role, is_gym_owner, is_employer, company_name').eq('id', data.session.user.id).single();
      if (prof?.role !== 'practitioner' && !prof?.is_gym_owner) { router.push('/profile'); return; }
      setIsEmployer(!!(prof as any)?.is_employer);
      setCompanyName((prof as any)?.company_name ?? '');
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

  function downloadTemplate() {
    const csv = 'email,name\njohn.smith@example.com,John Smith\nsarah.jones@example.com,Sarah Jones\nmike@example.com,';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isEmployer ? 'employee_import_template.csv' : 'patient_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function rowsFromSheet(sheet: XLSX.WorkSheet): PatientRow[] {
    const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    if (!raw.length) return [];
    const firstRow = (raw[0] as string[]).map(c => String(c).toLowerCase());
    const hasHeader = firstRow.some(c => c.includes('email') || c.includes('name'));
    const dataRows = hasHeader ? raw.slice(1) : raw;
    return (dataRows as string[][])
      .map(cols => {
        const email = String(cols[0] ?? '').trim();
        const name  = String(cols[1] ?? '').trim();
        const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        return { email, name, valid };
      })
      .filter(r => r.email);
  }

  function handleFile(file: File) {
    setError('');
    if (!file.name.match(/\.(csv|txt|xlsx|xls)$/i)) {
      setError('Please upload a .csv, .txt, or .xlsx file.');
      return;
    }

    if (file.name.match(/\.xlsx?$/i)) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb   = XLSX.read(data, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const parsed = rowsFromSheet(ws);
          if (!parsed.length) { setError('No rows found in file.'); return; }
          setRows(parsed);
          setStep('preview');
        } catch {
          setError('Could not read Excel file. Try saving as CSV and uploading that instead.');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
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
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function sendInvites() {
    const valid   = rows.filter(r => r.valid);
    const invalid = rows.filter(r => !r.valid);
    if (!valid.length) return;

    setStep('sending');

    const invalidResults: ImportResult[] = invalid.map(r => ({
      email:   r.email,
      success: false,
      error:   'Invalid email address — skipped',
    }));

    try {
      const res = await fetch('/api/send-invite', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          patients:    valid.map(r => ({ email: r.email, name: r.name || undefined })),
          isEmployer,
          companyName,
        }),
      });
      const data = await res.json();
      setResults([...(data.results ?? []), ...invalidResults]);
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
      <SkPage>
        <SkNav />
        <main style={{ maxWidth: 700, margin: '0 auto', padding: '48px 24px' }}>
          <Sk width={200} height={28} radius={6} style={{ marginBottom: 10 }} />
          <Sk width={320} height={14} radius={4} style={{ marginBottom: 32 }} />
          <div style={{ background: 'var(--card)', border: '2px dashed rgba(255,255,255,0.12)', borderRadius: 20, padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <Sk width={48} height={48} radius={12} />
            <Sk width={200} height={14} radius={4} />
            <Sk width={140} height={11} radius={4} />
          </div>
        </main>
      </SkPage>
    );
  }

  const validRows   = rows.filter(r => r.valid);
  const invalidRows = rows.filter(r => !r.valid);

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">

        <h1 className="text-2xl font-bold mb-1">Import {isEmployer ? 'Employees' : 'Patients'}</h1>
        <p className="text-white/50 text-sm mb-8">
          Upload a CSV file with {isEmployer ? 'employee' : 'patient'} emails. Each {isEmployer ? 'employee' : 'patient'} gets a unique invite code sent to their inbox.
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
              <p className="text-white/30 text-sm">Accepts .csv, .txt, or .xlsx · Columns: email, name (optional)</p>
              <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            </div>

            {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}

            {/* Format guide */}
            <div className="mt-6 bg-white/5 border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-white/60 text-sm font-semibold">Expected format</p>
                <button
                  onClick={downloadTemplate}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: `${TEAL}22`, color: TEAL, border: `1px solid ${TEAL}44` }}
                >
                  ↓ Download Template
                </button>
              </div>
              <pre className="text-xs text-white/40 font-mono leading-6">
{`email,name
john.smith@example.com,John Smith
sarah.jones@example.com,Sarah Jones
mike@example.com`}
              </pre>
              <p className="text-white/30 text-xs mt-3">Name is optional. Comma, semicolon, or tab delimiters all work. Header row is auto-detected. Excel (.xlsx) files are supported.</p>
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
                          ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)' }}>Ready</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-500/20 text-red-400">Invalid</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl font-bold border border-white/20 text-white/70 hover:bg-white/5 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={sendInvites}
                disabled={!validRows.length}
                className="flex-[2] py-3 rounded-xl font-bold text-[#0f1117] text-base transition-opacity disabled:opacity-40"
                style={{ backgroundColor: TEAL }}
              >
                Send {validRows.length} Invite{validRows.length !== 1 ? 's' : ''}
              </button>
            </div>
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
            {(() => {
              const sent    = results.filter(r => r.success).length;
              const skipped = results.filter(r => !r.success && r.error?.includes('Invalid email')).length;
              const failed  = results.filter(r => !r.success && !r.error?.includes('Invalid email')).length;
              return (
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-3xl">{failed > 0 ? '⚠️' : '✅'}</span>
                  <div>
                    <p className="font-bold text-lg">{sent} invite{sent !== 1 ? 's' : ''} sent</p>
                    <p className="text-white/50 text-sm">
                      {skipped > 0 && <span className="text-amber-400">{skipped} skipped (invalid email{skipped !== 1 ? 's' : ''})</span>}
                      {skipped > 0 && failed > 0 && ' · '}
                      {failed > 0 && <span className="text-red-400">{failed} failed to send</span>}
                    </p>
                  </div>
                </div>
              );
            })()}

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-4 py-3 text-white/40 font-semibold">Email</th>
                    <th className="text-right px-4 py-3 text-white/40 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const isInvalid = !r.success && r.error?.includes('Invalid email');
                    return (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 text-white/70">{r.email || <span className="text-white/30 italic">empty</span>}</td>
                        <td className="px-4 py-3 text-right">
                          {r.success
                            ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)' }}>Sent</span>
                            : isInvalid
                              ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }} title={r.error}>Invalid email</span>
                              : <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-500/20 text-red-400" title={r.error}>Failed</span>}
                        </td>
                      </tr>
                    );
                  })}
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
