import { useCallback, useEffect, useState } from 'react';
import { LockScreen } from './components/LockScreen';
import { SetupWizard } from './components/SetupWizard';
import { VaultDashboard } from './components/VaultDashboard';
import { VaultConfig } from './types/vault';
import { appendSecurityLog, loadVaultConfig, saveVaultConfig } from './utils/vaultDb';

export default function App() {
  const [config, setConfig] = useState<VaultConfig | null>(() => loadVaultConfig());
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);

  // Sync dark mode class on <html> (defaulting to AMOLED black)
  useEffect(() => {
    const isDark = config ? !!config.darkMode : true;
    document.documentElement.classList.toggle('dark', isDark);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', isDark ? '#000000' : '#1B6BFF');
    }
  }, [config]);

  const lockVault = useCallback(() => {
    setMasterKey((prev) => {
      if (prev) {
        void appendSecurityLog('locked', 'Secure Folder locked');
      }
      return null;
    });
  }, []);

  // Auto-lock when leaving tab/app or after inactivity
  useEffect(() => {
    if (!config || !masterKey) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && config.autoLockTimeout === 0) {
        lockVault();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    let idleTimer: number | undefined;
    const resetIdle = () => {
      if (config.autoLockTimeout <= 0) return;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        lockVault();
      }, config.autoLockTimeout);
    };

    if (config.autoLockTimeout > 0) {
      resetIdle();
      window.addEventListener('pointerdown', resetIdle);
      window.addEventListener('keydown', resetIdle);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearTimeout(idleTimer);
      window.removeEventListener('pointerdown', resetIdle);
      window.removeEventListener('keydown', resetIdle);
    };
  }, [config, masterKey, lockVault]);

  const handleUpdateConfig = (next: VaultConfig) => {
    saveVaultConfig(next);
    setConfig(next);
  };

  if (!config || !config.isInitialized) {
    return (
      <SetupWizard
        onComplete={(newConfig, key) => {
          setConfig(newConfig);
          setMasterKey(key);
        }}
      />
    );
  }

  if (!masterKey) {
    return (
      <LockScreen
        config={config}
        onUnlock={(key, updatedConfig) => {
          setConfig(updatedConfig);
          setMasterKey(key);
        }}
      />
    );
  }

  return (
    <VaultDashboard
      config={config}
      masterKey={masterKey}
      onLock={lockVault}
      onUpdateConfig={handleUpdateConfig}
      onWipeComplete={() => {
        setMasterKey(null);
        setConfig(null);
      }}
    />
  );
}
