import type { SettingsState } from "./types";

export const STORAGE_KEY = "quickbuild-download-manager-settings";
export const DOWNLOAD_HISTORY_KEY = "quickbuild-download-manager-history";
export const DIALOG_CHANNEL = "quickbuild-download-dialogs";
export const DEFAULT_QB_URL = "https://android.qb.sec.samsung.net";
export const FILTER_OPTIONS = ["ALL_", "AP_", "BL_", "CP_", "CSC_", "md5", "USERDATA_", "HOME_"];

export const defaultSettings: SettingsState = {
  username: "",
  accessToken: "",
  quickBuildUrl: DEFAULT_QB_URL,
  downloadTargetDir: "",
  selectedTypes: FILTER_OPTIONS,
  showCompleteDialog: false,
  hideUncheckedArtifacts: false,
  darkMode: false,
  serverUrl: "",
  pcName: "",
  remoteCancelPin: "",
  maxConcurrent: 3,
};
