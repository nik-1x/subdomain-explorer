import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Caption, Input, LargeTitle, Text } from '@telegram-apps/telegram-ui';
import { isValidDomain, normalizeDomain } from '../lib/domain';
import { haptic, notify } from '../lib/telegram';
import './SearchPage.css';

const EXAMPLES = ['telegram.org', 'github.com', 'vercel.com'];

/** Landing screen: one centered field, nothing else to think about. */
export function SearchPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (raw: string) => {
    const domain = normalizeDomain(raw);
    if (!isValidDomain(domain)) {
      setError('Enter a domain like example.com');
      notify('error');
      return;
    }
    haptic('medium');
    navigate(`/d/${encodeURIComponent(domain)}`);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(value);
  };

  return (
    <div className="search-page">
      <form className="search-page__box" onSubmit={onSubmit}>
        <div className="search-page__mark" aria-hidden>
          ⌘
        </div>
        <LargeTitle weight="1" className="search-page__title">
          Subdomain Explorer
        </LargeTitle>
        <Text className="search-page__lead">
          Every certificate a domain issues is public. Type a domain to pull its subdomains out of
          the certificate index — then scroll to see which ones still resolve.
        </Text>

        <Input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="example.com"
          value={value}
          status={error ? 'error' : 'default'}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          after={
            <Button size="s" type="submit" disabled={value.trim().length === 0}>
              Search
            </Button>
          }
        />

        <div className="search-page__hint">
          {error ? (
            <Caption level="1" className="search-page__error">
              {error}
            </Caption>
          ) : (
            <Caption level="1" className="search-page__examples">
              Try{' '}
              {EXAMPLES.map((example, index) => (
                <span key={example}>
                  {index > 0 ? ' · ' : ''}
                  <button type="button" onClick={() => submit(example)}>
                    {example}
                  </button>
                </span>
              ))}
            </Caption>
          )}
        </div>
      </form>

      <Caption level="2" className="search-page__footer">
        Certificate data · resolution over DNS-over-HTTPS
      </Caption>
    </div>
  );
}
