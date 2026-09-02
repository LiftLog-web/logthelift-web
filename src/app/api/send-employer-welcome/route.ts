import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

// Manual call: { email: "..." }
const ManualBodySchema = z.object({
  email: z.string().email().max(254),
});

// Supabase Database Webhook payload shape (UPDATE on profiles)
const WebhookBodySchema = z.object({
  type:   z.string(),
  record: z.object({
    email:       z.string().email(),
    is_employer: z.boolean().optional(),
  }),
  old_record: z.object({
    is_employer: z.boolean().optional(),
  }).optional(),
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildWelcomeHtml(companyName: string | null, recipientEmail: string): string {
  const greeting = companyName ? `Welcome, ${escapeHtml(companyName)}!` : 'Welcome to LiftLog!';
  const nameDisplay = companyName ? escapeHtml(companyName) : 'your company';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:40px 24px;">

    <div style="margin-bottom:32px;">
      <span style="color:#5fcfbf;font-size:24px;font-weight:800;letter-spacing:-0.5px;">LiftLog</span>
    </div>

    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:36px;">
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Employer Account</p>
      <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 12px;">${greeting}</h1>
      <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 32px;">
        Your LiftLog employer account is active. This email walks you through everything you need to get ${nameDisplay} up and running — from inviting your team to tracking weekly progress.
        <br><br>
        <strong style="color:#fff;">You and your management team work exclusively through the web app at <a href="https://logthelift.ca" style="color:#5fcfbf;">logthelift.ca</a>.</strong>
        Your employees will use the <strong style="color:#fff;">LiftLog mobile app</strong> (iOS &amp; Android) to log workouts, record satisfaction ratings, and receive exercise reminders.
      </p>

      <!-- Step 0: Company name -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">0</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Set Your Company Name</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          Head to your <a href="https://logthelift.ca/profile" style="color:#5fcfbf;">Profile page</a> and click the pencil icon next to your company name to set or update it. Your company name appears on the leaderboard and in employee-facing communications, so make sure it's set before inviting your team.
        </p>
      </div>

      <!-- Step 1: Invite employees -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">1</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Invite Your Employees</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 8px 38px;">
          Go to the <strong style="color:#fff;">Invite</strong> tab on the web app and enter your employees' email addresses. Each person will receive an invitation email with a download link for the LiftLog mobile app and a unique code to link their account to yours automatically.
        </p>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          <strong style="color:#fff;">Ask your employees to check their junk mail if they don't see the invite within a few minutes.</strong>
        </p>
      </div>

      <!-- Step 2: Teams & team captains -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">2</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Create Teams &amp; Assign Team Captains</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          Once your employees have joined, group them into teams from the <strong style="color:#fff;">Teams</strong> tab. Each team should have a designated <strong style="color:#fff;">Team Captain</strong> — a point person responsible for keeping the team on track with their exercise program. Team captains can lead the daily exercises themselves or assign rotating exercise leaders within the group (weekly or as needed).
        </p>
      </div>

      <!-- Step 3: Activate programs -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">3</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Activate Your Wellness Programs</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 10px 38px;">
          From the <strong style="color:#fff;">Programs</strong> tab, activate one or more of the three built-in workplace wellness programs. Your employees will receive push notification reminders at the scheduled times (Mon–Fri) and can complete the exercises directly in the LiftLog app.
        </p>
        <div style="margin-left:38px;">
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;">
            <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="color:#5fcfbf;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Office Reset</span>
              <span style="color:rgba(255,255,255,0.4);font-size:12px;margin-left:8px;">9:00 AM</span>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:4px 0 0;">A short morning movement routine to start the workday right.</p>
            </div>
            <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="color:#5fcfbf;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Desk Warrior</span>
              <span style="color:rgba(255,255,255,0.4);font-size:12px;margin-left:8px;">12:30 PM</span>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:4px 0 0;">Midday stretches and mobility exercises to beat the afternoon slump.</p>
            </div>
            <div style="padding:12px 16px;">
              <span style="color:#5fcfbf;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">5-Minute Energy Boost</span>
              <span style="color:rgba(255,255,255,0.4);font-size:12px;margin-left:8px;">4:00 PM</span>
              <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:4px 0 0;">An afternoon reset to recharge and finish the day strong.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 4: Leaderboard -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">4</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Track Progress on the Leaderboard</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          The <strong style="color:#fff;">Leaderboard</strong> tab gives you a real-time view of employee workout streaks and team engagement. Use it to recognize high performers and identify where additional encouragement may be needed.
        </p>
      </div>

      <!-- Step 5: Satisfaction ratings -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">5</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Review Employee Satisfaction Ratings</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          After each workout, employees are prompted to rate their satisfaction. You can view aggregate satisfaction scores on the web app dashboard — a simple, anonymous pulse on how the program is landing with your team.
        </p>
      </div>

      <!-- Step 6: Weekly report -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">6</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Weekly Sunday Report</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          Every Sunday, you'll automatically receive a weekly summary email covering your team's workout completions, leaderboard standings, and satisfaction scores for the past week — no login required to stay informed.
        </p>
      </div>

      <!-- Step 7: Time-off requests -->
      <div style="margin-bottom:32px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:rgba(95,207,191,0.15);border:1px solid rgba(95,207,191,0.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#5fcfbf;font-size:13px;font-weight:800;">7</span>
          </div>
          <h2 style="color:#fff;font-size:16px;font-weight:700;margin:0;">Manage Time-Off Requests</h2>
        </div>
        <p style="color:rgba(255,255,255,0.65);font-size:14px;line-height:1.7;margin:0 0 0 38px;">
          Employees can submit time-off requests through the LiftLog mobile app. You'll be able to review and manage these requests from the web app so employee streaks aren't affected while they're away.
        </p>
      </div>

      <a href="https://logthelift.ca"
         style="display:block;background:#5fcfbf;color:#0f1117;text-align:center;padding:14px 24px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;margin-bottom:24px;">
        Go to Your Dashboard →
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;">
          This email was sent to <strong style="color:rgba(255,255,255,0.5);">${escapeHtml(recipientEmail)}</strong> because an employer account was created with this address. If you have any questions, reply to this email or contact us at <a href="mailto:logthelift@gmail.com" style="color:#5fcfbf;">logthelift@gmail.com</a>.
        </p>
      </div>
    </div>

    <p style="color:rgba(255,255,255,0.2);font-size:12px;text-align:center;margin-top:24px;">
      © ${new Date().getFullYear()} LiftLog · <a href="https://logthelift.ca" style="color:rgba(255,255,255,0.3);">logthelift.ca</a>
    </p>
  </div>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured.' }, { status: 503 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfigured.' }, { status: 503 });
  }

  const webhookSecret  = process.env.EMPLOYER_WELCOME_WEBHOOK_SECRET;
  const incomingSecret = req.headers.get('x-webhook-secret');
  const isWebhook      = webhookSecret && incomingSecret === webhookSecret;

  let email: string;
  let rateLimitKey: string;

  if (isWebhook) {
    // Supabase Database Webhook path — no user session needed
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const parsed = WebhookBodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 400 });

    // Only send when is_employer flipped to true
    if (!parsed.data.record.is_employer) {
      return NextResponse.json({ skipped: true, reason: 'is_employer is not true' });
    }
    if (parsed.data.old_record?.is_employer === true) {
      return NextResponse.json({ skipped: true, reason: 'is_employer was already true' });
    }

    email         = parsed.data.record.email;
    rateLimitKey  = `send-employer-welcome:webhook:${email}`;
  } else {
    // Manual / admin call — require a valid Bearer token from a practitioner
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: callerProf } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (callerProf?.role !== 'practitioner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let parsed: ReturnType<typeof ManualBodySchema.safeParse>;
    try {
      parsed = ManualBodySchema.safeParse(await req.json());
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

    email        = parsed.data.email;
    rateLimitKey = `send-employer-welcome:${user.id}`;
  }

  // Rate limit — 20/hr regardless of path
  const rl = rateLimit(rateLimitKey, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  // Look up company name via service role (bypasses RLS)
  const adminSb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await adminSb
    .from('profiles')
    .select('company_name')
    .eq('email', email)
    .single();

  const companyName: string | null = (profile as any)?.company_name ?? null;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: emailErr } = await resend.emails.send({
    from:    'LiftLog <noreply@logthelift.ca>',
    to:      [email],
    subject: 'Welcome to LiftLog — Your Employer Account is Ready',
    html:    buildWelcomeHtml(companyName, email),
  });

  if (emailErr) {
    return NextResponse.json({ error: emailErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, sentTo: email });
}