import { SplitTitle } from "../components/SplitTitle";
import { useEffect, useState } from "react";
import { api, errText } from "../lib/api";
import { useApp } from "../lib/context";
import type { Settings } from "../lib/types";

export default function SettingsPage() {
  const { hasKey, refreshKey, notify, startTour } = useApp();
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    api.settingsGet().then(setSettings).catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [notify]);
  useEffect(() => {
    if (hasKey) api.modelsList().then(setModels).catch(() => setModels([]));
  }, [hasKey]);

  const saveKey = async () => {
    setChecking(true);
    try {
      await api.apiKeySet(key);
      setKey("");
      await refreshKey();
      notify({ text: "API key works and is saved in your system keychain.", tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    } finally {
      setChecking(false);
    }
  };

  const removeKey = async () => {
    try {
      await api.apiKeyRemove();
      await refreshKey();
      notify({ text: "API key removed." });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await api.settingsSet(settings);
      notify({ text: "Settings saved.", tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  const num = (k: "spend_limit_usd" | "input_price_per_mtok" | "output_price_per_mtok" | "fast_input_price_per_mtok" | "fast_output_price_per_mtok") => ({
    type: "number",
    step: "0.01",
    min: "0",
    value: settings ? String(settings[k]) : "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      settings && setSettings({ ...settings, [k]: Number(e.target.value) || 0 }),
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <SplitTitle text="Settings" />

      <section data-tour="apikey" className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Anthropic API key</h2>
          <span className={`font-mono text-xs ${hasKey ? "text-sonny" : "text-accent"}`}>
            {hasKey ? "● CONNECTED" : "● NOT SET"}
          </span>
        </div>
        <p className="text-sm text-muted">
          Lymbo uses your own key, and you pay Anthropic directly for what the agents use. The key is stored in your
          system keychain, never in Lymbo's files or logs. Get one at console.anthropic.com.
        </p>
        <div className="flex gap-2">
          <input
            className="input font-mono"
            type="password"
            placeholder={hasKey ? "Paste a new key to replace the current one" : "sk-ant-..."}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn btn-primary shrink-0" disabled={!key.trim() || checking} onClick={saveKey}>
            {checking ? "Checking…" : "Check & save"}
          </button>
        </div>
        {hasKey && (
          <button className="btn self-start" onClick={removeKey}>Remove key</button>
        )}
      </section>

      {settings && (
        <section className="card flex flex-col gap-4">
          <h2 className="font-semibold">Model and spending</h2>
          {([
            ["model", "SONNY's model", "Tailored resumes and cover letters. KASPR doesn't use AI, so he costs nothing.", "input_price_per_mtok", "output_price_per_mtok"],
          ] as const).map(([k, label, hint, inK, outK]) => (
            <div key={k} className="flex flex-col gap-2">
              <label className="label">{label}</label>
              {models.length > 0 ? (
                <select className="input font-mono" value={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}>
                  {!models.includes(settings[k]) && (
                    <option value={settings[k]}>{settings[k] ? `${settings[k]} (not available)` : "Pick automatically"}</option>
                  )}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input className="input font-mono" placeholder="Pick automatically" value={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} />
              )}
              <p className="text-xs text-muted">{hint}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Input $ / million tokens</label>
                  <input className="input font-mono" {...num(inK)} />
                </div>
                <div>
                  <label className="label">Output $ / million tokens</label>
                  <input className="input font-mono" {...num(outK)} />
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">
            Prices are only used for Lymbo's cost estimate. Check them against Anthropic's pricing page. If a saved model is
            retired, Lymbo switches to a current one on its own.
          </p>
          <div>
            <label className="label">Spending limit per session (USD, 0 = none)</label>
            <input className="input font-mono" {...num("spend_limit_usd")} />
            <p className="mt-1 text-xs text-muted">
              Lymbo blocks agent requests once a session's estimated cost hits this. It's an estimate, so also set a
              limit in your Anthropic console.
            </p>
          </div>
          <button className="btn btn-primary self-start" onClick={saveSettings}>Save</button>
        </section>
      )}
      <section className="card flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Tour</h2>
          <p className="text-sm text-muted">A one-minute walk through Lymbo, screen by screen.</p>
        </div>
        <button className="btn" onClick={startTour}>Take the tour</button>
      </section>
      <p className="px-1 text-xs text-muted">
        Lymbo is an independent project. It isn't affiliated with or endorsed by Handshake or Anthropic.
      </p>
    </div>
  );
}
