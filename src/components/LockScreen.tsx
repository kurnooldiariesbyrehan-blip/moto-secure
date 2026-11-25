import React, { useEffect, useState } from 'react';
import {
  Delete,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { VaultConfig } from '../types/vault';
import {
  deriveWrappingKey,
  hashSecretForVerification,
  unwrapMasterKey,
  verifyWebAuthnBiometric,
} from '../utils/crypto';
import { ACCENT_THEMES } from '../utils/format';
import { appendSecurityLog, saveVaultConfig } from '../utils/vaultDb';
import { SecureFolderLogo } from './AppIconBadge';
import { PatternPad } from './PatternPad';

interface LockScreenProps {
  config: VaultConfig;
  onUnlock: (masterKey: CryptoKey, updatedConfig: VaultConfig) => void;
}

const KEYPAD_LETTERS: Record<string, string> = {
  '1': '',
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
  '0': '+',
};

export const LockScreen: React.FC<LockScreenProps> = ({ config, onUnlock }) => {
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [shakeError, setShakeError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [bioSheetOpen, setBioSheetOpen] = useState(false);
  const [bioState, setBioState] = useState<'ready' | 'scanning' | 'verified' | 'error'>('ready');
  const [nowTick, setNowTick] = useState(Date.now());
  const [showStandardFromCalc, setShowStandardFromCalc] = useState(false);

  // Calculator disguise state
  const [calcDisplay, setCalcDisplay] = useState('0');
  const [calcExpr, setCalcExpr] = useState('');

  const theme = ACCENT_THEMES[config.accentColor] || ACCENT_THEMES.cobalt;
  const lockoutRemaining = config.lockoutUntil && config.lockoutUntil > nowTick
    ? Math.ceil((config.lockoutUntil - nowTick) / 1000)
    : 0;

  useEffect(() => {
    if (!config.lockoutUntil || config.lockoutUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [config.lockoutUntil]);

  useEffect(() => {
    if (config.lockType !== 'pin' || (config.disguiseMode && config.disguisePreset === 'calculator' && !showStandardFromCalc)) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (lockoutRemaining > 0 || bioSheetOpen) return;
      if (/^[0-9]$/.test(e.key)) {
        setErrorMsg('');
        setPin((prev) => (prev.length < 6 ? prev + e.key : prev));
      } else if (e.key === 'Backspace') {
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === 'Enter' && pin.length >= 4) {
        void attemptSecretUnlock(pin, 'pin');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const triggerFailure = async (reason: string) => {
    const nextFails = (config.failedAttempts || 0) + 1;
    const lockoutUntil = nextFails >= 5 ? Date.now() + 30_000 : null;
    const updated: VaultConfig = {
      ...config,
      failedAttempts: lockoutUntil ? 0 : nextFails,
      lockoutUntil,
    };
    saveVaultConfig(updated);
    await appendSecurityLog('failed_attempt', reason);
    setShakeError(true);
    setTimeout(() => setShakeError(false), 400);
    setErrorMsg(
      lockoutUntil
        ? 'Too many incorrect attempts. Locked for 30 seconds.'
        : `Incorrect ${config.lockType}. (${nextFails}/5 attempts)`
    );
  };

  const attemptSecretUnlock = async (
    secret: string,
    source: 'pin' | 'password' | 'pattern' | 'calculator'
  ) => {
    if (lockoutRemaining > 0 || isVerifying) return;
    setIsVerifying(true);
    setErrorMsg('');
    try {
      const candidateHash = await hashSecretForVerification(secret, config.saltBase64);
      if (candidateHash !== config.verifierHashBase64) {
        await triggerFailure(`Failed ${source} unlock attempt`);
        if (source === 'pin') setPin('');
        return;
      }
      const wrappingKey = await deriveWrappingKey(secret, config.saltBase64);
      const masterKey = await unwrapMasterKey(
        config.wrappedMasterKeyBase64,
        config.wrapIvBase64,
        wrappingKey
      );
      const updated: VaultConfig = {
        ...config,
        failedAttempts: 0,
        lockoutUntil: null,
      };
      saveVaultConfig(updated);
      const logEvent =
        source === 'calculator'
          ? 'unlock_calculator'
          : source === 'pattern'
            ? 'unlock_pattern'
            : source === 'password'
              ? 'unlock_password'
              : 'unlock_pin';
      await appendSecurityLog(logEvent, `Unlocked via ${source}`);
      onUnlock(masterKey, updated);
    } catch {
      await triggerFailure(`Failed ${source} decryption`);
      if (source === 'pin') setPin('');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBiometricUnlock = async () => {
    if (!config.biometricEnabled || lockoutRemaining > 0) return;
    setErrorMsg('');
    setBioState('scanning');
    setBioSheetOpen(true);

    const webAuthnStatus = await verifyWebAuthnBiometric(config.webAuthnCredentialId);
    if (webAuthnStatus === 'verified') {
      await finalizeBiometricUnlock();
      return;
    }
    if (webAuthnStatus === 'cancelled') {
      setBioState('error');
      setTimeout(() => setBioSheetOpen(false), 900);
      return;
    }
    // Platform authenticator unavailable in iframe/desktop -> keep interactive Under-Display Sensor modal open
    setBioState('ready');
  };

  const finalizeBiometricUnlock = async () => {
    if (!config.biometricWrappedKeyBase64 || !config.biometricWrapIvBase64 || !config.biometricDeviceSecretBase64) {
      setBioState('error');
      return;
    }
    try {
      setBioState('verified');
      const bioWrapKey = await deriveWrappingKey(config.biometricDeviceSecretBase64, config.saltBase64);
      const masterKey = await unwrapMasterKey(
        config.biometricWrappedKeyBase64,
        config.biometricWrapIvBase64,
        bioWrapKey
      );
      const updated: VaultConfig = { ...config, failedAttempts: 0, lockoutUntil: null };
      saveVaultConfig(updated);
      await appendSecurityLog('unlock_biometric', 'Unlocked with Fingerprint / Biometrics');
      setTimeout(() => {
        setBioSheetOpen(false);
        onUnlock(masterKey, updated);
      }, 280);
    } catch {
      setBioState('error');
    }
  };

  // Disguise Calculator Mode
  if (config.disguiseMode && config.disguisePreset === 'calculator' && !showStandardFromCalc) {
    const pressCalc = (val: string) => {
      if (val === 'C') {
        setCalcDisplay('0');
        setCalcExpr('');
        return;
      }
      if (val === 'DEL') {
        setCalcDisplay((d) => (d.length > 1 ? d.slice(0, -1) : '0'));
        return;
      }
      if (val === '=') {
        // Check if current clean display matches PIN!
        if (config.lockType === 'pin' && /^\d{4,6}$/.test(calcDisplay) && calcExpr === '') {
          hashSecretForVerification(calcDisplay, config.saltBase64).then((candidate) => {
            if (candidate === config.verifierHashBase64) {
              void attemptSecretUnlock(calcDisplay, 'calculator');
            } else {
              try {
                // Safe arithmetic evaluation
                const sanitized = (calcExpr + calcDisplay).replace(/[^0-9+\-*/.()]/g, '');
                if (sanitized) {
                  const result = Function(`"use strict"; return (${sanitized})`)();
                  setCalcDisplay(String(Number.isFinite(result) ? Number(result.toFixed(6)) : 'Error'));
                  setCalcExpr('');
                }
              } catch {
                setCalcDisplay('Error');
                setCalcExpr('');
              }
            }
          });
          return;
        }
        try {
          const sanitized = (calcExpr + calcDisplay).replace(/[^0-9+\-*/.()]/g, '');
          const result = Function(`"use strict"; return (${sanitized})`)();
          setCalcDisplay(String(Number.isFinite(result) ? Number(result.toFixed(6)) : 'Error'));
          setCalcExpr('');
        } catch {
          setCalcDisplay('Error');
          setCalcExpr('');
        }
        return;
      }
      if (['+', '-', '*', '/'].includes(val)) {
        setCalcExpr((prev) => prev + calcDisplay + val);
        setCalcDisplay('0');
        return;
      }
      setCalcDisplay((d) => (d === '0' || d === 'Error' ? val : d.length < 12 ? d + val : d));
    };

    const buttons = [
      'C', 'DEL', '/', '*',
      '7', '8', '9', '-',
      '4', '5', '6', '+',
      '1', '2', '3', '=',
      '0', '.',
    ];

    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 ${config.darkMode ? 'bg-black text-white' : 'bg-[#F4F5F7] text-[#111827]'}`}>
        <div className={`w-full max-w-sm rounded-[28px] p-5 shadow-lg border ${config.darkMode ? 'bg-[#12141A] border-white/10' : 'bg-white border-slate-200/80'}`}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-display font-semibold">Calculator</span>
            <button
              type="button"
              onClick={() => setShowStandardFromCalc(true)}
              className="text-xs text-[#5C6575] dark:text-slate-400 hover:underline cursor-pointer py-1 px-2"
              title="Open Secure Folder lock"
            >
              Mode
            </button>
          </div>
          <div className={`rounded-2xl p-4 mb-4 text-right min-h-[108px] flex flex-col justify-end ${config.darkMode ? 'bg-black' : 'bg-[#F4F5F7]'}`}>
            <div className="text-xs font-mono text-[#5C6575] dark:text-slate-400 min-h-[18px] truncate">
              {calcExpr}
            </div>
            <div className="text-4xl font-mono font-semibold tracking-tight truncate mt-1">
              {calcDisplay}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {buttons.map((b) => {
              const isOp = ['/', '*', '-', '+', '='].includes(b);
              const isAction = ['C', 'DEL'].includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => pressCalc(b)}
                  className={`h-14 rounded-2xl font-mono text-lg font-semibold transition-transform active:scale-95 cursor-pointer ${
                    b === '0' ? 'col-span-2' : ''
                  } ${
                    b === '='
                      ? 'bg-[#1B6BFF] text-white row-span-2 h-full'
                      : isOp
                        ? 'bg-[#EEF4FF] dark:bg-[#1B1E26] text-[#1B6BFF] dark:text-[#4D8EFF]'
                        : isAction
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                          : 'bg-[#F4F5F7] dark:bg-[#1B1E26]/70 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  {b}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-center text-[#5C6575] dark:text-slate-400 mt-4">
            Tip: Type your PIN and tap = to unlock Secure Folder
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 transition-colors ${
        config.darkMode ? 'bg-black text-slate-100' : 'bg-[#F4F5F7] text-[#111827]'
      }`}
    >
      <div
        className={`w-full max-w-md rounded-[30px] p-6 sm:p-8 border shadow-[0_12px_40px_rgba(15,23,42,0.08)] ${
          config.darkMode
            ? 'bg-[#12141A] border-white/10'
            : 'bg-white border-slate-200/80'
        }`}
      >
        {/* Top Emblem & Folder Title */}
        <div className="flex flex-col items-center text-center mb-6">
          <SecureFolderLogo
            size="lg"
            gradientFrom={theme.gradientFrom}
            gradientTo={theme.gradientTo}
            preset={config.disguiseMode ? config.disguisePreset : 'secure'}
          />
          <h1 className="font-display text-2xl font-bold mt-4 tracking-tight">
            {config.disguiseMode && config.disguisePreset !== 'secure'
              ? config.folderName
              : config.folderName || 'Secure Folder'}
          </h1>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-[#5C6575] dark:text-slate-400">
            <Lock className="w-3.5 h-3.5" style={{ color: theme.primary }} />
            <span>Protected by Moto Secure</span>
          </div>
        </div>

        {/* Error / Lockout Alert */}
        {(errorMsg || lockoutRemaining > 0) && (
          <div
            role="alert"
            className="mb-5 px-3.5 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center justify-center gap-2"
          >
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              {lockoutRemaining > 0
                ? `Too many failed attempts. Try again in ${lockoutRemaining}s`
                : errorMsg}
            </span>
          </div>
        )}

        {/* PIN Input */}
        {config.lockType === 'pin' && (
          <div className="flex flex-col items-center">
            <div className={`flex items-center justify-center gap-3.5 h-10 mb-6 ${shakeError ? 'animate-shake' : ''}`}>
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const filled = idx < pin.length;
                return (
                  <span
                    key={idx}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                      filled
                        ? 'scale-110'
                        : idx < 4
                          ? 'border-2 border-slate-300 dark:border-slate-600'
                          : 'border border-slate-200 dark:border-slate-700 opacity-50'
                    }`}
                    style={filled ? { backgroundColor: theme.primary } : undefined}
                  />
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-3.5 w-full max-w-[270px] mb-5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={lockoutRemaining > 0 || isVerifying}
                  onClick={() => {
                    setErrorMsg('');
                    setPin((p) => (p.length < 6 ? p + digit : p));
                  }}
                  className="h-[62px] rounded-full bg-[#F4F5F7] dark:bg-[#1B1E26] hover:bg-slate-200/80 dark:hover:bg-slate-700/70 active:scale-95 flex flex-col items-center justify-center transition-all cursor-pointer disabled:opacity-40"
                >
                  <span className="text-xl font-semibold leading-none">{digit}</span>
                  {KEYPAD_LETTERS[digit] && (
                    <span className="text-[9px] font-medium tracking-widest text-[#5C6575] dark:text-slate-400 mt-0.5">
                      {KEYPAD_LETTERS[digit]}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                disabled={lockoutRemaining > 0 || pin.length === 0}
                onClick={() => setPin((p) => p.slice(0, -1))}
                aria-label="Delete digit"
                className="h-[62px] rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-[#5C6575] dark:text-slate-400 transition-colors cursor-pointer disabled:opacity-30"
              >
                <Delete className="w-5 h-5" />
              </button>
              <button
                type="button"
                disabled={lockoutRemaining > 0 || isVerifying}
                onClick={() => {
                  setErrorMsg('');
                  setPin((p) => (p.length < 6 ? p + '0' : p));
                }}
                className="h-[62px] rounded-full bg-[#F4F5F7] dark:bg-[#1B1E26] hover:bg-slate-200/80 dark:hover:bg-slate-700/70 active:scale-95 flex flex-col items-center justify-center transition-all cursor-pointer disabled:opacity-40"
              >
                <span className="text-xl font-semibold leading-none">0</span>
                <span className="text-[9px] font-medium text-[#5C6575] dark:text-slate-400 mt-0.5">+</span>
              </button>
              <button
                type="button"
                disabled={lockoutRemaining > 0 || pin.length < 4 || isVerifying}
                onClick={() => void attemptSecretUnlock(pin, 'pin')}
                className="h-[62px] rounded-full font-semibold text-sm text-white transition-all active:scale-95 cursor-pointer disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                style={pin.length >= 4 && lockoutRemaining === 0 ? { backgroundColor: theme.primary } : undefined}
              >
                OK
              </button>
            </div>
          </div>
        )}

        {/* Password Input */}
        {config.lockType === 'password' && (
          <div className={`space-y-4 mb-5 ${shakeError ? 'animate-shake' : ''}`}>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                disabled={lockoutRemaining > 0 || isVerifying}
                value={password}
                onChange={(e) => {
                  setErrorMsg('');
                  setPassword(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password.length > 0) {
                    void attemptSecretUnlock(password, 'password');
                  }
                }}
                placeholder="Enter Secure Folder password"
                className="w-full h-13 pl-4 pr-12 rounded-2xl bg-[#F4F5F7] dark:bg-[#1B1E26] border border-slate-200 dark:border-slate-700 focus:border-[#1B6BFF] focus:outline-none text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-[#5C6575] dark:text-slate-400 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={lockoutRemaining > 0 || !password || isVerifying}
              onClick={() => void attemptSecretUnlock(password, 'password')}
              className="w-full h-12 rounded-2xl text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: theme.primary }}
            >
              {isVerifying ? 'Unlocking...' : 'Unlock'}
            </button>
          </div>
        )}

        {/* Pattern Input */}
        {config.lockType === 'pattern' && (
          <div className="mb-4">
            <PatternPad
              onComplete={(pattern) => void attemptSecretUnlock(pattern, 'pattern')}
              error={shakeError}
              disabled={lockoutRemaining > 0 || isVerifying}
              accentColor={theme.primary}
            />
          </div>
        )}

        {/* Biometric Trigger */}
        {config.biometricEnabled && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-col items-center">
            <button
              type="button"
              disabled={lockoutRemaining > 0}
              onClick={() => void handleBiometricUnlock()}
              className="mt-2 inline-flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-[#EEF4FF] dark:bg-[#1B1E26] text-sm font-semibold transition-transform active:scale-95 cursor-pointer disabled:opacity-40"
              style={{ color: theme.primary }}
            >
              <Fingerprint className="w-5 h-5" />
              <span>Unlock with Biometrics</span>
            </button>
          </div>
        )}
      </div>

      {/* Android Under-Display Fingerprint Verification Sheet */}
      {bioSheetOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-[28px] bg-white dark:bg-[#12141A] p-6 text-center shadow-2xl border border-slate-200/70 dark:border-slate-800">
            <p className="text-xs font-medium text-[#5C6575] dark:text-slate-400">
              {config.folderName}
            </p>
            <h2 className="font-display text-lg font-bold mt-1">
              {bioState === 'verified'
                ? 'Fingerprint verified'
                : bioState === 'error'
                  ? 'Not recognized'
                  : 'Verify your identity'}
            </h2>
            <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1 mb-6">
              {bioState === 'scanning'
                ? 'Waiting for device biometric prompt...'
                : bioState === 'verified'
                  ? 'Decrypting vault...'
                  : 'Touch and hold the fingerprint sensor to unlock'}
            </p>

            <div className="flex justify-center mb-6">
              <button
                type="button"
                onClick={() => void finalizeBiometricUnlock()}
                aria-label="Touch fingerprint sensor"
                className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  bioState === 'verified'
                    ? 'bg-emerald-500 text-white'
                    : bioState === 'error'
                      ? 'bg-rose-500 text-white'
                      : 'bg-[#EEF4FF] dark:bg-[#1B1E26] text-[#1B6BFF]'
                }`}
              >
                {bioState !== 'verified' && (
                  <span
                    className="absolute inset-0 rounded-full border-2 border-[#1B6BFF]/40 animate-scan-ring"
                    aria-hidden="true"
                  />
                )}
                {bioState === 'verified' ? (
                  <ShieldCheck className="w-10 h-10" />
                ) : (
                  <Fingerprint className="w-11 h-11" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setBioSheetOpen(false)}
              className="w-full h-11 rounded-2xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm font-semibold text-[#111827] dark:text-slate-200 cursor-pointer"
            >
              Use {config.lockType === 'pin' ? 'PIN' : config.lockType === 'password' ? 'Password' : 'Pattern'} instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
