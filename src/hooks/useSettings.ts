import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Stronghold, type Store } from "@tauri-apps/plugin-stronghold";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultSettings, STORAGE_KEY } from "../constants";
import type { SettingsState } from "../types";
import { sanitizePreferences } from "../utils";

const CLIENT_NAME = "quickbuild-settings";
const SECRET_KEYS = ["username", "accessToken", "apiSuffix"] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type VaultState = { stronghold: Stronghold; store: Store };

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const vaultRef = useRef<VaultState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bootstrap()
      .then((result) => {
        if (cancelled) return;
        vaultRef.current = result.vault;
        setSettings(result.settings);
      })
      .catch((reason) => {
        if (!cancelled) setError(actionableVaultError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSettings = useCallback(async (next: SettingsState) => {
    const vault = vaultRef.current;
    if (!vault) throw new Error("Secure storage is not available. Unlock the OS credential manager and restart the app.");
    validateSettings(next);

    for (const key of SECRET_KEYS) {
      await vault.store.insert(key, Array.from(encoder.encode(next[key])));
    }
    await vault.stronghold.save();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePreferences(next)));
    setSettings(next);
    setError(null);
  }, []);

  const patchSettings = useCallback((patch: Partial<SettingsState>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return { settings, setSettings, patchSettings, saveSettings, loading, error };
}

async function bootstrap() {
  const legacy = readLegacySettings();
  const password = await invoke<string>("secure_vault_password");
  const dataDir = await appDataDir();
  const stronghold = await Stronghold.load(await join(dataDir, "quickbuild-settings.hold"), password);
  let client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
  }
  const store = client.getStore();

  const storedSecrets = {
    username: await readSecret(store, "username"),
    accessToken: await readSecret(store, "accessToken"),
    apiSuffix: await readSecret(store, "apiSuffix"),
  };
  const migrated = {
    username: storedSecrets.username ?? String(legacy.username || ""),
    accessToken: storedSecrets.accessToken ?? String(legacy.accessToken || ""),
    apiSuffix: storedSecrets.apiSuffix ?? (legacy.apiSuffix == null ? defaultSettings.apiSuffix : String(legacy.apiSuffix)),
  };

  if (SECRET_KEYS.some((key) => migrated[key] !== storedSecrets[key])) {
    for (const key of SECRET_KEYS) {
      await store.insert(key, Array.from(encoder.encode(migrated[key])));
    }
    await stronghold.save();
  }

  const preferences = sanitizePreferences(legacy);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  return {
    vault: { stronghold, store },
    settings: { ...defaultSettings, ...preferences, ...migrated },
  };
}

async function readSecret(store: Store, key: string) {
  const value = await store.get(key);
  return value ? decoder.decode(value) : null;
}

function readLegacySettings(): Partial<SettingsState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function actionableVaultError(reason: unknown) {
  return `Secure settings could not be unlocked. Ensure Windows Credential Manager or Linux Secret Service is available, then restart the app. ${String(reason)}`;
}

function validateSettings(settings: SettingsState) {
  let url: URL;
  try { url = new URL(settings.quickBuildUrl); }
  catch { throw new Error("QuickBuild URL must be a valid HTTP or HTTPS URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("QuickBuild URL must use HTTP or HTTPS.");
  }
}
