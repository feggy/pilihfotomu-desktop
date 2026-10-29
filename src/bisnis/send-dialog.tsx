/**
 * A WhatsApp message for a booking's client: a template picked, filled in,
 * changed if need be, then copied or opened in WhatsApp (the browser's
 * wa.me, which hands it to the app) — sent by the photographer, from their number.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { useBrand } from '../kreasi/brand';
import { fillTemplate, waLink, waNumber } from './messages';
import { clientOf } from './model';
import { useBisnis } from './store';
import { Dialog, Field, btnGhost, btnPrimary, inputCls } from './ui';

export function SendDialog({ bookingId, phone: phoneIn = '', name = '', template: first, onClose }: { bookingId: string | null; phone?: string; name?: string; template?: string; onClose: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const studio = useBrand((s) => s.studio);
  const booking = bookingId ? (data.bookings.find((b) => b.id === bookingId) ?? null) : null;
  const client = booking ? clientOf(data, booking) : null;
  const [templateId, setTemplateId] = useState(first ?? data.templates[0]?.id ?? '');
  const fill = (id: string) => fillTemplate(data.templates.find((x) => x.id === id)?.body ?? '', data, studio, booking, name);
  const [text, setText] = useState(() => fill(templateId));
  const [phone, setPhone] = useState(client?.phone || phoneIn);
  const [copied, setCopied] = useState(false);
  const missing = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Dialog
      title={t('Kirim pesan WhatsApp')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={copy} className={btnGhost}>
            {copied ? <Check size={14} className="text-pick" /> : <Copy size={14} />} {copied ? t('Tersalin') : t('Salin')}
          </button>
          <button type="button" disabled={!waNumber(phone)} onClick={() => openUrl(waLink(phone, text)).catch(() => {})} className={btnPrimary}>
            <MessageCircle size={15} /> {t('Buka WhatsApp')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Template')}>
          <select value={templateId} onChange={(e) => (setTemplateId(e.target.value), setText(fill(e.target.value)))} className={inputCls}>
            {data.templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Nomor WhatsApp')}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" inputMode="tel" className={inputCls} />
        </Field>
      </div>
      <Field label={t('Pesan')} hint={t('Bisa diubah sebelum dikirim. Pesan terkirim dari WhatsApp kamu sendiri.')}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className={cx(inputCls, 'h-auto resize-y py-2 leading-relaxed')} />
      </Field>
      {missing.length > 0 && <p className="-mt-3 text-[11px] text-maybe">{t('Belum terisi: {list}. Lengkapi bookingnya atau ketik sendiri.', { list: missing.map((m) => `{${m}}`).join(', ') })}</p>}
    </Dialog>
  );
}
