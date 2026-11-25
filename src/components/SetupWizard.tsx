import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
  Fingerprint,
  FolderLock,
  Grid3X3,
  KeyRound,
  Lock,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { DEFAULT_VAULT_APPS } from '../data/defaultApps';
import { LockType, VaultConfig } from '../types/vault';
import {
  deriveWrappingKey,
  enrollWebAuthnBiometric,
  generateMasterKeyBytes,
  generateSalt,
  hashSecretForVerification,
  importAesKey,
  toBase64,
  wrapMasterKey,
} from '../utils/crypto';
import {
  appendSecurityLog,
  saveEncryptedNote,
  saveHiddenApps,
  saveVaultConfig,
} from '../utils/vaultDb';
import { SecureFolderLogo } from './AppIconBadge';
import { PatternPad } from './PatternPad';

interface SetupWizardProps {
  onComplete: (config: VaultConfig, masterKey: CryptoKey) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [lockType, setLockType] = useState<LockType>('pin');
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [confirmStage, setConfirmStage] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [enableBiometric, setEnableBiometric] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const handleLockTypeChange = (nextType: LockType) => {
    setLockType(nextType);
    setSecret('');
    setConfirmSecret('');
    setConfirmStage(false);
    setErrorMsg('');
  };

  const handlePinDigit = (digit: string) => {
    setErrorMsg('');
    if (!confirmStage) {
      if (secret.length < 6) setSecret((s) => s + digit);
    } else {
      if (confirmSecret.length < 6) setConfirmSecret((s) => s + digit);
    }
  };

  const handlePinBackspace = () => {
    setErrorMsg('');
    if (!confirmStage) {
      setSecret((s) => s.slice(0, -1));
    } else {
      setConfirmSecret((s) => s.slice(0, -1));
    }
  };

  const handleContinueLockStep = () => {
    setErrorMsg('');
    if (lockType === 'pin') {
      if (!confirmStage) {
        if (secret.length < 4) {
          setErrorMsg('Enter a 4 to 6 digit PIN');
          return;
        }
        setConfirmStage(true);
        return;
      }
      if (confirmSecret !== secret) {
        setErrorMsg('PINs do not match. Try again.');
        setConfirmSecret('');
        return;
      }
      setStep(3);
    } else if (lockType === 'password') {
      if (!confirmStage) {
        if (secret.length < 4) {
          setErrorMsg('Password must be at least 4 characters');
          return;
        }
        setConfirmStage(true);
        return;
      }
      if (confirmSecret !== secret) {
        setErrorMsg('Passwords do not match. Try again.');
        setConfirmSecret('');
        return;
      }
      setStep(3);
    }
  };

  const handlePatternDrawn = (pattern: string) => {
    setErrorMsg('');
    if (!confirmStage) {
      setSecret(pattern);
      setConfirmStage(true);
    } else if (pattern !== secret) {
      setErrorMsg('Patterns do not match. Draw your new pattern again.');
      setConfirmStage(false);
      setSecret('');
    } else {
      setConfirmSecret(pattern);
      setStep(3);
    }
  };

  const handleFinalizeSetup = async () => {
    setIsCreating(true);
    setErrorMsg('');
    try {
      const saltBase64 = generateSalt();
      const verifierHashBase64 = await hashSecretForVerification(secret, saltBase64);
      const wrappingKey = await deriveWrappingKey(secret, saltBase64);
      const rawMasterBytes = await generateMasterKeyBytes();
      const { wrappedBase64, ivBase64 } = await wrapMasterKey(rawMasterBytes, wrappingKey);
      const masterKey = await importAesKey(rawMasterBytes);

      let biometricEnabled = false;
      let webAuthnCredentialId: string | undefined;
      let biometricWrappedKeyBase64: string | undefined;
      let biometricWrapIvBase64: string | undefined;
      let biometricDeviceSecretBase64: string | undefined;

      if (enableBiometric) {
        const bioResult = await enrollWebAuthnBiometric();
        biometricEnabled = true;
        webAuthnCredentialId = bioResult.credentialId;
        const deviceSecretBytes = new Uint8Array(32);
        crypto.getRandomValues(deviceSecretBytes);
        biometricDeviceSecretBase64 = toBase64(deviceSecretBytes);
        const bioWrapKey = await deriveWrappingKey(biometricDeviceSecretBase64, saltBase64);
        const bioWrapped = await wrapMasterKey(rawMasterBytes, bioWrapKey);
        biometricWrappedKeyBase64 = bioWrapped.wrappedBase64;
        biometricWrapIvBase64 = bioWrapped.ivBase64;
      }

      const config: VaultConfig = {
        isInitialized: true,
        lockType,
        saltBase64,
        verifierHashBase64,
        wrappedMasterKeyBase64: wrappedBase64,
        wrapIvBase64: ivBase64,
        biometricEnabled,
        webAuthnCredentialId,
        biometricWrappedKeyBase64,
        biometricWrapIvBase64,
        biometricDeviceSecretBase64,
        autoLockTimeout: 0,
        hideNotifications: true,
        disguiseMode: false,
        disguisePreset: 'secure',
        folderName: 'Secure Folder',
        accentColor: 'cobalt',
        darkMode: true,
        failedAttempts: 0,
        lockoutUntil: null,
        createdAt: Date.now(),
      };

      saveVaultConfig(config);
      await saveHiddenApps(DEFAULT_VAULT_APPS);
      await saveEncryptedNote(
        {
          id: crypto.randomUUID(),
          title: 'Private Recovery & Vault Info',
          body: 'Your Moto Secure Folder uses AES-256-GCM local encryption. Files, photos, notes, and hidden app containers stay isolated on this device.',
          pinned: true,
          updatedAt: Date.now(),
        },
        masterKey
      );
      await appendSecurityLog('settings_changed', 'Secure Folder created and encrypted');
      onComplete(config, masterKey);
    } catch {
      setErrorMsg('Could not initialize encrypted vault. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-[#12141A] rounded-[28px] shadow-[0_12px_40px_rgba(0,0,0,0.65)] border border-white/10 overflow-hidden">
        {/* Progress Indicator */}
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <SecureFolderLogo size="sm" />
            <span className="font-display font-semibold text-sm text-white">
              Moto Secure Folder
            </span>
          </div>
          <span className="text-xs font-medium text-slate-400 tabular-nums">
            Step {step} of 3
          </span>
        </div>

        <div className="px-6 pt-2">
          <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1B6BFF] transition-all duration-300 rounded-full"
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
        </div>

        {step === 1 && (
          <div className="p-6 sm:p-7">
            <div className="flex flex-col items-center text-center mt-2 mb-6">
              <SecureFolderLogo size="lg" />
              <h1 className="font-display text-2xl font-bold text-white mt-5 tracking-tight">
                Private space on your phone
              </h1>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-xs">
                Lock sensitive files, personal photos, private notes, and cloned apps behind encrypted protection.
              </p>
            </div>

            <div className="space-y-3 mb-7">
              <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-[#1B1E26]">
                <div className="w-9 h-9 rounded-xl bg-[#13223D] text-[#4D8EFF] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">AES-256 Encrypted Storage</h2>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    Files and notes are encrypted locally with your lock credential before saving.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-[#1B1E26]">
                <div className="w-9 h-9 rounded-xl bg-[#13223D] text-[#4D8EFF] flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Isolated Apps & Disguise Mode</h2>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    Separate private apps, hide notifications, or mask the folder as a Calculator.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-[#1B1E26]">
                <div className="w-9 h-9 rounded-xl bg-[#13223D] text-[#4D8EFF] flex items-center justify-center shrink-0">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Biometric & PIN Unlock</h2>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    Supports Fingerprint / Face unlock alongside PIN, Password, or 3x3 Pattern.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full h-12 rounded-2xl bg-[#1B6BFF] hover:bg-[#1458DB] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors active:scale-[0.99] cursor-pointer"
            >
              <span>Set up Secure Folder</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="p-6 sm:p-7">
            <h1 className="font-display text-xl font-bold text-white text-center">
              {confirmStage ? `Confirm your ${lockType}` : 'Choose Secure Folder lock'}
            </h1>
            <p className="text-xs text-slate-400 text-center mt-1 mb-4">
              {confirmStage
                ? 'Re-enter your lock credential to verify'
                : 'Select how you want to unlock your private vault'}
            </p>

            {/* Lock Type Segmented Tabs */}
            {!confirmStage && (
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#1B1E26] rounded-xl mb-5">
                {(
                  [
                    { id: 'pin', label: 'PIN', icon: KeyRound },
                    { id: 'password', label: 'Password', icon: Lock },
                    { id: 'pattern', label: 'Pattern', icon: Grid3X3 },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = lockType === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleLockTypeChange(tab.id)}
                      className={`h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        active
                          ? 'bg-[#12141A] text-[#4D8EFF] shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="mb-4 px-3 py-2 rounded-xl bg-rose-950/50 text-rose-300 text-xs font-medium text-center"
              >
                {errorMsg}
              </div>
            )}

            {lockType === 'pin' && (
              <div className="flex flex-col items-center">
                <div className="flex items-center justify-center gap-3 h-10 mb-5">
                  {[0, 1, 2, 3, 4, 5].map((idx) => {
                    const currentVal = confirmStage ? confirmSecret : secret;
                    const filled = idx < currentVal.length;
                    return (
                      <span
                        key={idx}
                        className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                          filled
                            ? 'bg-[#1B6BFF] scale-110'
                            : idx < 4
                              ? 'border-2 border-slate-600 bg-transparent'
                              : 'border border-slate-700 bg-transparent opacity-50'
                        }`}
                      />
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 gap-3 w-full max-w-[264px] mb-5">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handlePinDigit(digit)}
                      className="h-14 rounded-full bg-[#1B1E26] hover:bg-[#252A36] active:bg-[#13223D] active:text-[#4D8EFF] text-xl font-semibold text-white transition-colors cursor-pointer"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmStage) {
                        setConfirmStage(false);
                        setConfirmSecret('');
                      } else {
                        setStep(1);
                      }
                    }}
                    className="h-14 rounded-full text-xs font-semibold text-slate-400 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePinDigit('0')}
                    className="h-14 rounded-full bg-[#1B1E26] hover:bg-[#252A36] active:bg-[#13223D] active:text-[#4D8EFF] text-xl font-semibold text-white transition-colors cursor-pointer"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handlePinBackspace}
                    className="h-14 rounded-full text-xs font-semibold text-slate-400 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    Delete
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleContinueLockStep}
                  disabled={(confirmStage ? confirmSecret.length : secret.length) < 4}
                  className="w-full h-12 rounded-2xl bg-[#1B6BFF] disabled:bg-[#1B1E26] disabled:text-slate-600 text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  {confirmStage ? 'Confirm PIN' : 'Continue'}
                </button>
              </div>
            )}

            {lockType === 'password' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    {confirmStage ? 'Re-enter password' : 'Enter password (min 4 characters)'}
                  </label>
                  <input
                    type="password"
                    autoFocus
                    value={confirmStage ? confirmSecret : secret}
                    onChange={(e) => {
                      setErrorMsg('');
                      if (confirmStage) setConfirmSecret(e.target.value);
                      else setSecret(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleContinueLockStep();
                    }}
                    placeholder="Enter secure password"
                    className="w-full h-12 px-4 rounded-xl bg-[#1B1E26] border border-white/10 focus:border-[#1B6BFF] focus:outline-none text-sm text-white"
                  />
                </div>
                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmStage) {
                        setConfirmStage(false);
                        setConfirmSecret('');
                      } else {
                        setStep(1);
                      }
                    }}
                    className="h-12 px-5 rounded-2xl bg-[#1B1E26] text-white text-sm font-semibold cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleContinueLockStep}
                    className="flex-1 h-12 rounded-2xl bg-[#1B6BFF] hover:bg-[#1458DB] text-white text-sm font-semibold cursor-pointer"
                  >
                    {confirmStage ? 'Confirm Password' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            {lockType === 'pattern' && (
              <div className="flex flex-col items-center">
                <PatternPad onComplete={handlePatternDrawn} error={!!errorMsg} />
                <button
                  type="button"
                  onClick={() => {
                    if (confirmStage) {
                      setConfirmStage(false);
                      setSecret('');
                    } else {
                      setStep(1);
                    }
                  }}
                  className="mt-4 text-xs font-semibold text-slate-400 hover:text-white py-2 px-4 cursor-pointer"
                >
                  {confirmStage ? 'Redraw first pattern' : 'Back'}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="p-6 sm:p-7">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-[#13223D] text-[#4D8EFF] flex items-center justify-center mb-4">
                <Fingerprint className="w-8 h-8" />
              </div>
              <h1 className="font-display text-xl font-bold text-white">
                Enable Biometric Unlock
              </h1>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-xs">
                Use your Android fingerprint sensor or face unlock for instant access to Secure Folder.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEnableBiometric((v) => !v)}
              className="w-full p-4 rounded-2xl bg-[#1B1E26] flex items-center justify-between gap-3 mb-6 text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#12141A] flex items-center justify-center text-[#4D8EFF]">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Fingerprint / Biometrics</div>
                  <div className="text-xs text-slate-400">WebAuthn & device sensor support</div>
                </div>
              </div>
              <div
                className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                  enableBiometric ? 'bg-[#1B6BFF]' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                    enableBiometric ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>

            {errorMsg && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-rose-950/50 text-rose-300 text-xs font-medium text-center">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setStep(2);
                  setConfirmStage(false);
                  setSecret('');
                  setConfirmSecret('');
                }}
                disabled={isCreating}
                className="h-12 px-5 rounded-2xl bg-[#1B1E26] text-white text-sm font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleFinalizeSetup}
                disabled={isCreating}
                className="flex-1 h-12 rounded-2xl bg-[#1B6BFF] hover:bg-[#1458DB] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isCreating ? (
                  <span>Encrypting Vault...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Create Secure Folder</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
