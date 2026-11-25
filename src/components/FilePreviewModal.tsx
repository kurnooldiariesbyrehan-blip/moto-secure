import React, { useEffect, useState } from 'react';
import { Download, FileText, Trash2, X } from 'lucide-react';
import { VaultFileMeta } from '../types/vault';
import { formatBytes, formatTimeStamp } from '../utils/format';
import { decryptVaultFileBlob } from '../utils/vaultDb';

interface FilePreviewModalProps {
  file: VaultFileMeta;
  masterKey: CryptoKey;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  masterKey,
  onClose,
  onDelete,
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const { blob } = await decryptVaultFileBlob(file.id, masterKey);
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);

        if (
          file.mimeType.startsWith('text/') ||
          /\.(txt|md|json|csv|log)$/i.test(file.name)
        ) {
          const text = await blob.text();
          if (active) setTextContent(text.slice(0, 50000));
        }
      } catch {
        if (active) setError('Unable to decrypt this file.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file.id, file.mimeType, file.name, masterKey]);

  const handleDownload = () => {
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${file.name}`}
    >
      <div className="w-full max-w-2xl rounded-[28px] bg-white dark:bg-[#12141A] border border-slate-200/80 dark:border-white/10 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-semibold text-[#111827] dark:text-slate-100 truncate">
              {file.name}
            </h2>
            <p className="text-xs text-[#5C6575] dark:text-slate-400 font-mono">
              {formatBytes(file.size)} · {formatTimeStamp(file.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!objectUrl}
              className="h-10 px-3 rounded-xl bg-[#EEF4FF] dark:bg-[#1B1E26] text-[#1B6BFF] dark:text-[#4D8EFF] text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              title="Export decrypted file"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Unhide / Save</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(file.id)}
              className="w-10 h-10 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 flex items-center justify-center cursor-pointer"
              title="Delete permanently"
              aria-label="Delete file"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-[#5C6575] dark:text-slate-400 flex items-center justify-center cursor-pointer"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-[#F4F5F7] dark:bg-black flex items-center justify-center min-h-[260px]">
          {loading ? (
            <p className="text-sm text-[#5C6575] dark:text-slate-400">Decrypting file...</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : file.category === 'image' && objectUrl ? (
            <img
              src={objectUrl}
              alt={file.name}
              referrerPolicy="no-referrer"
              className="max-h-[65vh] max-w-full rounded-xl object-contain shadow-sm"
            />
          ) : file.category === 'video' && objectUrl ? (
            <video
              src={objectUrl}
              controls
              className="max-h-[65vh] max-w-full rounded-xl bg-black"
            />
          ) : file.category === 'audio' && objectUrl ? (
            <div className="w-full max-w-md bg-white dark:bg-[#12141A] p-6 rounded-2xl border border-slate-200/70 dark:border-white/10 text-center">
              <p className="text-sm font-semibold mb-4 truncate">{file.name}</p>
              <audio src={objectUrl} controls className="w-full" />
            </div>
          ) : textContent !== null ? (
            <pre className="w-full max-h-[60vh] overflow-auto bg-white dark:bg-[#12141A] p-4 rounded-2xl border border-slate-200/70 dark:border-white/10 text-xs font-mono text-[#111827] dark:text-slate-200 whitespace-pre-wrap break-words">
              {textContent}
            </pre>
          ) : file.mimeType === 'application/pdf' && objectUrl ? (
            <iframe
              src={objectUrl}
              title={file.name}
              className="w-full h-[60vh] rounded-xl border border-slate-200 dark:border-white/10 bg-white"
            />
          ) : (
            <div className="text-center p-6">
              <div className="w-16 h-16 rounded-2xl bg-white dark:bg-[#12141A] flex items-center justify-center mx-auto mb-3 text-[#1B6BFF]">
                <FileText className="w-8 h-8" />
              </div>
              <p className="text-sm font-semibold text-[#111827] dark:text-slate-100">
                Encrypted binary file ready
              </p>
              <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1 mb-4">
                Tap "Unhide / Save" above to export a decrypted copy to your device.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="px-4 py-2.5 rounded-xl bg-[#1B6BFF] text-white text-xs font-semibold cursor-pointer"
              >
                Download Decrypted Copy
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
