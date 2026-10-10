// Local backup snapshots: JSON dumps of the whole training store, written after
// each workout when enabled (Settings > Data). Two backends share one code path:
//  - Android APK (Capacitor): written to the device Documents directory, which
//    Nextcloud/Syncthing folder sync can pick up. Keeps the newest KEEP files.
//  - Browser/PWA: triggers a normal download (no persistent folder access there;
//    automatic folder backup requires the APK wrapper, not the wrapper alone).
import { exportAll, getSettings } from "./repo";

const KEEP = 10;
const PREFIX = "magnus-profectus-backup-";

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${PREFIX}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export async function buildBackupJson(): Promise<string> {
  return JSON.stringify(await exportAll(), null, 2);
}

export async function saveBackup(): Promise<{ saved: string; location: "file" | "download"; path?: string }> {
  const json = await buildBackupJson();
  const name = backupFileName();
  try {
    const cap = await import("@capacitor/core");
    const Cap = (cap as any).Capacitor;
    if (Cap?.isNativePlatform?.()) {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({ path: name, data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
      await pruneOld(Filesystem, Directory.Documents);
      const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Documents });
      // Documents on Android 11+ is the APP-PRIVATE folder, not the public one.
      const publicPath = uri.replace(/^file:\/\//, "").replace(/\/.*\/Android\/data\//, "/Android/data/");
      return { saved: name, location: "file", path: publicPath };
    }
  } catch { /* no native platform available, fall through to download */ }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  return { saved: name, location: "download" };
}

async function pruneOld(fs: any, directory: unknown): Promise<void> {
  try {
    const res = await fs.readdir({ path: "", directory });
    const backups = (res.files ?? [])
      .map((f: any) => f.name as string)
      .filter((n: string) => n.startsWith(PREFIX))
      .sort();
    for (const n of backups.slice(0, Math.max(0, backups.length - KEEP))) {
      await fs.deleteFile({ path: n, directory });
    }
  } catch { /* pruning is best-effort, never blocks saving */ }
}

/** Write a file and hand it to the user: on Android through the share sheet
 *  (WebView downloads silently do nothing), in the browser as a download.
 *  The share sheet lets the user pick any destination: Nextcloud, Drive, Files. */
export async function exportFile(name: string, content: string, mimeType: string): Promise<string> {
  try {
    const cap = await import("@capacitor/core");
    const Cap = (cap as any).Capacitor;
    if (Cap?.isNativePlatform?.()) {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const { uri } = await Filesystem.writeFile({ path: name, data: content, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      await Share.share({ title: name, url: uri, dialogTitle: "Save or send " + name });
      return `Shared ${name}. Pick a destination in the sheet (Nextcloud, Files, Drive).`;
    }
  } catch (err) {
    if ((err as any)?.message?.includes?.("cancel")) return "Share cancelled, nothing saved.";
    /* fall through to browser download on any other error */
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  return `Downloaded ${name}.`;
}

/** Called after a workout is finished. No-op unless the user enabled local backups. */
export async function maybeAutosave(): Promise<void> {
  try {
    const s = await getSettings();
    if (!s?.local_backups) return;
    await saveBackup();
  } catch { /* a failed backup must never break finishing a workout */ }
}

/** Migration safety net: called on boot when the Dexie schema version changed
 *  since the last run. The upgrade already happened by then (Dexie upgrades on
 *  open), but a full snapshot taken immediately after still guards against a
 *  broken upgrade path or a later bug eating data. Native: Documents file with
 *  its own prefix (never pruned by the workout-backup rotation). Web: localStorage
 *  (roughly a few MB of logs; skipped with a warning if it does not fit). */
export async function snapshotOnSchemaChange(toVersion: number): Promise<string | null> {
  const json = JSON.stringify(await exportAll(), null, 2);
  const name = `${PREFIX.replace("-backup-", "-schema-")}${new Date().toISOString().slice(0, 10)}-v${toVersion}.json`;
  try {
    const cap = await import("@capacitor/core");
    const Cap = (cap as any).Capacitor;
    if (Cap?.isNativePlatform?.()) {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({ path: name, data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
      const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Documents });
      return uri.replace(/^file:\/\//, "").replace(/\/.*\/Android\/data\//, "/Android/data/");
    }
  } catch { /* fall through to localStorage */ }
  try {
    localStorage.setItem(`${PREFIX}schema-snapshot-v${toVersion}`, json);
    return "browser storage";
  } catch {
    console.warn(`[backup] schema snapshot v${toVersion} too large for browser storage; run Export JSON manually to be safe`);
    return null;
  }
}
