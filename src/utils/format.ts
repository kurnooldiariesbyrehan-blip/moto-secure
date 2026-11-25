import { FolderAccentColor } from '../types/vault';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const val = bytes / Math.pow(k, i);
  return `${val >= 10 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${sizes[i]}`;
}

export function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimeStamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ACCENT_THEMES: Record<
  FolderAccentColor,
  {
    name: string;
    primary: string;
    primaryHover: string;
    gradientFrom: string;
    gradientTo: string;
    softBg: string;
    softDarkBg: string;
    textAccent: string;
  }
> = {
  cobalt: {
    name: 'Secure Cobalt',
    primary: '#1B6BFF',
    primaryHover: '#1458DB',
    gradientFrom: '#2B7BFF',
    gradientTo: '#0D47D9',
    softBg: '#EEF4FF',
    softDarkBg: '#13223D',
    textAccent: '#1B6BFF',
  },
  indigo: {
    name: 'Moto Indigo',
    primary: '#4338CA',
    primaryHover: '#3730A3',
    gradientFrom: '#5B50F0',
    gradientTo: '#312E81',
    softBg: '#EEF2FF',
    softDarkBg: '#1B1A3C',
    textAccent: '#4338CA',
  },
  emerald: {
    name: 'Vault Emerald',
    primary: '#059669',
    primaryHover: '#047857',
    gradientFrom: '#10B981',
    gradientTo: '#065F46',
    softBg: '#ECFDF5',
    softDarkBg: '#0E2922',
    textAccent: '#059669',
  },
  slate: {
    name: 'Stealth Graphite',
    primary: '#334155',
    primaryHover: '#1E293B',
    gradientFrom: '#475569',
    gradientTo: '#0F172A',
    softBg: '#F1F5F9',
    softDarkBg: '#1E293B',
    textAccent: '#334155',
  },
};
