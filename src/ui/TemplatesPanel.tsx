import { BorderBeam } from 'border-beam';
import { capturedDemos, type CapturedDemoId } from '../scene/capturedDemos.js';

export function TemplatesPanel({ disabled, onSelect }: { disabled: boolean; onSelect: (id: CapturedDemoId) => void }) {
  return <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={24} className="assets-beam">
    <section className="templates-panel" aria-label="Templates">
      <h2 className="assets-title">Templates</h2>
      <ul className="templates-list">
        {capturedDemos.map(demo => <li key={demo.id} className="place-item">
          <button type="button" className="place-row" disabled={disabled} onClick={() => onSelect(demo.id)}>{demo.label}</button>
        </li>)}
      </ul>
    </section>
  </BorderBeam>;
}
