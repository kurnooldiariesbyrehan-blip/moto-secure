export type LockType = 'pin' | 'password' | 'pattern';

export type AutoLockTimeout = 0 | 60000 | 300000 | -1;

export type FolderAccentColor = 'cobalt' | 'indigo' | 'emerald' | 'slate';

export type DisguisePreset = 'secure' | 'calculator' | 'weather' | 'notes';

export type FileCategory = 'image' | 'video' | 'document' | 'audio' | 'other';

export interface VaultConfig {
  isInitialized: boolean;
  lockType: LockType;
  saltBase64: string;
  verifierHashBase64: string;
  wrappedMasterKeyBase64: string;
  wrapIvBase64: string;
  biometricEnabled: boolean;
  webAuthnCredentialId?: string;
  biometricWrappedKeyBase64?: string;
  biometricWrapIvBase64?: string;
  biometricDeviceSecretBase64?: string;
  autoLockTimeout: AutoLockTimeout;
  hideNotifications: boolean;
  disguiseMode: boolean;
  disguisePreset: DisguisePreset;
  folderName: string;
  accentColor: FolderAccentColor;
  darkMode: boolean;
  failedAttempts: number;
  lockoutUntil: number | null;
  createdAt: number;
}

export interface VaultFileRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  category: FileCategory;
  createdAt: number;
  ivBase64: string;
  encryptedBytes: ArrayBuffer;
}

export interface VaultFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  category: FileCategory;
  createdAt: number;
}

export interface VaultNoteRecord {
  id: string;
  ivBase64: string;
  encryptedBytes: ArrayBuffer;
  updatedAt: number;
}

export interface VaultNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  updatedAt: number;
}

export type AppSandboxType = 'gallery' | 'camera' | 'browser' | 'contacts' | 'cloned';

export interface HiddenApp {
  id: string;
  name: string;
  category: string;
  color: string;
  iconKey: string;
  sandboxType: AppSandboxType;
  isSystemVaultApp: boolean;
  hideNotifications: boolean;
  addedAt: number;
  badgeText?: string;
}

export interface PrivateContact {
  id: string;
  name: string;
  phone: string;
  note: string;
  createdAt: number;
}

export interface PrivateBookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

export interface SecurityLogEntry {
  id: string;
  event: 'unlock_pin' | 'unlock_password' | 'unlock_pattern' | 'unlock_biometric' | 'unlock_calculator' | 'failed_attempt' | 'locked' | 'settings_changed' | 'file_added';
  detail: string;
  timestamp: number;
}
