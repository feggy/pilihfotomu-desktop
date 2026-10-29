/**
 * Presets as Lightroom keeps them: saved into a group (one there already, or
 * a new one), and each preset or group renamed, moved or deleted from its
 * menu (right-click, or the ⋯ that shows on hover).
 */

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Select } from '../components/select';
import { Button, cx } from '../components/ui';
import { t } from '../lib/i18n';

const NEW = '\u0000baru';

/** Simpan sebagai preset: a name, and the group it goes in. */
export function SavePresetDialog({
  groups,
  initialGroup,
  onSave,
  onClose,
}: {
  groups: string[];
  initialGroup?: string;
  onSave: (name: string, group: string | undefined) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState(initialGroup ?? '');
  const [fresh, setFresh] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const target = group === NEW ? fresh.trim() : group;
  const ok = name.trim() && (group !== NEW || fresh.trim());
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-label={t('Simpan sebagai preset')}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(name.trim(), target || undefined);
        }}
        className="flex w-[380px] max-w-full flex-col gap-4 rounded-[18px] border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">{t('Simpan sebagai preset')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          {t('Nama preset')}
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded-[10px] border border-line bg-bg px-3 text-[13px] font-normal text-fg outline-none focus:border-gold"
          />
        </label>
        <div className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          {t('Grup')}
          <Select
            value={group}
            onChange={setGroup}
            className="font-normal"
            options={[{ value: '', label: t('Preset saya') }, ...groups.map((g) => ({ value: g, label: g })), { value: NEW, label: t('Grup baru…'), divided: true }]}
          />
        </div>
        {group === NEW && (
          <input
            type="text"
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
            placeholder={t('Nama grup baru, mis. Wedding 2026')}
            className="h-9 rounded-[10px] border border-line bg-bg px-3 text-[13px] text-fg outline-none placeholder:text-faint focus:border-gold"
          />
        )}
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="plain" onClick={onClose}>
            {t('Batal')}
          </Button>
          <Button type="submit" variant="primary" disabled={!ok}>
            {t('Simpan')}
          </Button>
        </div>
      </form>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Items shown one level in (Pindahkan ke grup ▸). */
  items?: MenuItem[];
  disabled?: boolean;
}

/** A small menu at the pointer; any click elsewhere or Escape closes it. */
export function PopMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const list = (entries: MenuItem[], depth: number) => (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="flex min-w-44 flex-col gap-0.5 rounded-xl border border-line bg-panel-2 p-1 shadow-2xl"
      style={depth ? { position: 'absolute', left: '100%', top: 0, marginLeft: 4 } : undefined}
    >
      {entries.map((it, i) => (
        <div key={i} className="relative" onMouseEnter={() => depth === 0 && setSub(it.items ? i : null)}>
          <button
            type="button"
            disabled={it.disabled}
            onClick={() => {
              if (it.items) return setSub(i);
              it.onClick();
              onClose();
            }}
            className={cx(
              'flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-left text-[13px] disabled:opacity-40',
              it.danger ? 'text-reject hover:bg-reject/10' : 'hover:bg-raised',
            )}
          >
            {it.label}
            {it.items && <span className="text-faint">›</span>}
          </button>
          {depth === 0 && sub === i && it.items && list(it.items, 1)}
        </div>
      ))}
    </div>
  );
  // On the page itself: a parent with a backdrop filter would otherwise place it.
  return createPortal(
    <div className="fixed z-50" style={{ left: Math.min(at.x, window.innerWidth - 200), top: Math.min(at.y, window.innerHeight - 220) }}>
      {list(items, 0)}
    </div>,
    document.body,
  );
}
