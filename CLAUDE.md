@AGENTS.md

# logthelift-web — Coding Guidelines

## Security (OWASP API Top 10 + ASVS)

Follow these rules for every change. No exceptions without explicit discussion.

- **Every API route must authenticate.** Check a Bearer token or Supabase session before doing anything. Return 401 immediately if missing, 403 if the role check fails.
- **Rate limit all routes that send email or accept untrusted input.** Use `rateLimit()` from `@/lib/rate-limit`. Email routes: 20/hr per user. Public submission routes: 5/hr per IP.
- **Validate all request bodies with zod.** Use `z.object({...}).safeParse(await req.json())` — never trust raw input. Return 400 on failure, never log the raw payload.
- **CORS is locked to `logthelift.ca`.** Do not widen the allowed origin without discussion.
- **No secrets in source.** `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any other server secrets must be environment variables only, never hardcoded.
- **No user-supplied URLs in server-side fetch calls** (SSRF). If a URL must come from the client, validate it against an explicit allowlist.
- **No `dangerouslySetInnerHTML` with user content.** The one existing usage is for a static theme-flash script — that pattern is acceptable only for static strings.
- **Sentry is production-only with `sendDefaultPii: false`.** Do not change the sample rate or PII setting without discussion.

## Floating UI

Any floating panel (modal, dropdown, popover, hover card) must use `var(--modal-bg)` not `var(--card)` as its background, and must close on outside click via a `mousedown` listener + ref.
