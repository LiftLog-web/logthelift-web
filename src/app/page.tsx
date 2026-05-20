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
    <div className="flex flex-col min-h-screen bg-[#0f1117] text-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10 max-w-6xl mx-auto w-full">
        <span className="text-xl font-bold" style={{ color: TEAL }}>LiftLog</span>
        <a
          href="https://apps.apple.com/app/id6762567982"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold px-4 py-2 rounded-full text-[#0f1117]"
          style={{ backgroundColor: TEAL }}
        >
          Download App
        </a>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 py-20 gap-6 max-w-3xl mx-auto">
        <Image
          src="/logo.png"
          alt="LiftLog logo"
          width={140}
          height={140}
          priority
          className="drop-shadow-lg"
        />
        <h1 className="text-5xl font-extrabold leading-tight">
          Track workouts.<br />
          <span style={{ color: YELLOW }}>Build better outcomes.</span>
        </h1>
        <p className="text-lg text-white/60 max-w-xl">
          LiftLog connects patients and practitioners in one seamless fitness tracking platform.
          Log workouts, monitor progress, and build personalized plans together.
        </p>
        <div className="flex gap-4 flex-wrap justify-center mt-2">
          <a
            href="https://apps.apple.com/app/id6762567982"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 rounded-full font-bold text-[#0f1117] text-lg shadow-lg"
            style={{ backgroundColor: TEAL }}
          >
            Download on App Store
          </a>
          <a
            href="#gym-owners"
            className="px-8 py-3 rounded-full font-bold text-lg border border-white/20 hover:border-white/40 transition-colors"
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
              className="bg-white/5 rounded-2xl p-6 flex flex-col gap-3 border"
              style={{ borderColor: `${f.color}40` }}
            >
              <span className="text-3xl">{f.icon}</span>
              <h3 className="font-bold text-lg" style={{ color: f.color }}>{f.title}</h3>
              <p className="text-white/50 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Practitioner section */}
      <section className="px-6 py-16 max-w-6xl mx-auto w-full">
        <div
          className="rounded-3xl p-10 flex flex-col md:flex-row gap-10 items-center border"
          style={{ background: `${PURPLE}10`, borderColor: `${PURPLE}40` }}
        >
          <div className="flex-1 flex flex-col gap-4">
            <span className="text-4xl">🩺</span>
            <h2 className="text-3xl font-bold">Built for practitioners</h2>
            <p className="text-white/60">
              Manage your patients, assign custom workout plans, monitor session completion,
              and receive automated progress reports — all from one app.
            </p>
            <ul className="flex flex-col gap-2 text-sm text-white/70 mt-2">
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
            className="flex-1 flex flex-col gap-4 rounded-2xl p-6 border bg-white/5"
            style={{ borderColor: `${PURPLE}60` }}
          >
            <p className="font-bold text-lg" style={{ color: PURPLE }}>Practitioner Pro</p>
            <p className="text-white/50 text-sm">
              Apply in the app to get approved as a practitioner and unlock the full suite of tools.
            </p>
            <a
              href="https://apps.apple.com/app/id6762567982"
              target="_blank"
              rel="noopener noreferrer"
              className="text-center py-3 rounded-xl font-bold text-[#0f1117] mt-2"
              style={{ backgroundColor: PURPLE }}
            >
              Get Started
            </a>
          </div>
        </div>
      </section>

      {/* Gym Owner Pricing */}
      <section id="gym-owners" className="px-6 py-16 max-w-6xl mx-auto w-full">
        <h2 className="text-3xl font-bold text-center mb-4">Gym Owner Plans</h2>
        <p className="text-center text-white/50 mb-12">Manage multiple PTs under one gym account. All prices in CAD.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {gymTiers.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl p-6 flex flex-col gap-3 border"
              style={t.highlight
                ? { borderColor: YELLOW, background: `${YELLOW}12` }
                : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)' }}
            >
              {t.highlight && (
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full self-start text-[#0f1117]"
                  style={{ backgroundColor: YELLOW }}
                >
                  Most Popular
                </span>
              )}
              <p className="font-bold text-lg">{t.name}</p>
              <div className="flex items-end gap-1">
                <span
                  className="text-3xl font-extrabold"
                  style={t.highlight ? { color: YELLOW } : {}}
                >
                  {t.price}
                </span>
                <span className="text-white/40 text-sm mb-1">{t.per}</span>
              </div>
              <p className="text-white/50 text-sm">{t.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-white/40 text-sm mt-6">
          Apply for a gym account through the app. Overflow PTs billed at your plan&apos;s per-PT rate.
        </p>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 flex flex-col items-center gap-6 text-center">
        <h2 className="text-4xl font-extrabold">Ready to get started?</h2>
        <p className="text-white/50 max-w-md">
          Download LiftLog free on the App Store and start tracking your first workout today.
        </p>
        <a
          href="https://apps.apple.com/app/id6762567982"
          target="_blank"
          rel="noopener noreferrer"
          className="px-10 py-4 rounded-full font-bold text-[#0f1117] text-lg shadow-xl"
          style={{ backgroundColor: TEAL }}
        >
          Download Free
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-8 text-center text-white/30 text-sm mt-auto">
        <div className="flex justify-center gap-6 mb-4">
          <Link href="/invite" className="hover:text-white/60 transition-colors">PT Invite Portal</Link>
          <a href="mailto:logthelift@gmail.com" className="hover:text-white/60 transition-colors">Contact</a>
        </div>
        © {new Date().getFullYear()} LiftLog. All rights reserved.
      </footer>
    </div>
  );
}
