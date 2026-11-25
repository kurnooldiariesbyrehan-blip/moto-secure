import React from 'react';
import {
  Camera,
  Cloud,
  Compass,
  FolderLock,
  Image,
  Instagram,
  KeyRound,
  Lock,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { DisguisePreset } from '../types/vault';

interface SecureFolderLogoProps {
  size?: 'sm' | 'md' | 'lg';
  gradientFrom?: string;
  gradientTo?: string;
  preset?: DisguisePreset;
}

export const SecureFolderLogo: React.FC<SecureFolderLogoProps> = ({
  size = 'md',
  gradientFrom = '#2B7BFF',
  gradientTo = '#0D47D9',
  preset = 'secure',
}) => {
  const dims =
    size === 'sm' ? 'w-10 h-10 rounded-[13px]' : size === 'lg' ? 'w-16 h-16 rounded-[20px]' : 'w-12 h-12 rounded-[16px]';
  const iconSize = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';

  if (preset === 'calculator') {
    return (
      <div
        className={`${dims} flex items-center justify-center shadow-sm text-white shrink-0`}
        style={{ background: 'linear-gradient(135deg, #334155, #0F172A)' }}
      >
        <span className="font-mono font-bold text-lg tracking-tighter">±=</span>
      </div>
    );
  }

  return (
    <div
      className={`${dims} flex items-center justify-center shadow-md shrink-0 relative`}
      style={{ background: `linear-gradient(145deg, ${gradientFrom}, ${gradientTo})` }}
    >
      <FolderLock className={`${iconSize} text-white`} strokeWidth={2.1} />
    </div>
  );
};

interface AppIconBadgeProps {
  iconKey: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  showVaultBadge?: boolean;
}

export const AppIconBadge: React.FC<AppIconBadgeProps> = ({
  iconKey,
  color,
  size = 'md',
  showVaultBadge = true,
}) => {
  const box =
    size === 'sm'
      ? 'w-11 h-11 rounded-[14px]'
      : size === 'lg'
        ? 'w-16 h-16 rounded-[20px]'
        : 'w-14 h-14 rounded-[18px]';
  const iconCls = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-8 h-8' : 'w-7 h-7';

  const renderGlyph = () => {
    switch (iconKey) {
      case 'gallery':
        return <Image className={iconCls} strokeWidth={2} />;
      case 'camera':
        return <Camera className={iconCls} strokeWidth={2} />;
      case 'browser':
        return <Compass className={iconCls} strokeWidth={2} />;
      case 'contacts':
        return <Users className={iconCls} strokeWidth={2} />;
      case 'message':
        return <MessageCircle className={iconCls} strokeWidth={2} />;
      case 'send':
        return <Send className={iconCls} strokeWidth={2} />;
      case 'shield':
        return <ShieldCheck className={iconCls} strokeWidth={2} />;
      case 'instagram':
        return <Instagram className={iconCls} strokeWidth={2} />;
      case 'wallet':
        return <Wallet className={iconCls} strokeWidth={2} />;
      case 'key':
        return <KeyRound className={iconCls} strokeWidth={2} />;
      case 'cloud':
        return <Cloud className={iconCls} strokeWidth={2} />;
      case 'mail':
        return <Mail className={iconCls} strokeWidth={2} />;
      default:
        return <Lock className={iconCls} strokeWidth={2} />;
    }
  };

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`${box} flex items-center justify-center text-white shadow-sm transition-transform duration-150`}
        style={{
          background: `linear-gradient(145deg, ${color}, ${color}DD)`,
        }}
      >
        {renderGlyph()}
      </div>
      {showVaultBadge && (
        <span
          className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#1B6BFF] border-2 border-white dark:border-[#12141A] flex items-center justify-center shadow-xs"
          aria-hidden="true"
        >
          <Lock className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
        </span>
      )}
    </div>
  );
};
