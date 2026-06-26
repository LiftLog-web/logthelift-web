'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { getSupabase } from '@/lib/supabase';
import { Sk, SkPage, SkNav } from '@/components/Skeleton';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';

interface PTRow {
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

export default function ImportPTsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [authed,   setAuthed]   = useState(false);
  const [step,     setStep]     = useState<Step>('upload');
  const [rows,     setRows]     = useState<PTRow[]>([]);
  const [results,  setResults]  = useState<ImportResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error,    setError]    = useState('');
  const [token,    setToken]    = useState('');

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/login'); return; }
      setToken(data.session.access_token);
      const { data: prof } = await sb.from('profiles').select('is_gym_owner').eq('id', data.session.user.id).single();
      if (!prof?.is_gym_owner) { router.push('/dashboard'); return; }
      setAuthed(true);
    });
  }, [router]);

  function parseCSV(text: string): PTRow[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return [];

    const firstLow = lines[0].toLowerCase();
    const hasHeader = firstLow.includes('email') || firstLow.includes('name');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map(line => {
      const cols = line.split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
      const email = cols[0] ?? '';
      const name  = cols[1] ?? '';
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      return { email, name, valid };
    }).filter(r => r.email);
  }

  function handleFile(file: File) {
    setError('');
    const nameOk = /\.(csv|txt|xls|xlsx)$/i.test(file.name);
    const mimeOk = [
      'text/csv', 'text/plain', 'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ].includes(file.type);
    if (!nameOk && !mimeOk) {
      setError('Please upload a .csv, .txt, .xls, or .xlsx file.');
      return;
    }

    const isExcel = /\.(xls|xlsx)$/i.test(file.name);
    const reader = new FileReader();

    if (isExcel) {
      reader.onload = e => {
        const data = e.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        const parsed = parseCSV(csv);
        if (!parsed.length) { setError('No rows found in file.'); return; }
        setRows(parsed);
        setStep('preview');
      };
      reader.readAsArrayBuffer(file);
    } else {
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

  function downloadTemplate() {
    const content = 'email,name\npt@example.com,Jane Smith\njohn@example.com,John Doe';
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pt-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendInvites() {
    const valid = rows.filter(r => r.valid);
    if (!valid.length) return;

    setStep('sending');

    try {
      const res = await fetch('/api/send-pt-invite', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ pts: valid.map(r => ({ email: r.email, name: r.name || undefined })) }),
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif', padding: '40px 24px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 0 }}>
            ← Dashboard
          </button>
          <span style={{ color: TEAL, fontSize: 22, fontWeight: 800 }}>LiftLog</span>
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>Import PTs</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
          Upload a CSV of PT emails. Each PT receives an invitation email with instructions to join your gym on LiftLog.
        </p>

        {step === 'upload' && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? TEAL : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 20,
                padding: 48,
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'rgba(95,207,191,0.05)' : 'rgba(255,255,255,0.02)',
                transition: 'border-color 0.2s, background 0.2s',
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 44, marginBottom: 14 }}>📂</div>
              <p style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>Drop your CSV here or click to browse</p>
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Accepts .csv, .xlsx, .xls, or .txt · Columns: email, name (optional)</p>
              <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            </div>

            {error && <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 16 }}>{error}</p>}

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Expected format</p>
              <pre style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.8, margin: 0 }}>
{`email,name
jane.smith@example.com,Jane Smith
john.doe@example.com,John Doe
pt@example.com`}
              </pre>
              <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 12, marginBottom: 0 }}>Name is optional. Comma, semicolon, or tab delimiters all work.</p>
            </div>

            <button
              onClick={downloadTemplate}
              style={{ background: 'var(--btn-teal-bg)', border: '1px solid var(--btn-teal-border)', color: 'var(--btn-teal-text)', borderRadius: 10, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >
              Download CSV Template
            </button>
          </>
        )}

        {step === 'preview' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
                <span style={{ color: TEAL, fontWeight: 700 }}>{validRows.length}</span> valid
                {invalidRows.length > 0 && <span style={{ color: '#EF4444' }}> · {invalidRows.length} invalid (will be skipped)</span>}
              </p>
              <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>
                Upload different file
              </button>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Email</th>
                    <th style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Name</th>
                    <th style={{ textAlign: 'right', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '12px 20px', color: 'rgba(255,255,255,0.8)' }}>{r.email || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>empty</span>}</td>
                      <td style={{ padding: '12px 20px', color: 'var(--text-muted)' }}>{r.name || '—'}</td>
                      <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                        {r.valid
                          ? <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>Ready</span>
                          : <span style={{ background: 'var(--badge-red-bg)', color: 'var(--badge-red-text)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>Invalid</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 16 }}>{error}</p>}

            <button
              onClick={sendInvites}
              disabled={!validRows.length}
              style={{ width: '100%', background: TEAL, color: '#0f1117', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 15, border: 'none', cursor: validRows.length ? 'pointer' : 'not-allowed', opacity: validRows.length ? 1 : 0.4 }}
            >
              Send {validRows.length} Invite{validRows.length !== 1 ? 's' : ''}
            </button>
          </>
        )}

        {step === 'sending' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '64px 0' }}>
            <div style={{ width: 40, height: 40, border: `3px solid ${TEAL}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ color: 'var(--text-muted)' }}>Sending invites…</p>
          </div>
        )}

        {step === 'done' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <span style={{ fontSize: 32 }}>✅</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Invites sent!</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
                  {results.filter(r => r.success).length} sent successfully
                  {results.filter(r => !r.success).length > 0 && ` · ${results.filter(r => !r.success).length} failed`}
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Email</th>
                    <th style={{ textAlign: 'right', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '12px 20px', color: 'var(--text-muted)' }}>{r.email}</td>
                      <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                        {r.success
                          ? <span style={{ background: 'var(--badge-teal-bg)', color: 'var(--badge-teal-text)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>Sent</span>
                          : <span style={{ background: 'var(--badge-red-bg)', color: 'var(--badge-red-text)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }} title={r.error}>Failed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={reset}
                style={{ flex: 1, background: 'var(--card-alt)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                Import Another File
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                style={{ flex: 1, background: TEAL, color: '#0f1117', borderRadius: 12, padding: '13px 0', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
              >
                Back to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
