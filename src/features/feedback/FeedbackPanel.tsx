import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { diagnosticRows } from '@/services/feedback/diagnostics';
import {
  CATEGORY_LABELS,
  FEEDBACK_CATEGORIES,
  MAX_MESSAGE_LENGTH,
  collectDiagnostics,
  sendFeedback,
  type FeedbackCategory,
  type FeedbackResult,
} from '@/services/feedback/submit';

/**
 * Sending feedback from inside the app (#196).
 *
 * The design constraint that shapes every decision here is that this repository
 * is **public**: what the user writes becomes a world-readable issue. So the
 * warning sits above the button in ordinary type rather than in a footnote, the
 * diagnostics are listed in full before they are sent rather than described in
 * the abstract, and nothing is attached that the person did not either type or
 * see listed.
 */
export function FeedbackPanel() {
  const { pathname } = useLocation();
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FeedbackResult | null>(null);

  // Captured from the route the user is on when they open Settings, which is
  // near enough: they navigated here to report the thing, and the alternative
  // (remembering the previous route) reports the screen they left rather than
  // the screen they meant.
  const diagnostics = useMemo(() => collectDiagnostics(pathname), [pathname]);
  const rows = useMemo(() => diagnosticRows(diagnostics), [diagnostics]);

  const submit = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed === '' || sending) return;
    setSending(true);
    setResult(null);
    void sendFeedback({
      message: trimmed,
      category: category === '' ? undefined : category,
      diagnostics,
    }).then((outcome) => {
      setSending(false);
      setResult(outcome);
      // Only cleared on success. A failed send that also wiped the textarea
      // would lose what the person wrote, which is a worse outcome than the
      // failure itself.
      if (outcome.kind === 'filed') {
        setMessage('');
        setCategory('');
      }
    });
  }, [category, diagnostics, message, sending]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4" aria-hidden="true" /> Send feedback
        </CardTitle>
        <CardDescription>
          Something broken, confusing, or missing? Tell me here rather than going hunting for the
          repository.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="feedback-category">What kind of thing is it?</Label>
          <Select
            id="feedback-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as FeedbackCategory | '')}
          >
            <option value="">Not sure</option>
            {FEEDBACK_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-message">What happened?</Label>
          <Textarea
            id="feedback-message"
            rows={5}
            maxLength={MAX_MESSAGE_LENGTH}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="The label scan dropped the roaster's description…"
          />
          <p className="text-muted-foreground text-xs">
            {message.length} / {MAX_MESSAGE_LENGTH}
          </p>
        </div>

        <div
          role="group"
          aria-labelledby="feedback-attached"
          className="bg-muted/40 rounded-lg border p-3"
        >
          <p className="text-sm font-medium" id="feedback-attached">
            Sent with your message
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Nothing else goes with it — not your name or email, and none of your coffees, ratings or
            photos.
          </p>
        </div>

        {/* Above the button, in normal type. Someone who only reads one sentence
            on this card has to read this one. */}
        <p className="text-sm leading-relaxed">
          <strong>This becomes a public issue</strong> on the project&rsquo;s GitHub repository,
          where anyone can read it. Please don&rsquo;t type anything here you would not post
          publicly.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={submit} disabled={sending || message.trim() === ''}>
            {sending ? 'Sending…' : 'Send feedback'}
          </Button>
        </div>

        {result && <FeedbackOutcome result={result} />}
      </CardContent>
    </Card>
  );
}

/**
 * Closing the loop.
 *
 * Feedback sent into a void is assumed to have vanished, and the assumption is
 * usually right. Linking the issue that was just created costs nothing — the
 * endpoint already returns it — and turns "I hope someone reads this" into
 * something the person can watch.
 */
function FeedbackOutcome({ result }: { result: FeedbackResult }) {
  if (result.kind === 'filed') {
    return (
      <p role="status" className="text-sm leading-relaxed">
        Thank you — this went straight to the backlog as{' '}
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2"
        >
          issue #{result.number}
        </a>
        , where you can follow what happens to it.
      </p>
    );
  }

  if (result.kind === 'unconfigured') {
    return (
      <p role="status" className="text-sm leading-relaxed">
        Feedback isn&rsquo;t wired up on this deployment yet, so nothing was sent. You can{' '}
        <a
          href={result.fallbackUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2"
        >
          open an issue directly
        </a>{' '}
        — your message is still in the box above to copy.
      </p>
    );
  }

  if (result.kind === 'rate-limited') {
    return (
      <p role="status" className="text-sm leading-relaxed">
        That&rsquo;s a lot of feedback at once. Give it a few minutes and try again — your message
        is still here.
      </p>
    );
  }

  return (
    <p role="alert" className="text-destructive text-sm leading-relaxed">
      {result.message}
    </p>
  );
}
