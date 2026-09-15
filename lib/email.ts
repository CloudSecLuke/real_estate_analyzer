// Outbound email via Resend's REST API (PROP-4). Deliberately a plain
// fetch — no SDK dependency for one endpoint. Degrades gracefully: when
// RESEND_API_KEY is absent, sends are skipped and callers decide what to
// tell the user. Until a sending domain is verified in Resend, the
// resend.dev onboarding sender keeps the flow working.

const FROM_FALLBACK = "PropPencil <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? FROM_FALLBACK,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      console.error("email_send_failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("email_send_failed", err);
    return false;
  }
}
