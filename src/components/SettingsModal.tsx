import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff, KeyRound, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { DEFAULT_API_SUFFIX, DEFAULT_QB_URL, FILTER_OPTIONS } from "../constants";
import type { SettingsState, TokenTestResult } from "../types";

export function SettingsModal({ value, secureError, onSave, onClose, onPickFolder }: {
  value: SettingsState;
  secureError?: string | null;
  onSave: (value: SettingsState) => Promise<void>;
  onClose: () => void;
  onPickFolder: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(value);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TokenTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showApiSuffix, setShowApiSuffix] = useState(false);
  const patch = (next: Partial<SettingsState>) => setDraft((current) => ({ ...current, ...next }));

  async function testToken() {
    setTesting(true); setError(null); setResult(null);
    try {
      const response = await invoke<TokenTestResult>("test_token", {
        credentials: { username: draft.username, accessToken: draft.accessToken },
        quickBuildConfig: { baseUrl: draft.quickBuildUrl, apiSuffix: draft.apiSuffix },
      });
      setResult(response);
      if (response.selectedUsername) patch({ username: response.selectedUsername });
    } catch (reason) { setError(String(reason)); }
    finally { setTesting(false); }
  }

  async function save() {
    setSaving(true); setError(null);
    try { await onSave(draft); onClose(); }
    catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal settings-modal">
        <div className="modal-header"><div><h2>Settings</h2><span>Credentials and API suffix are encrypted in Stronghold.</span></div><button className="ghost-icon" title="Close" onClick={onClose}><X size={18} /></button></div>
        {(secureError || error) && <div className="settings-error">{secureError || error}</div>}
        <label>QuickBuild URL<input value={draft.quickBuildUrl} onChange={(event) => patch({ quickBuildUrl: event.target.value })} placeholder={DEFAULT_QB_URL} /></label>
        <label>API suffix<div className="secret-input"><input type={showApiSuffix ? "text" : "password"} value={draft.apiSuffix} onChange={(event) => patch({ apiSuffix: event.target.value })} /><button className="ghost-icon" type="button" title={showApiSuffix ? "Hide API suffix" : "Show API suffix"} onClick={() => setShowApiSuffix((visible) => !visible)}>{showApiSuffix ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <button className="secondary-button endpoint-reset" onClick={() => patch({ quickBuildUrl: DEFAULT_QB_URL, apiSuffix: DEFAULT_API_SUFFIX })}><RotateCcw size={16} />Reset endpoint defaults</button>
        <label>Username<input value={draft.username} onChange={(event) => patch({ username: event.target.value })} placeholder="corp\\username or username" /></label>
        <label>Access token<div className="secret-input"><input type={showAccessToken ? "text" : "password"} value={draft.accessToken} onChange={(event) => patch({ accessToken: event.target.value })} /><button className="ghost-icon" type="button" title={showAccessToken ? "Hide access token" : "Show access token"} onClick={() => setShowAccessToken((visible) => !visible)}>{showAccessToken ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <div className="token-test-row"><button className="secondary-button" disabled={testing || !draft.username || !draft.accessToken} onClick={testToken}><KeyRound size={16} />{testing ? "Testing..." : "Test token"}</button>{result && <span className={`test-summary ${result.ok ? "ok" : "failed"}`}>{result.ok ? "Token OK" : "Token test failed"}</span>}</div>
        {result && <div className="test-result-list">{result.attempts.map((attempt) => <div className={attempt.ok ? "ok" : "failed"} key={attempt.username}><strong>{attempt.username || "(empty)"}</strong><span>{attempt.message}</span></div>)}</div>}
        <label>Download folder<div className="folder-input"><input value={draft.downloadTargetDir} readOnly placeholder="Choose target folder" /><button className="secondary-button" onClick={async () => { const path = await onPickFolder(); if (path) patch({ downloadTargetDir: path }); }}>Browse</button></div></label>
        <label className="toggle-row"><input type="checkbox" checked={draft.showCompleteDialog} onChange={(event) => patch({ showCompleteDialog: event.target.checked })} />Show complete dialog when download finishes</label>
        <label className="toggle-row"><input type="checkbox" checked={draft.hideUncheckedArtifacts} onChange={(event) => patch({ hideUncheckedArtifacts: event.target.checked })} />Auto-check filtered artifacts on fetch</label>
        <label className="toggle-row"><input type="checkbox" checked={draft.darkMode} onChange={(event) => patch({ darkMode: event.target.checked })} />Dark mode</label>
        <label>Dashboard server URL<input value={draft.serverUrl} onChange={(event) => patch({ serverUrl: event.target.value })} placeholder="https://qd.endrisusanto.my.id" /></label>
        <label>PC display name<input value={draft.pcName} onChange={(event) => patch({ pcName: event.target.value })} placeholder="Auto (hostname)" /></label>
        <label>Remote cancel PIN<div className="secret-input"><input type="password" inputMode="numeric" value={draft.remoteCancelPin} onChange={(event) => patch({ remoteCancelPin: event.target.value })} placeholder="Required for Web and Android cancel" /></div></label>
        <div className="type-grid">{FILTER_OPTIONS.map((filter) => <button key={filter} className={`type-chip ${draft.selectedTypes.includes(filter) ? "selected" : ""}`} onClick={() => patch({ selectedTypes: draft.selectedTypes.includes(filter) ? draft.selectedTypes.filter((item) => item !== filter) : [...draft.selectedTypes, filter] })}>{filter}</button>)}</div>
        <div className="modal-actions"><button className="primary-button" disabled={saving || Boolean(secureError)} onClick={save}>{saving ? "Saving..." : "Save"}</button></div>
      </div>
    </div>
  );
}
