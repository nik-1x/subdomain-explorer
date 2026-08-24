import { useState } from 'react';
import { Button, Caption, Section, Text, Textarea } from '@telegram-apps/telegram-ui';
import { parseHostList, searchUrl } from '../lib/crtname';
import { haptic, notify, openExternal } from '../lib/telegram';
import './Handoff.css';

interface Props {
  apex: string;
  onHosts: (hosts: string[]) => void;
  onRetry: () => void;
}

/**
 * The index sends no CORS header, so this page cannot read its response.
 * Instead of dead-ending, the request is handed to the user: they run it
 * themselves — their browser, their IP, their share of the free daily budget —
 * and paste what comes back. Everything downstream behaves as a direct fetch.
 *
 * The upstream service is deliberately not named in the UI; the URL only
 * appears in the link the buttons open or copy.
 */
export function Handoff({ apex, onHosts, onRetry }: Props) {
  const url = searchUrl(apex);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const use = (body: string) => {
    const hosts = parseHostList(body, apex);
    if (hosts.length === 0) {
      setProblem(`No ${apex} names in that text. Paste the whole response.`);
      notify('error');
      return;
    }
    notify('success');
    onHosts(hosts);
  };

  const pasteFromClipboard = async () => {
    haptic();
    try {
      const body = await navigator.clipboard.readText();
      if (!body.trim()) {
        setProblem('Clipboard is empty.');
        return;
      }
      setText(body);
      use(body);
    } catch {
      setProblem('Clipboard is not available here — paste into the box below.');
    }
  };

  return (
    <div className="handoff">
      <Section
        header="Run the request yourself"
        footer="The index does not let web pages read its responses, so the app cannot fetch this for you. Opening the request runs the query from your own browser instead."
      >
        <div className="handoff__body">
          <Text className="handoff__step">1 · Open the request and copy everything it returns.</Text>
          <div className="handoff__actions">
            <Button
              size="m"
              stretched
              onClick={() => {
                haptic('medium');
                openExternal(url);
              }}
            >
              Open request
            </Button>
            <Button
              size="m"
              mode="bezeled"
              stretched
              onClick={() => {
                haptic();
                navigator.clipboard?.writeText(url).catch(() => {});
              }}
            >
              Copy URL
            </Button>
          </div>

          <Text className="handoff__step">2 · Paste the response back here.</Text>
          <Textarea
            placeholder={`${apex}\nwww.${apex}\napi.${apex}`}
            value={text}
            rows={5}
            onChange={(event) => {
              setText(event.target.value);
              if (problem) setProblem(null);
            }}
          />
          {problem ? (
            <Caption level="1" className="handoff__problem">
              {problem}
            </Caption>
          ) : null}
          <div className="handoff__actions">
            <Button size="m" stretched disabled={text.trim().length === 0} onClick={() => use(text)}>
              Use this list
            </Button>
            <Button size="m" mode="bezeled" stretched onClick={pasteFromClipboard}>
              Paste
            </Button>
          </div>
        </div>
      </Section>

      <div className="handoff__retry">
        <Button size="s" mode="plain" onClick={onRetry}>
          Try fetching directly again
        </Button>
      </div>
    </div>
  );
}
