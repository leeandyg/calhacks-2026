import { useState, type FormEvent } from 'react';
import { BorderBeam } from 'border-beam';

export function PromptBar() {
  const [value, setValue] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt) return;
    console.log(prompt);
    setValue('');
  };
  return <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={38} className="prompt-beam">
    <form className="prompt-bar" onSubmit={submit}>
      <input type="text" aria-label="Prompt" placeholder="Generate anything..." value={value} onChange={event => setValue(event.target.value)} autoComplete="off"/>
      <button type="submit" className="prompt-send" aria-label="Send" disabled={!value.trim()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>
      </button>
    </form>
  </BorderBeam>;
}
