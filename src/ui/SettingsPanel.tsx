import type { Ref } from 'react';
import { BorderBeam } from 'border-beam';
import { HeadTrackingControl } from '../sensors/HeadTrackingControl.js';

// The second card in the right dock, below Assets. Holds persistent preferences (head tracking),
// in the same BorderBeam frosted style as the prompt bar and Assets panel.
export function SettingsPanel({ voiceControlsRef }: { voiceControlsRef?: Ref<HTMLDivElement> }) {
  return <BorderBeam size="md" colorVariant="mono" strength={0.7} theme="dark" borderRadius={24} className="assets-beam settings-beam">
    <section className="settings-panel" aria-label="Settings">
      <h2 className="assets-title">Settings</h2>
      <HeadTrackingControl/>
      <div className="voice-settings-section">
        <h3 className="settings-subtitle">Voice Agent</h3>
        <div ref={voiceControlsRef}/>
      </div>
    </section>
  </BorderBeam>;
}
