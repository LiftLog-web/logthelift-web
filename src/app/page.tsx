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

const gymTiers = [
  { name: 'Per PT',    price: '$30',  per: '/PT/month', desc: 'No commitment — pay only for what you use.',  highlight: false },
  { name: 'Starter',  price: '$124', per: '/month',     desc: 'Up to 5 PTs. Best for small studios.',        highlight: false },
  { name: 'Mid-Size', price: '$249', per: '/month',     desc: 'Up to 15 PTs. Growing gyms.',                 highlight: true  },
  { name: 'Large',    price: '$429', per: '/month',     desc: 'Up to 30 PTs. Large facilities.',             highlight: false },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Image src="/Logo.png" alt="LiftLog" width={36} height={36} className="rounded-lg" />
          <span className="text-xl font-bold" style={{ color: TEAL }}>LiftLog</span>
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
          LiftLog connects patients and practitioners in one seamless fitness tracking platform.
          Log workouts, monitor progress, and build personalized plans together.
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
            href="#gym-owners"
            className="px-8 py-3 rounded-full font-bold text-lg transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            Gym Owners →
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

      {/* Practitioner section */}
      <section className="px-6 py-16 max-w-6xl mx-auto w-full">
        <div
          className="rounded-3xl p-10 flex flex-col md:flex-row gap-10 items-center"
          style={{ background: `${PURPLE}10`, border: `1px solid ${PURPLE}40` }}
        >
          <div className="flex-1 flex flex-col gap-4">
            <span className="text-4xl">🩺</span>
            <h2 className="text-3xl font-bold">Built for practitioners</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Manage your patients, assign custom workout plans, monitor session completion,
              and receive automated progress reports — all from one app.
            </p>
            <ul className="flex flex-col gap-2 text-sm mt-2" style={{ color: 'var(--text-dim)' }}>
              {[
                'Patient management dashboard',
                'Custom plan builder',
                'Daily & weekly email reports',
                'Exercise demo library',
                'Satisfaction ratings from patients',
              ].map((item) => (
                <li key={item} className="flex gap-2 items-center">
                  <span style={{ color: TEAL }}>✓</span> {item}
                </li>
              ))}
            </ul>
          </div>
          <div
            className="flex-1 flex flex-col gap-4 rounded-2xl p-6"
            style={{ background: 'var(--card)', border: `1px solid ${PURPLE}60` }}
          >
            <p className="font-bold text-lg" style={{ color: PURPLE }}>Practitioner Pro</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Apply in the app to get approved as a practitioner and unlock the full suite of tools.
            </p>
            <a
              href="https://apps.apple.com/app/id6762567982"
              target="_blank"
              rel="noopener noreferrer"
              className="text-center py-3 rounded-xl font-bold mt-2"
              style={{ backgroundColor: PURPLE, color: '#fff' }}
            >
              Get Started
            </a>
          </div>
        </div>
      </section>

      {/* Gym Owner Pricing */}
      <section id="gym-owners" className="px-6 py-16 max-w-6xl mx-auto w-full">
        <h2 className="text-3xl font-bold text-center mb-4">Gym Owner Plans</h2>
        <p className="text-center mb-12" style={{ color: 'var(--text-muted)' }}>Manage multiple PTs under one gym account. All prices in CAD.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {gymTiers.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl p-6 flex flex-col gap-3"
              style={t.highlight
                ? { borderColor: YELLOW, border: `1px solid ${YELLOW}`, background: `${YELLOW}12` }
                : { border: '1px solid var(--border)', background: 'var(--card)' }}
            >
              {t.highlight && (
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full self-start"
                  style={{ backgroundColor: YELLOW, color: '#0f1117' }}
                >
                  Most Popular
                </span>
              )}
              <p className="font-bold text-lg">{t.name}</p>
              <div className="flex items-end gap-1">
                <span
                  className="text-3xl font-extrabold"
                  style={t.highlight ? { color: YELLOW } : { color: 'var(--text)' }}
                >
                  {t.price}
                </span>
                <span className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>{t.per}</span>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-sm mt-6" style={{ color: 'var(--text-dim)' }}>
          Apply for a gym account through the app. Overflow PTs billed at your plan&apos;s per-PT rate.
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
