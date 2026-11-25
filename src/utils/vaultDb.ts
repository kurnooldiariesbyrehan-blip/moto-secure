import {
  FileCategory,
  HiddenApp,
  PrivateBookmark,
  PrivateContact,
  SecurityLogEntry,
  VaultConfig,
  VaultFileMeta,
  VaultFileRecord,
  VaultNote,
  VaultNoteRecord,
} from '../types/vault';
import { decryptBuffer, encryptBuffer } from './crypto';

const CONFIG_KEY = 'moto_secure_folder_config_v1';
const DB_NAME = 'moto_secure_folder_vault_v1';
const DB_VERSION = 1;

export function loadVaultConfig(): VaultConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VaultConfig;
  } catch {
    return null;
  }
}

export function saveVaultConfig(config: VaultConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearVaultConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('apps')) {
        db.createObjectStore('apps', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        db.createObjectStore('logs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sandbox')) {
        db.createObjectStore('sandbox', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function classifyFileCategory(mimeType: string, name: string): FileCategory {
  const lower = name.toLowerCase();
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|svg)$/.test(lower)) return 'image';
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return 'video';
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/.test(lower)) return 'audio';
  if (
    mimeType.includes('pdf') ||
    mimeType.startsWith('text/') ||
    /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json)$/.test(lower)
  ) {
    return 'document';
  }
  return 'other';
}

export async function addEncryptedFile(
  file: File,
  masterKey: CryptoKey
): Promise<VaultFileMeta> {
  const buffer = await file.arrayBuffer();
  const { ivBase64, encryptedBytes } = await encryptBuffer(buffer, masterKey);
  const record: VaultFileRecord = {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    category: classifyFileCategory(file.type, file.name),
    createdAt: Date.now(),
    ivBase64,
    encryptedBytes,
  };

  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    category: record.category,
    createdAt: record.createdAt,
  };
}

export async function listVaultFiles(): Promise<VaultFileMeta[]> {
  const db = await openVaultDb();
  const records = await new Promise<VaultFileRecord[]>((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').getAll();
    req.onsuccess = () => resolve((req.result as VaultFileRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
  return records
    .map(({ id, name, mimeType, size, category, createdAt }) => ({
      id,
      name,
      mimeType,
      size,
      category,
      createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function decryptVaultFileBlob(id: string, masterKey: CryptoKey): Promise<{ blob: Blob; meta: VaultFileMeta }> {
  const db = await openVaultDb();
  const record = await new Promise<VaultFileRecord | undefined>((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(id);
    req.onsuccess = () => resolve(req.result as VaultFileRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!record) {
    throw new Error('Encrypted file not found');
  }
  const plainBuffer = await decryptBuffer(record.encryptedBytes, record.ivBase64, masterKey);
  const blob = new Blob([plainBuffer], { type: record.mimeType });
  return {
    blob,
    meta: {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      category: record.category,
      createdAt: record.createdAt,
    },
  };
}

export async function deleteVaultFile(id: string): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEncryptedNote(note: VaultNote, masterKey: CryptoKey): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(note));
  const { ivBase64, encryptedBytes } = await encryptBuffer(payload.buffer, masterKey);
  const record: VaultNoteRecord = {
    id: note.id,
    ivBase64,
    encryptedBytes,
    updatedAt: note.updatedAt,
  };
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listDecryptedNotes(masterKey: CryptoKey): Promise<VaultNote[]> {
  const db = await openVaultDb();
  const records = await new Promise<VaultNoteRecord[]>((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly');
    const req = tx.objectStore('notes').getAll();
    req.onsuccess = () => resolve((req.result as VaultNoteRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
  const notes: VaultNote[] = [];
  for (const rec of records) {
    try {
      const plain = await decryptBuffer(rec.encryptedBytes, rec.ivBase64, masterKey);
      const parsed = JSON.parse(new TextDecoder().decode(plain)) as VaultNote;
      notes.push(parsed);
    } catch {
      // Skip corrupted or mismatched key records
    }
  }
  return notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export async function deleteVaultNote(id: string): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listHiddenApps(): Promise<HiddenApp[]> {
  const db = await openVaultDb();
  const apps = await new Promise<HiddenApp[]>((resolve, reject) => {
    const tx = db.transaction('apps', 'readonly');
    const req = tx.objectStore('apps').getAll();
    req.onsuccess = () => resolve((req.result as HiddenApp[]) || []);
    req.onerror = () => reject(req.error);
  });
  return apps.sort((a, b) => a.addedAt - b.addedAt);
}

export async function saveHiddenApps(apps: HiddenApp[]): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('apps', 'readwrite');
    const store = tx.objectStore('apps');
    store.clear();
    for (const app of apps) {
      store.put(app);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function appendSecurityLog(
  event: SecurityLogEntry['event'],
  detail: string
): Promise<void> {
  const db = await openVaultDb();
  const entry: SecurityLogEntry = {
    id: crypto.randomUUID(),
    event,
    detail,
    timestamp: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('logs', 'readwrite');
    tx.objectStore('logs').put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSecurityLogs(): Promise<SecurityLogEntry[]> {
  const db = await openVaultDb();
  const logs = await new Promise<SecurityLogEntry[]>((resolve, reject) => {
    const tx = db.transaction('logs', 'readonly');
    const req = tx.objectStore('logs').getAll();
    req.onsuccess = () => resolve((req.result as SecurityLogEntry[]) || []);
    req.onerror = () => reject(req.error);
  });
  return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 40);
}

export async function loadSandboxData<T>(key: string, masterKey: CryptoKey, fallback: T): Promise<T> {
  const db = await openVaultDb();
  const rec = await new Promise<{ id: string; ivBase64: string; encryptedBytes: ArrayBuffer } | undefined>((resolve, reject) => {
    const tx = db.transaction('sandbox', 'readonly');
    const req = tx.objectStore('sandbox').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!rec) return fallback;
  try {
    const plain = await decryptBuffer(rec.encryptedBytes, rec.ivBase64, masterKey);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return fallback;
  }
}

export async function saveSandboxData<T>(key: string, data: T, masterKey: CryptoKey): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(data));
  const { ivBase64, encryptedBytes } = await encryptBuffer(payload.buffer, masterKey);
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sandbox', 'readwrite');
    tx.objectStore('sandbox').put({ id: key, ivBase64, encryptedBytes });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function wipeEntireVault(): Promise<void> {
  clearVaultConfig();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export type { PrivateBookmark, PrivateContact };
