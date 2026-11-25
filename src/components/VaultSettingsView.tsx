import React, { useState } from 'react';
import {
  BellOff,
  Calculator,
  Check,
  Clock,
  Download,
  Fingerprint,
  History,
  KeyRound,
  Moon,
  Palette,
  ShieldAlert,
  Smartphone,
  Sun,
  Trash2,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  AutoLockTimeout,
  FolderAccentColor,
  LockType,
  SecurityLogEntry,
  VaultConfig,
} from '../types/vault';
import {
  deriveWrappingKey,
  enrollWebAuthnBiometric,
  exportCryptoKeyBytes,
  generateSalt,
  hashSecretForVerification,
  toBase64,
  wrapMasterKey,
} from '../utils/crypto';
import { ACCENT_THEMES, formatTimeStamp } from '../utils/format';
import { appendSecurityLog, wipeEntireVault } from '../utils/vaultDb';
import { PatternPad } from './PatternPad';

interface VaultSettingsViewProps {
  config: VaultConfig;
  masterKey: CryptoKey;
  logs: SecurityLogEntry[];
  onUpdateConfig: (next: VaultConfig) => void;
  onWipeComplete: () => void;
}

export const VaultSettingsView: React.FC<VaultSettingsViewProps> = ({
  config,
  masterKey,
  logs,
  onUpdateConfig,
  onWipeComplete,
}) => {
  const theme = ACCENT_THEMES[config.accentColor] || ACCENT_THEMES.cobalt;
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const [changeLockOpen, setChangeLockOpen] = useState(false);
  const [nextLockType, setNextLockType] = useState<LockType>(config.lockType);
  const [nextSecret, setNextSecret] = useState('');
  const [lockMsg, setLockMsg] = useState('');

  const [showLogs, setShowLogs] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const handleToggleBiometric = async () => {
    if (config.biometricEnabled) {
      const next: VaultConfig = {
        ...config,
        biometricEnabled: false,
      };
      onUpdateConfig(next);
      await appendSecurityLog('settings_changed', 'Biometric unlock disabled');
    } else {
      const bio = await enrollWebAuthnBiometric();
      const rawMaster = await exportCryptoKeyBytes(masterKey);
      const deviceSecretBytes = new Uint8Array(32);
      crypto.getRandomValues(deviceSecretBytes);
      const deviceSecretB64 = toBase64(deviceSecretBytes);
      const bioWrapKey = await deriveWrappingKey(deviceSecretB64, config.saltBase64);
      const bioWrapped = await wrapMasterKey(rawMaster, bioWrapKey);

      const next: VaultConfig = {
        ...config,
        biometricEnabled: true,
        webAuthnCredentialId: bio.credentialId,
        biometricDeviceSecretBase64: deviceSecretB64,
        biometricWrappedKeyBase64: bioWrapped.wrappedBase64,
        biometricWrapIvBase64: bioWrapped.ivBase64,
      };
      onUpdateConfig(next);
      await appendSecurityLog('settings_changed', 'Biometric unlock enabled');
    }
  };

  const handleSaveNewLock = async (overrideSecret?: string) => {
    const secretVal = overrideSecret ?? nextSecret;
    if (nextLockType === 'pin' && !/^\d{4,6}$/.test(secretVal)) {
      setLockMsg('PIN must be 4 to 6 digits.');
      return;
    }
    if (nextLockType === 'password' && secretVal.length < 4) {
      setLockMsg('Password must be at least 4 characters.');
      return;
    }
    const rawMaster = await exportCryptoKeyBytes(masterKey);
    const newSalt = generateSalt();
    const newVerifier = await hashSecretForVerification(secretVal, newSalt);
    const wrappingKey = await deriveWrappingKey(secretVal, newSalt);
    const wrapped = await wrapMasterKey(rawMaster, wrappingKey);

    let bioFields: Partial<VaultConfig> = {};
    if (config.biometricEnabled && config.biometricDeviceSecretBase64) {
      const bioWrapKey = await deriveWrappingKey(config.biometricDeviceSecretBase64, newSalt);
      const bioWrapped = await wrapMasterKey(rawMaster, bioWrapKey);
      bioFields = {
        biometricWrappedKeyBase64: bioWrapped.wrappedBase64,
        biometricWrapIvBase64: bioWrapped.ivBase64,
      };
    }

    const updated: VaultConfig = {
      ...config,
      lockType: nextLockType,
      saltBase64: newSalt,
      verifierHashBase64: newVerifier,
      wrappedMasterKeyBase64: wrapped.wrappedBase64,
      wrapIvBase64: wrapped.ivBase64,
      ...bioFields,
    };
    onUpdateConfig(updated);
    await appendSecurityLog('settings_changed', `Changed lock type to ${nextLockType}`);
    setChangeLockOpen(false);
    setNextSecret('');
    setLockMsg('');
  };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Lock & Security Section */}
      <section className="rounded-[24px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-xs font-semibold text-[#5C6575] dark:text-slate-400 tracking-wide">
            Lock & Authentication
          </h2>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          <button
            type="button"
            onClick={() => {
              setNextLockType(config.lockType);
              setNextSecret('');
              setLockMsg('');
              setChangeLockOpen(true);
            }}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Lock type</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400 capitalize">
                  {config.lockType} protection active
                </div>
              </div>
            </div>
            <span className="text-xs font-semibold" style={{ color: theme.primary }}>
              Change
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleToggleBiometric()}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <Fingerprint className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Biometrics (Fingerprint / Face)</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  {config.biometricEnabled ? 'Enabled for quick unlock' : 'Disabled'}
                </div>
              </div>
            </div>
            <div
              className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                config.biometricEnabled ? '' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              style={config.biometricEnabled ? { backgroundColor: theme.primary } : undefined}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  config.biometricEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </button>

          <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Auto-lock Secure Folder</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  Lock automatically when leaving or idle
                </div>
              </div>
            </div>
            <select
              value={config.autoLockTimeout}
              onChange={(e) => {
                const timeout = Number(e.target.value) as AutoLockTimeout;
                onUpdateConfig({ ...config, autoLockTimeout: timeout });
              }}
              aria-label="Auto-lock timer"
              className="h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value={0}>Each time I leave</option>
              <option value={60000}>After 1 minute</option>
              <option value={300000}>After 5 minutes</option>
              <option value={-1}>Manual lock only</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdateConfig({ ...config, hideNotifications: !config.hideNotifications })
            }
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <BellOff className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Notifications & data</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  Hide sensitive content from hidden apps when locked
                </div>
              </div>
            </div>
            <div
              className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                config.hideNotifications ? '' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              style={config.hideNotifications ? { backgroundColor: theme.primary } : undefined}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  config.hideNotifications ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>
      </section>

      {/* Appearance & Disguise Mode */}
      <section className="rounded-[24px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-xs font-semibold text-[#5C6575] dark:text-slate-400 tracking-wide">
            System UI & Disguise
          </h2>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">System color theme</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  {theme.name}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(Object.keys(ACCENT_THEMES) as FolderAccentColor[]).map((key) => {
                const preset = ACCENT_THEMES[key];
                const active = config.accentColor === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onUpdateConfig({ ...config, accentColor: key })}
                    aria-label={preset.name}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                      active ? 'scale-110 ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-[#12141A]' : ''
                    }`}
                    style={{ backgroundColor: preset.primary }}
                  >
                    {active && <Check className="w-4 h-4 text-white" />}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onUpdateConfig({ ...config, darkMode: !config.darkMode })}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                {config.darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-sm font-semibold">Dark mode</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  {config.darkMode ? 'Dark System UI active' : 'Light System UI (S Secure default)'}
                </div>
              </div>
            </div>
            <div
              className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                config.darkMode ? '' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              style={config.darkMode ? { backgroundColor: theme.primary } : undefined}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  config.darkMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              const nextDisguise = !config.disguiseMode;
              onUpdateConfig({
                ...config,
                disguiseMode: nextDisguise,
                disguisePreset: nextDisguise ? 'calculator' : 'secure',
              });
            }}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Calculator Disguise Mode</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  {config.lockType === 'pin'
                    ? 'Disguise lock screen as a working Calculator (enter PIN + = to unlock)'
                    : 'Masks lock screen behind Calculator (requires PIN lock type)'}
                </div>
              </div>
            </div>
            <div
              className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                config.disguiseMode ? '' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              style={config.disguiseMode ? { backgroundColor: theme.primary } : undefined}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  config.disguiseMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </button>

          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <label htmlFor="folder-name-input" className="text-sm font-semibold shrink-0">
              Folder display name
            </label>
            <input
              id="folder-name-input"
              type="text"
              maxLength={24}
              value={config.folderName}
              onChange={(e) => onUpdateConfig({ ...config, folderName: e.target.value })}
              className="w-44 sm:w-56 h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm text-right font-medium focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
            />
          </div>
        </div>
      </section>

      {/* Install on Android & Security Logs */}
      <section className="rounded-[24px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-xs font-semibold text-[#5C6575] dark:text-slate-400 tracking-wide">
            Device & Audit
          </h2>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {!isInstalled && (isInstallable || isIOS) && (
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
                >
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Install on Phone Home Screen</div>
                  <div className="text-xs text-[#5C6575] dark:text-slate-400">
                    Launch offline in standalone Android app mode
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isInstallable) void install();
                  else if (isIOS) setShowIOSGuide(true);
                }}
                className="h-10 px-4 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                style={{ backgroundColor: theme.primary }}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg, color: theme.primary }}
              >
                <History className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Security access history</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400 tabular-nums">
                  {logs.length} recorded events
                </div>
              </div>
            </div>
            <span className="text-xs font-semibold" style={{ color: theme.primary }}>
              {showLogs ? 'Hide' : 'View'}
            </span>
          </button>

          {showLogs && (
            <div className="px-5 py-3 bg-[#F4F5F7]/70 dark:bg-black/60 max-h-60 overflow-y-auto divide-y divide-slate-200/60 dark:divide-slate-800">
              {logs.length === 0 ? (
                <p className="text-xs text-[#5C6575] py-2">No security events logged yet.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span
                      className={
                        log.event === 'failed_attempt'
                          ? 'text-rose-600 dark:text-rose-400 font-medium'
                          : 'text-[#111827] dark:text-slate-200'
                      }
                    >
                      {log.detail}
                    </span>
                    <span className="font-mono text-[#5C6575] dark:text-slate-400 shrink-0">
                      {formatTimeStamp(log.timestamp)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-rose-50/60 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-rose-600">Reset & wipe Secure Folder</div>
                <div className="text-xs text-[#5C6575] dark:text-slate-400">
                  Permanently erase all encrypted files, notes, and lock keys
                </div>
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* Change Lock Type Modal */}
      {changeLockOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-[28px] bg-white dark:bg-[#12141A] p-6 border border-slate-200/80 dark:border-white/10 shadow-2xl">
            <h3 className="font-display text-lg font-bold mb-1">Change Lock Credential</h3>
            <p className="text-xs text-[#5C6575] dark:text-slate-400 mb-4">
              Your encrypted files stay intact while your lock method updates.
            </p>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#F4F5F7] dark:bg-[#1B1E26] rounded-xl mb-4">
              {(['pin', 'password', 'pattern'] as LockType[]).map((lt) => (
                <button
                  key={lt}
                  type="button"
                  onClick={() => {
                    setNextLockType(lt);
                    setNextSecret('');
                    setLockMsg('');
                  }}
                  className={`h-9 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                    nextLockType === lt
                      ? 'bg-white dark:bg-[#12141A] text-[#1B6BFF] shadow-2xs'
                      : 'text-[#5C6575] dark:text-slate-400'
                  }`}
                >
                  {lt}
                </button>
              ))}
            </div>

            {lockMsg && (
              <p className="text-xs text-rose-600 font-medium mb-3 text-center">{lockMsg}</p>
            )}

            {nextLockType === 'pattern' ? (
              <PatternPad
                onComplete={(p) => void handleSaveNewLock(p)}
                accentColor={theme.primary}
              />
            ) : (
              <div className="space-y-3">
                <input
                  type={nextLockType === 'pin' ? 'tel' : 'password'}
                  inputMode={nextLockType === 'pin' ? 'numeric' : 'text'}
                  maxLength={nextLockType === 'pin' ? 6 : 64}
                  value={nextSecret}
                  onChange={(e) => {
                    setLockMsg('');
                    const v =
                      nextLockType === 'pin'
                        ? e.target.value.replace(/\D/g, '').slice(0, 6)
                        : e.target.value;
                    setNextSecret(v);
                  }}
                  placeholder={
                    nextLockType === 'pin' ? 'New 4–6 digit PIN' : 'New password (min 4 chars)'
                  }
                  className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveNewLock()}
                  className="w-full h-11 rounded-xl text-white text-sm font-semibold cursor-pointer"
                  style={{ backgroundColor: theme.primary }}
                >
                  Update Lock
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setChangeLockOpen(false)}
              className="w-full h-10 mt-3 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Wipe Confirmation Modal */}
      {confirmWipe && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-[28px] bg-white dark:bg-[#12141A] p-6 border border-slate-200/80 dark:border-white/10 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h3 className="font-display text-lg font-bold">Erase Secure Folder?</h3>
            <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1.5 mb-5">
              All hidden files, notes, contacts, and security keys stored in this vault will be permanently deleted.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmWipe(false)}
                className="flex-1 h-11 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await wipeEntireVault();
                  setConfirmWipe(false);
                  onWipeComplete();
                }}
                className="flex-1 h-11 rounded-xl bg-rose-600 text-white text-sm font-semibold cursor-pointer"
              >
                Wipe All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS Safari Install Guide */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-[28px] bg-white dark:bg-[#12141A] p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold">Install on Home Screen</h3>
            <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-2 leading-relaxed">
              1. Tap the <strong>Share</strong> icon in your browser toolbar.
              <br />
              2. Scroll down and select <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full h-11 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
