import Link from 'next/link';
import Image from 'next/image';

const TEAL   = '#5fcfbf';
const PURPLE = '#C471ED';
const YELLOW = '#F9F295';

const features = [
  { icon: '📅', title: 'Workout Calendar',      desc: 'Log every session and visualize your consistency at a glance.',          color: TEAL   },
  { icon: '📊', title: 'Progress Tracking',      desc: 'Track strength gains, body weight, and progress photos over time.',       color: PURPLE },
  { icon: '💡', title: 'Smart Recommendations',  desc: 'Get personalized workout suggestions based on your history.',             color: YELLOW },
  { icon: '🩺', title: 'Practitioner Connect',   desc: 'Link with your PT or physio so they can monitor your progress.',         color: TEAL   },
  { icon: '📋', title: 'Custom Plans',           desc: 'Follow structured programs built by your practitioner.',                  color: PURPLE },
  { icon: '👥', title: 'Social Feed',            desc: 'Share milestones and stay motivated with friends.',                      color: YELLOW },
];

const audiences = [
  {
    icon: '🩺',
    title: 'Practitioners',
    color: PURPLE,
    points: [
      'Patient management dashboard',
      'Custom plan builder',
      'Daily & weekly progress reports',
      'Exercise demo video library',
      'Satisfaction ratings from patients',
    ],
  },
  {
    icon: '🏋️',
    title: 'Gyms & Studios',
    color: TEAL,
    points: [
      'Manage multiple trainers under one account',
      'Assign plans across your entire team',
      'Track client engagement at scale',
      'Gym-wide leaderboard & activity stats',
      'Bulk import clients via CSV',
    ],
  },
  {
    icon: '🏢',
    title: 'Offices & Employers',
    color: YELLOW,
    points: [
      'Promote workplace wellness effortlessly',
      'Desk stretch & mobility plans for staff',
      'Team leaderboard to keep employees engaged',
      'Aggregate wellness stats — no personal data shared',
      'Bulk invite employees via CSV',
    ],
  },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <Image src="/Logo.png" alt="LiftLog" width={48} height={48} className="rounded-xl" />
          <span className="text-2xl font-extrabold" style={{ color: TEAL }}>LiftLog</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/login" className="text-sm font-semibold px-4 py-2 rounded-full transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>
            Sign In / Sign Up
          </a>
          <a
            href="https://apps.apple.com/app/id6762567982"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold px-4 py-2 rounded-full"
            style={{ backgroundColor: TEAL, color: '#0f1117' }}
          >
            Download App
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex flex-col items-center text-center px-6 py-28 gap-6 max-w-3xl mx-auto overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div style={{ position: 'absolute', top: '-80px', left: '-100px', width: '420px', height: '420px', borderRadius: '50%', background: PURPLE, opacity: 0.18, filter: 'blur(90px)' }} />
          <div style={{ position: 'absolute', top: '20px', right: '-80px', width: '340px', height: '340px', borderRadius: '50%', background: TEAL, opacity: 0.18, filter: 'blur(80px)' }} />
          <div style={{ position: 'absolute', bottom: '-60px', left: '50%', transform: 'translateX(-50%)', width: '260px', height: '260px', borderRadius: '50%', background: YELLOW, opacity: 0.12, filter: 'blur(70px)' }} />
        </div>
        <h1 className="text-5xl font-extrabold leading-tight">
          Track workouts.<br />
          <span style={{ color: YELLOW }}>Build better outcomes.</span>
        </h1>
        <p className="text-lg max-w-xl" style={{ color: 'var(--text-muted)' }}>
          LiftLog is a fitness tracking platform built for practitioners, gyms, and offices —
          connecting every client, patient, and employee with the plans and progress tools they need.
        </p>
        <div className="flex gap-4 flex-wrap justify-center mt-2">
          <a
            href="https://apps.apple.com/app/id6762567982"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 rounded-full font-bold text-lg shadow-lg"
            style={{ backgroundColor: TEAL, color: '#0f1117' }}
          >
            Download on App Store
          </a>
          <a
            href="#for-businesses"
            className="px-8 py-3 rounded-full font-bold text-lg transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            For Businesses →
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 max-w-6xl mx-auto w-full">
        <h2 className="text-3xl font-bold text-center mb-12">Everything you need to train smarter</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl p-6 flex flex-col gap-3"
              style={{ background: 'var(--card)', border: `1px solid ${f.color}40` }}
            >
              <span className="text-3xl">{f.icon}</span>
              <h3 className="font-bold text-lg" style={{ color: f.color }}>{f.title}</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section id="for-businesses" className="px-6 py-16 max-w-6xl mx-auto w-full">
        <h2 className="text-3xl font-bold text-center mb-4">Built for every workspace</h2>
        <p className="text-center mb-12" style={{ color: 'var(--text-muted)' }}>
          Whether you run a clinic, a gym, or a company — LiftLog scales to fit your team.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {audiences.map((a) => (
            <div
              key={a.title}
              className="rounded-2xl p-6 flex flex-col gap-4"
              style={{ background: 'var(--card)', border: `1px solid ${a.color}44` }}
            >
              <span className="text-4xl">{a.icon}</span>
              <h3 className="font-bold text-xl" style={{ color: a.color }}>{a.title}</h3>
              <ul className="flex flex-col gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                {a.points.map((p) => (
                  <li key={p} className="flex gap-2 items-start">
                    <span style={{ color: a.color, flexShrink: 0, marginTop: 1 }}>✓</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center text-sm mt-10" style={{ color: 'var(--text-muted)' }}>
          Have any questions about pricing? Email us at{' '}
          <a
            href="mailto:logthelift@gmail.com"
            style={{ color: TEAL, fontWeight: 600, textDecoration: 'underline' }}
          >
            logthelift@gmail.com
          </a>
        </p>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 flex flex-col items-center gap-6 text-center">
        <h2 className="text-4xl font-extrabold">Ready to get started?</h2>
        <p className="max-w-md" style={{ color: 'var(--text-muted)' }}>
          Download LiftLog free on the App Store and start tracking your first workout today.
        </p>
        <a
          href="https://apps.apple.com/app/id6762567982"
          target="_blank"
          rel="noopener noreferrer"
          className="px-10 py-4 rounded-full font-bold text-lg shadow-xl"
          style={{ backgroundColor: TEAL, color: '#0f1117' }}
        >
          Download Free
        </a>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 text-center text-sm mt-auto" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-dim)' }}>
        <div className="flex justify-center gap-6 mb-4">
          <Link href="/invite" style={{ color: 'var(--text-dim)' }}>PT Invite Portal</Link>
          <a href="mailto:logthelift@gmail.com" style={{ color: 'var(--text-dim)' }}>Contact</a>
        </div>
        © {new Date().getFullYear()} LiftLog. All rights reserved.
      </footer>
    </div>
  );
}
