import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  Check,
  File as FileIcon,
  FileText,
  FolderLock,
  Image as ImageIcon,
  Lock,
  Music,
  Pin,
  Plus,
  Search,
  Settings,
  StickyNote,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { DEVICE_APP_CATALOG } from '../data/defaultApps';
import {
  FileCategory,
  HiddenApp,
  SecurityLogEntry,
  VaultConfig,
  VaultFileMeta,
  VaultNote,
} from '../types/vault';
import { ACCENT_THEMES, formatBytes, formatRelativeDate } from '../utils/format';
import {
  addEncryptedFile,
  appendSecurityLog,
  deleteVaultFile,
  deleteVaultNote,
  listDecryptedNotes,
  listHiddenApps,
  listSecurityLogs,
  listVaultFiles,
  saveEncryptedNote,
  saveHiddenApps,
} from '../utils/vaultDb';
import { AppIconBadge, SecureFolderLogo } from './AppIconBadge';
import { AppSandboxModal } from './AppSandboxModal';
import { FilePreviewModal } from './FilePreviewModal';
import { VaultSettingsView } from './VaultSettingsView';

type DashboardTab = 'apps' | 'files' | 'notes' | 'settings';

interface VaultDashboardProps {
  config: VaultConfig;
  masterKey: CryptoKey;
  onLock: () => void;
  onUpdateConfig: (next: VaultConfig) => void;
  onWipeComplete: () => void;
}

export const VaultDashboard: React.FC<VaultDashboardProps> = ({
  config,
  masterKey,
  onLock,
  onUpdateConfig,
  onWipeComplete,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('apps');
  const [apps, setApps] = useState<HiddenApp[]>([]);
  const [files, setFiles] = useState<VaultFileMeta[]>([]);
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [logs, setLogs] = useState<SecurityLogEntry[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<'all' | FileCategory>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);

  const [addAppsModalOpen, setAddAppsModalOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<HiddenApp | null>(null);
  const [previewFile, setPreviewFile] = useState<VaultFileMeta | null>(null);

  // Note editor modal
  const [editingNote, setEditingNote] = useState<VaultNote | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [notePinned, setNotePinned] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const theme = ACCENT_THEMES[config.accentColor] || ACCENT_THEMES.cobalt;

  useEffect(() => {
    let active = true;
    async function hydrate() {
      const [loadedApps, loadedFiles, loadedNotes, loadedLogs] = await Promise.all([
        listHiddenApps(),
        listVaultFiles(),
        listDecryptedNotes(masterKey),
        listSecurityLogs(),
      ]);
      if (!active) return;
      setApps(loadedApps);
      setFiles(loadedFiles);
      setNotes(loadedNotes);
      setLogs(loadedLogs);
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, [masterKey]);

  const refreshLogs = async () => {
    const next = await listSecurityLogs();
    setLogs(next);
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const items = Array.from(fileList);
    setUploadingCount(items.length);
    try {
      const added: VaultFileMeta[] = [];
      for (const file of items) {
        const meta = await addEncryptedFile(file, masterKey);
        added.push(meta);
      }
      setFiles((prev) => [...added, ...prev]);
      await appendSecurityLog(
        'file_added',
        `Encrypted ${added.length} file${added.length > 1 ? 's' : ''} into vault`
      );
      await refreshLogs();
      setActiveTab('files');
    } finally {
      setUploadingCount(0);
    }
  };

  const handleDeleteFile = async (id: string) => {
    await deleteVaultFile(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (previewFile?.id === id) setPreviewFile(null);
  };

  const handleToggleCatalogApp = async (catalogItem: (typeof DEVICE_APP_CATALOG)[number]) => {
    const exists = apps.some((a) => a.id === catalogItem.id);
    let next: HiddenApp[];
    if (exists) {
      if (catalogItem.isSystemVaultApp) return;
      next = apps.filter((a) => a.id !== catalogItem.id);
    } else {
      next = [...apps, { ...catalogItem, addedAt: Date.now() }];
    }
    setApps(next);
    await saveHiddenApps(next);
  };

  const handleToggleAppNotifications = async (appId: string) => {
    const next = apps.map((a) =>
      a.id === appId ? { ...a, hideNotifications: !a.hideNotifications } : a
    );
    setApps(next);
    if (activeApp?.id === appId) {
      setActiveApp({ ...activeApp, hideNotifications: !activeApp.hideNotifications });
    }
    await saveHiddenApps(next);
  };

  const handleRemoveApp = async (appId: string) => {
    const next = apps.filter((a) => a.id !== appId);
    setApps(next);
    setActiveApp(null);
    await saveHiddenApps(next);
  };

  const openNoteEditor = (note?: VaultNote) => {
    if (note) {
      setEditingNote(note);
      setNoteTitle(note.title);
      setNoteBody(note.body);
      setNotePinned(note.pinned);
    } else {
      setEditingNote({
        id: crypto.randomUUID(),
        title: '',
        body: '',
        pinned: false,
        updatedAt: Date.now(),
      });
      setNoteTitle('');
      setNoteBody('');
      setNotePinned(false);
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNote) return;
    const saved: VaultNote = {
      id: editingNote.id,
      title: noteTitle.trim() || 'Untitled note',
      body: noteBody,
      pinned: notePinned,
      updatedAt: Date.now(),
    };
    await saveEncryptedNote(saved, masterKey);
    setNotes((prev) => {
      const others = prev.filter((n) => n.id !== saved.id);
      return [saved, ...others].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt
      );
    });
    setEditingNote(null);
  };

  const handleDeleteNote = async (id: string) => {
    await deleteVaultNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (editingNote?.id === id) setEditingNote(null);
  };

  const totalBytes = useMemo(() => files.reduce((acc, f) => acc + f.size, 0), [files]);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
    );
  }, [apps, searchQuery]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      const matchesCat = fileFilter === 'all' || f.category === fileFilter;
      const matchesQuery = !q || f.name.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [files, fileFilter, searchQuery]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    );
  }, [notes, searchQuery]);

  const renderCategoryIcon = (cat: FileCategory) => {
    switch (cat) {
      case 'image':
        return <ImageIcon className="w-5 h-5" />;
      case 'video':
        return <Video className="w-5 h-5" />;
      case 'audio':
        return <Music className="w-5 h-5" />;
      case 'document':
        return <FileText className="w-5 h-5" />;
      default:
        return <FileIcon className="w-5 h-5" />;
    }
  };

  const navItems: { id: DashboardTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'apps', label: 'Apps', icon: AppWindow },
    { id: 'files', label: 'Files', icon: FolderLock },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div
      className={`min-h-screen flex flex-col md:flex-row transition-colors ${
        config.darkMode ? 'bg-black text-slate-100' : 'bg-[#F4F5F7] text-[#111827]'
      }`}
    >
      {/* Hidden multi-file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Desktop Left Navigation Rail */}
      <aside className="hidden md:flex md:w-64 lg:w-72 md:flex-col md:fixed md:inset-y-0 bg-white dark:bg-[#12141A] border-r border-slate-200/80 dark:border-white/10 p-5 justify-between z-30">
        <div>
          <div className="flex items-center gap-3 px-1 mb-7">
            <SecureFolderLogo
              size="sm"
              gradientFrom={theme.gradientFrom}
              gradientTo={theme.gradientTo}
              preset={config.disguiseMode ? config.disguisePreset : 'secure'}
            />
            <div className="min-w-0">
              <h1 className="font-display font-bold text-base truncate">
                {config.folderName || 'Secure Folder'}
              </h1>
              <p className="text-[11px] text-[#5C6575] dark:text-slate-400">
                Encrypted Container
              </p>
            </div>
          </div>

          <nav className="space-y-1.5" aria-label="Secure Folder sections">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full h-11 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'text-white'
                      : 'text-[#5C6575] dark:text-slate-400 hover:bg-[#F4F5F7] dark:hover:bg-[#1B1E26] hover:text-[#111827] dark:hover:text-slate-100'
                  }`}
                  style={active ? { backgroundColor: theme.primary } : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3">
          <div className="p-3.5 rounded-2xl bg-[#F4F5F7] dark:bg-[#1B1E26]/70 text-xs">
            <div className="flex items-center justify-between text-[#5C6575] dark:text-slate-400 mb-1">
              <span>Vault items</span>
              <span className="font-mono font-semibold text-[#111827] dark:text-slate-200">
                {files.length} files · {notes.length} notes
              </span>
            </div>
            <div className="flex items-center justify-between text-[#5C6575] dark:text-slate-400">
              <span>Encrypted size</span>
              <span className="font-mono font-semibold text-[#111827] dark:text-slate-200">
                {formatBytes(totalBytes)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onLock}
            className="w-full h-11 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            <span>Lock Folder</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 lg:pl-72 flex flex-col min-h-screen pb-20 md:pb-8">
        {/* Top App Bar */}
        <header className="sticky top-0 z-20 h-14 px-4 sm:px-6 bg-[#F4F5F7]/90 dark:bg-black/90 backdrop-blur-md border-b border-slate-200/60 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 md:hidden">
            <SecureFolderLogo
              size="sm"
              gradientFrom={theme.gradientFrom}
              gradientTo={theme.gradientTo}
              preset={config.disguiseMode ? config.disguisePreset : 'secure'}
            />
            <span className="font-display font-bold text-base truncate">
              {config.folderName || 'Secure Folder'}
            </span>
          </div>

          <div className="hidden md:block">
            <h2 className="font-display text-lg font-bold capitalize">
              {activeTab === 'apps'
                ? 'Hidden Apps & Containers'
                : activeTab === 'files'
                  ? 'Encrypted Files & Media'
                  : activeTab === 'notes'
                    ? 'Private Notes'
                    : 'Secure Folder Settings'}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {searchOpen ? (
              <div className="flex items-center bg-white dark:bg-[#12141A] rounded-xl border border-slate-200 dark:border-slate-700 px-2.5 h-10">
                <Search className="w-4 h-4 text-[#5C6575] mr-1.5 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search vault..."
                  className="w-28 sm:w-44 text-xs bg-transparent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchOpen(false);
                  }}
                  aria-label="Clear search"
                  className="p-1 text-[#5C6575] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Search Secure Folder"
                className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 flex items-center justify-center text-[#111827] dark:text-slate-200 cursor-pointer"
              >
                <Search className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={onLock}
              className="h-10 px-3.5 rounded-xl bg-white dark:bg-[#12141A] border border-slate-200/80 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer md:hidden"
            >
              <Lock className="w-3.5 h-3.5" style={{ color: theme.primary }} />
              <span>Lock</span>
            </button>
          </div>
        </header>

        {/* Tab Content */}
        <main className="flex-1 px-4 sm:px-6 pt-5 max-w-6xl w-full mx-auto space-y-5">
          {/* APPS TAB */}
          {activeTab === 'apps' && (
            <>
              {/* Hero Summary Bar */}
              <div className="rounded-[24px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold">
                    Protected workspace
                  </h2>
                  <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-0.5 tabular-nums">
                    {apps.length} hidden apps · {files.length} encrypted files ({formatBytes(totalBytes)}) · {notes.length} private notes
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAddAppsModalOpen(true)}
                    className="h-10 px-4 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    style={{ backgroundColor: theme.primary }}
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add apps</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Add files</span>
                  </button>
                </div>
              </div>

              {/* Hidden Apps Squircle Grid (S Secure / Moto Secure aesthetic) */}
              <section className="rounded-[28px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 p-5 sm:p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-display text-sm font-bold text-[#111827] dark:text-slate-100">
                    Apps in Secure Folder
                  </h3>
                  <span className="text-xs text-[#5C6575] dark:text-slate-400">
                    Tap an app to launch isolated container
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-y-6 gap-x-3">
                  {filteredApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => setActiveApp(app)}
                      className="flex flex-col items-center text-center group cursor-pointer focus-visible:outline-none"
                    >
                      <div className="group-hover:scale-105 group-active:scale-95 transition-transform duration-150">
                        <AppIconBadge
                          iconKey={app.iconKey}
                          color={app.color}
                          size="md"
                          showVaultBadge
                        />
                      </div>
                      <span className="mt-2.5 text-xs font-medium text-[#111827] dark:text-slate-200 max-w-[92px] truncate">
                        {app.name}
                      </span>
                      {app.badgeText && (
                        <span className="text-[10px] text-[#5C6575] dark:text-slate-400">
                          {app.badgeText}
                        </span>
                      )}
                    </button>
                  ))}

                  {/* Add App Tile */}
                  <button
                    type="button"
                    onClick={() => setAddAppsModalOpen(true)}
                    className="flex flex-col items-center text-center group cursor-pointer"
                  >
                    <div className="w-14 h-14 rounded-[18px] border-2 border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-[#5C6575] dark:text-slate-400 group-hover:border-[#1B6BFF] group-hover:text-[#1B6BFF] transition-colors">
                      <Plus className="w-6 h-6" />
                    </div>
                    <span className="mt-2.5 text-xs font-medium text-[#5C6575] dark:text-slate-400">
                      Add apps
                    </span>
                  </button>
                </div>
              </section>
            </>
          )}

          {/* FILES TAB */}
          {activeTab === 'files' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                void handleFilesSelected(e.dataTransfer.files);
              }}
              className="space-y-4"
            >
              {/* Filter Tabs & Upload Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#12141A] rounded-xl border border-slate-200/70 dark:border-white/10 overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'image', label: 'Images' },
                      { id: 'video', label: 'Videos' },
                      { id: 'document', label: 'Documents' },
                      { id: 'audio', label: 'Audio' },
                    ] as const
                  ).map((tab) => {
                    const active = fileFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFileFilter(tab.id)}
                        className={`px-3.5 h-9 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          active
                            ? 'text-white'
                            : 'text-[#5C6575] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-100'
                        }`}
                        style={active ? { backgroundColor: theme.primary } : undefined}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 px-4 rounded-xl text-white text-xs font-semibold flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                  style={{ backgroundColor: theme.primary }}
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {uploadingCount > 0 ? `Encrypting ${uploadingCount}...` : 'Move files to vault'}
                  </span>
                </button>
              </div>

              {/* Files Container */}
              <div
                className={`rounded-[24px] bg-white dark:bg-[#12141A] border transition-colors overflow-hidden ${
                  isDragging
                    ? 'border-[#1B6BFF] ring-2 ring-[#1B6BFF]/25'
                    : 'border-slate-200/70 dark:border-white/10'
                }`}
              >
                {filteredFiles.length === 0 ? (
                  <div className="py-14 px-6 text-center">
                    <div
                      className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                      style={{
                        backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg,
                        color: theme.primary,
                      }}
                    >
                      <FolderLock className="w-7 h-7" />
                    </div>
                    <h3 className="font-display text-base font-bold">
                      {files.length === 0 ? 'Your encrypted vault is empty' : 'No matching files'}
                    </h3>
                    <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1 max-w-xs mx-auto">
                      Drop sensitive photos, videos, PDFs, or documents here to encrypt them with AES-256-GCM.
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-4 h-10 px-5 rounded-xl text-white text-xs font-semibold cursor-pointer"
                      style={{ backgroundColor: theme.primary }}
                    >
                      Select files from device
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredFiles.map((file) => (
                      <div
                        key={file.id}
                        className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewFile(file)}
                          className="flex items-center gap-3.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                            style={{
                              backgroundColor: config.darkMode ? theme.softDarkBg : theme.softBg,
                              color: theme.primary,
                            }}
                          >
                            {renderCategoryIcon(file.category)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{file.name}</div>
                            <div className="text-xs text-[#5C6575] dark:text-slate-400 font-mono">
                              {formatBytes(file.size)} · {formatRelativeDate(file.createdAt)}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteFile(file.id)}
                          aria-label={`Delete ${file.name}`}
                          className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[#5C6575] hover:text-rose-600 flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* NOTES TAB */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#5C6575] dark:text-slate-400 tabular-nums">
                  {notes.length} encrypted {notes.length === 1 ? 'note' : 'notes'}
                </p>
                <button
                  type="button"
                  onClick={() => openNoteEditor()}
                  className="h-10 px-4 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  style={{ backgroundColor: theme.primary }}
                >
                  <Plus className="w-4 h-4" />
                  <span>New private note</span>
                </button>
              </div>

              {filteredNotes.length === 0 ? (
                <div className="rounded-[24px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 py-14 px-6 text-center">
                  <StickyNote className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold">No private notes</p>
                  <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1">
                    Keep PINs, recovery phrases, and personal notes encrypted inside Secure Folder.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {filteredNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => openNoteEditor(note)}
                      className="text-left p-5 rounded-[22px] bg-white dark:bg-[#12141A] border border-slate-200/70 dark:border-white/10 hover:border-[#1B6BFF]/50 transition-colors flex flex-col justify-between min-h-[148px] cursor-pointer"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <h3 className="font-display text-sm font-bold truncate">{note.title}</h3>
                          {note.pinned && (
                            <Pin className="w-3.5 h-3.5 shrink-0" style={{ color: theme.primary }} />
                          )}
                        </div>
                        <p className="text-xs text-[#5C6575] dark:text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-wrap">
                          {note.body || 'Empty note'}
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-[#5C6575] dark:text-slate-500 mt-4">
                        {formatRelativeDate(note.updatedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <VaultSettingsView
              config={config}
              masterKey={masterKey}
              logs={logs}
              onUpdateConfig={onUpdateConfig}
              onWipeComplete={onWipeComplete}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-30 h-16 md:hidden bg-white/95 dark:bg-[#12141A]/95 backdrop-blur-md border-t border-slate-200/80 dark:border-white/10 grid grid-cols-4 items-center"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className="h-full flex flex-col items-center justify-center gap-1 cursor-pointer"
              style={active ? { color: theme.primary } : undefined}
            >
              <Icon className={`w-5 h-5 ${active ? '' : 'text-[#5C6575] dark:text-slate-400'}`} />
              <span
                className={`text-[11px] font-semibold tracking-tight ${
                  active ? '' : 'text-[#5C6575] dark:text-slate-400'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Add / Manage Apps Sheet */}
      {addAppsModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add apps to Secure Folder"
        >
          <div className="w-full max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-[#12141A] border border-slate-200/80 dark:border-white/10 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold">Add or clone apps</h3>
                <p className="text-xs text-[#5C6575] dark:text-slate-400">
                  Selected apps run inside your isolated Secure Folder container
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddAppsModalOpen(false)}
                className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                aria-label="Close app picker"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
              {DEVICE_APP_CATALOG.map((item) => {
                const selected = apps.some((a) => a.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.isSystemVaultApp && selected}
                    onClick={() => void handleToggleCatalogApp(item)}
                    className="w-full py-3 px-2 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl transition-colors cursor-pointer disabled:opacity-75"
                  >
                    <div className="flex items-center gap-3.5">
                      <AppIconBadge
                        iconKey={item.iconKey}
                        color={item.color}
                        size="sm"
                        showVaultBadge={selected}
                      />
                      <div>
                        <div className="text-sm font-semibold">{item.name}</div>
                        <div className="text-xs text-[#5C6575] dark:text-slate-400">
                          {item.category}
                          {item.isSystemVaultApp ? ' · Built-in vault app' : ''}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${
                        selected
                          ? 'border-transparent text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                      style={selected ? { backgroundColor: theme.primary } : undefined}
                    >
                      {selected && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-white/10">
              <button
                type="button"
                onClick={() => setAddAppsModalOpen(false)}
                className="w-full h-11 rounded-xl text-white text-sm font-semibold cursor-pointer"
                style={{ backgroundColor: theme.primary }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note Editor Modal */}
      {editingNote && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit private note"
        >
          <form
            onSubmit={handleSaveNote}
            className="w-full max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-white dark:bg-[#12141A] border border-slate-200/80 dark:border-white/10 p-5 sm:p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold">Encrypted Note</h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setNotePinned((p) => !p)}
                  aria-label="Pin note"
                  className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer ${
                    notePinned
                      ? 'bg-[#EEF4FF] dark:bg-[#1B1E26] text-[#1B6BFF]'
                      : 'text-[#5C6575] hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Pin className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteNote(editingNote.id)}
                  aria-label="Delete note"
                  className="w-10 h-10 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  aria-label="Close note"
                  className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-[#5C6575] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Note title"
              className="w-full h-11 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] font-display font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
            />

            <textarea
              rows={7}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Write sensitive information here — encrypted with AES-256-GCM..."
              className="w-full p-4 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#1B6BFF]"
            />

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setEditingNote(null)}
                className="h-11 px-5 rounded-xl bg-[#F4F5F7] dark:bg-[#1B1E26] text-sm font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 h-11 rounded-xl text-white text-sm font-semibold cursor-pointer"
                style={{ backgroundColor: theme.primary }}
              >
                Save Encrypted Note
              </button>
            </div>
          </form>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          masterKey={masterKey}
          onClose={() => setPreviewFile(null)}
          onDelete={(id) => void handleDeleteFile(id)}
        />
      )}

      {/* Sandboxed App Modal */}
      {activeApp && (
        <AppSandboxModal
          app={activeApp}
          masterKey={masterKey}
          files={files}
          onClose={() => setActiveApp(null)}
          onFileAdded={(meta) => setFiles((prev) => [meta, ...prev])}
          onSelectFile={(meta) => setPreviewFile(meta)}
          onToggleAppNotifications={(id) => void handleToggleAppNotifications(id)}
          onRemoveApp={(id) => void handleRemoveApp(id)}
        />
      )}
    </div>
  );
};
