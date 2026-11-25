import React, { useEffect, useRef, useState } from 'react';
import {
  BellOff,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { HiddenApp, PrivateBookmark, PrivateContact, VaultFileMeta } from '../types/vault';
import {
  addEncryptedFile,
  decryptVaultFileBlob,
  loadSandboxData,
  saveSandboxData,
} from '../utils/vaultDb';
import { AppIconBadge } from './AppIconBadge';

interface AppSandboxModalProps {
  app: HiddenApp;
  masterKey: CryptoKey;
  files: VaultFileMeta[];
  onClose: () => void;
  onFileAdded: (meta: VaultFileMeta) => void;
  onSelectFile: (meta: VaultFileMeta) => void;
  onToggleAppNotifications: (appId: string) => void;
  onRemoveApp: (appId: string) => void;
}

export const AppSandboxModal: React.FC<AppSandboxModalProps> = ({
  app,
  masterKey,
  files,
  onClose,
  onFileAdded,
  onSelectFile,
  onToggleAppNotifications,
  onRemoveApp,
}) => {
  // Gallery thumbnails
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [captureFlash, setCaptureFlash] = useState(false);

  // Contacts state
  const [contacts, setContacts] = useState<PrivateContact[]>([]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Browser state
  const [bookmarks, setBookmarks] = useState<PrivateBookmark[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [bookmarkTitle, setBookmarkTitle] = useState('');

  // Cloned app memo
  const [appMemo, setAppMemo] = useState('');
  const [memoSaved, setMemoSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    const urlsToRevoke: string[] = [];

    if (app.sandboxType === 'gallery') {
      const mediaFiles = files.filter((f) => f.category === 'image').slice(0, 24);
      Promise.all(
        mediaFiles.map(async (f) => {
          try {
            const { blob } = await decryptVaultFileBlob(f.id, masterKey);
            const url = URL.createObjectURL(blob);
            urlsToRevoke.push(url);
            return [f.id, url] as const;
          } catch {
            return null;
          }
        })
      ).then((entries) => {
        if (!mounted) return;
        const next: Record<string, string> = {};
        for (const item of entries) {
          if (item) next[item[0]] = item[1];
        }
        setThumbs(next);
      });
    } else if (app.sandboxType === 'contacts') {
      loadSandboxData<PrivateContact[]>('private_contacts', masterKey, []).then((data) => {
        if (mounted) setContacts(data);
      });
    } else if (app.sandboxType === 'browser') {
      loadSandboxData<PrivateBookmark[]>('private_bookmarks', masterKey, [
        { id: '1', title: 'DuckDuckGo Private Search', url: 'https://duckduckgo.com', createdAt: Date.now() },
      ]).then((data) => {
        if (mounted) setBookmarks(data);
      });
    } else if (app.sandboxType === 'cloned') {
      loadSandboxData<string>(`app_memo_${app.id}`, masterKey, '').then((memo) => {
        if (mounted) setAppMemo(memo);
      });
    }

    return () => {
      mounted = false;
      for (const u of urlsToRevoke) URL.revokeObjectURL(u);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [app.id, app.sandboxType, files, masterKey]);

  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch {
      setCameraError('Camera permission unavailable in browser. Use "Import Photo to Vault" below.');
    }
  };

  const capturePhotoToVault = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setCaptureFlash(true);
    setTimeout(() => setCaptureFlash(false), 180);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
    );
    if (!blob) return;
    const fileName = `SecureCam_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    const file = new File([blob], fileName, { type: 'image/jpeg' });
    const meta = await addEncryptedFile(file, masterKey);
    onFileAdded(meta);
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactPhone.trim()) return;
    const next: PrivateContact[] = [
      {
        id: crypto.randomUUID(),
        name: contactName.trim(),
        phone: contactPhone.trim(),
        note: '',
        createdAt: Date.now(),
      },
      ...contacts,
    ];
    setContacts(next);
    setContactName('');
    setContactPhone('');
    await saveSandboxData('private_contacts', next, masterKey);
  };

  const handleDeleteContact = async (id: string) => {
    const next = contacts.filter((c) => c.id !== id);
    setContacts(next);
    await saveSandboxData('private_contacts', next, masterKey);
  };

  const handleAddBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    const normalized = /^https?:\/\//i.test(urlInput.trim())
      ? urlInput.trim()
      : `https://${urlInput.trim()}`;
    const next: PrivateBookmark[] = [
      {
        id: crypto.randomUUID(),
        title: bookmarkTitle.trim() || normalized.replace(/^https?:\/\//, ''),
        url: normalized,
        createdAt: Date.now(),
      },
      ...bookmarks,
    ];
    setBookmarks(next);
    setUrlInput('');
    setBookmarkTitle('');
    await saveSandboxData('private_bookmarks', next, masterKey);
  };

  const handleSaveMemo = async () => {
    await saveSandboxData(`app_memo_${app.id}`, appMemo, masterKey);
    setMemoSaved(true);
    setTimeout(() => setMemoSaved(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${app.name} container`}
    >
      <div className="w-full max-w-xl rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-[#12141A] border border-slate-200/80 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppIconBadge iconKey={app.iconKey} color={app.color} size="sm" />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-[#111827] dark:text-slate-100 truncate">
                {app.name}
              </h2>
              <p className="text-xs text-[#5C6575] dark:text-slate-400">
                Isolated Secure Container · {app.category}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-[#5C6575] dark:text-slate-400 flex items-center justify-center cursor-pointer"
            aria-label="Close app"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {app.sandboxType === 'gallery' && (
            <div>
              {files.filter((f) => f.category === 'image' || f.category === 'video').length === 0 ? (
                <div className="text-center py-10">
                  <ImageIcon className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold">No hidden photos or videos yet</p>
                  <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1">
                    Add media in the Files tab or capture directly with Secure Camera.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {files
                    .filter((f) => f.category === 'image' || f.category === 'video')
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelectFile(item);
                        }}
                        className="aspect-square rounded-xl overflow-hidden bg-[#F4F5F7] dark:bg-[#1B1E26] relative group cursor-pointer"
                      >
                        {thumbs[item.id] ? (
                          <img
                            src={thumbs[item.id]}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-[#5C6575] p-2 truncate">
                            {item.name}
                          </div>
                        )}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {app.sandboxType === 'camera' && (
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center">
                {cameraActive ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-6 text-slate-300">
                    <Camera className="w-10 h-10 mx-auto mb-2 opacity-75" />
                    <p className="text-sm font-medium">Encrypted Camera Viewfinder</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Photos captured here bypass your main gallery and encrypt directly into Secure Folder.
                    </p>
                  </div>
                )}
                {captureFlash && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}
              </div>

              {cameraError && (
                <p className="text-xs text-amber-600 dark:text-amber-400 text-center">{cameraError}</p>
              )}

              <div className="flex flex-wrap gap-2.5">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="flex-1 h-11 rounded-xl bg-[#1B6BFF] text-white text-sm font-semibold cursor-pointer"
                  >
                    Start Secure Camera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void capturePhotoToVault()}
                    className="flex-1 h-11 rounded-xl bg-[#1B6BFF] text-white text-sm font-semibold cursor-pointer"
                  >
                    Capture Encrypted Photo
                  </button>
                )}
                <label className="h-11 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm font-semibold flex items-center justify-center cursor-pointer">
                  <span>Import Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const meta = await addEncryptedFile(file, masterKey);
                        onFileAdded(meta);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {app.sandboxType === 'contacts' && (
            <div className="space-y-4">
              <form onSubmit={handleAddContact} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Contact name"
                  className="h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
                />
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Phone number"
                  className="h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
                />
                <button
                  type="submit"
                  className="h-11 px-4 rounded-xl bg-[#1B6BFF] text-white text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Save</span>
                </button>
              </form>

              {contacts.length === 0 ? (
                <p className="text-xs text-[#5C6575] dark:text-slate-400 text-center py-6">
                  No hidden contacts yet. Contacts saved here stay encrypted inside Secure Folder.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {contacts.map((c) => (
                    <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{c.name}</div>
                        <div className="text-xs font-mono text-[#5C6575] dark:text-slate-400">
                          {c.phone}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(c.phone);
                            setCopiedId(c.id);
                            setTimeout(() => setCopiedId(null), 1200);
                          }}
                          className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-[#5C6575] cursor-pointer"
                          aria-label="Copy phone number"
                        >
                          {copiedId === c.id ? (
                            <Check className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteContact(c.id)}
                          className="w-10 h-10 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 flex items-center justify-center cursor-pointer"
                          aria-label="Delete contact"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {app.sandboxType === 'browser' && (
            <div className="space-y-4">
              <form onSubmit={handleAddBookmark} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Add private bookmark URL (e.g. proton.me)"
                    className="flex-1 h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
                  />
                  <button
                    type="submit"
                    className="h-11 px-4 rounded-xl bg-[#1B6BFF] text-white text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Save</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={bookmarkTitle}
                  onChange={(e) => setBookmarkTitle(e.target.value)}
                  placeholder="Optional label"
                  className="w-full h-10 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-xs focus:outline-none"
                />
              </form>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {bookmarks.map((bm) => (
                  <div key={bm.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#EEF4FF] dark:bg-[#1B1E26] text-[#1B6BFF] flex items-center justify-center shrink-0">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{bm.title}</div>
                        <div className="text-xs text-[#5C6575] dark:text-slate-400 truncate">
                          {bm.url}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={bm.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-[#1B6BFF]"
                        aria-label={`Open ${bm.title}`}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = bookmarks.filter((x) => x.id !== bm.id);
                          setBookmarks(next);
                          await saveSandboxData('private_bookmarks', next, masterKey);
                        }}
                        className="w-10 h-10 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 flex items-center justify-center cursor-pointer"
                        aria-label="Delete bookmark"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {app.sandboxType === 'cloned' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#F4F5F7] dark:bg-[#1B1E26] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">Sandboxed App Profile Active</div>
                    <div className="text-xs text-[#5C6575] dark:text-slate-400">
                      App data & login sessions stay isolated inside Secure Folder.
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onToggleAppNotifications(app.id)}
                className="w-full p-4 rounded-2xl bg-[#F4F5F7] dark:bg-[#1B1E26] flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <BellOff className="w-5 h-5 text-[#1B6BFF]" />
                  <div>
                    <div className="text-sm font-semibold">Hide notification content</div>
                    <div className="text-xs text-[#5C6575] dark:text-slate-400">
                      Mask previews on lock screen & notification shade
                    </div>
                  </div>
                </div>
                <div
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    app.hideNotifications ? 'bg-[#1B6BFF]' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      app.hideNotifications ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#5C6575] dark:text-slate-400">
                    Encrypted Private Memo / Account Note
                  </label>
                  {memoSaved && (
                    <span className="text-xs font-medium text-emerald-600">Saved encrypted</span>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={appMemo}
                  onChange={(e) => setAppMemo(e.target.value)}
                  placeholder={`Store private account details or notes for ${app.name}...`}
                  className="w-full p-3.5 rounded-2xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
                />
                <div className="flex items-center justify-between gap-2 mt-3">
                  {!app.isSystemVaultApp && (
                    <button
                      type="button"
                      onClick={() => onRemoveApp(app.id)}
                      className="h-10 px-4 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      Remove from Folder
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSaveMemo()}
                    className="ml-auto h-10 px-5 rounded-xl bg-[#1B6BFF] text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Encrypted Memo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
