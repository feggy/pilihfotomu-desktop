/**
 * A WhatsApp message for a booking's client: the template for the stage the
 * booking is at picked first (Follow up for Tanya-tanya, DP diterima once
 * the deposit is in…), filled in, changed if need be, then copied or opened
 * in WhatsApp (the browser's wa.me, which hands it to the app) — sent by the
 * photographer, from their number. A template with a picture (the invoice,
 * the last payment's receipt) has it ready: wa.me carries text only, so the
 * picture is copied, to paste in the chat, or saved as a file.
 */

import { save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, Copy, Download, ImageIcon, MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useBrand, useBrandLogo } from '../kreasi/brand';
import { invoicePng } from './invoice';
import { fillTemplate, waLink, waNumber } from './messages';
import { clientOf } from './model';
import { ensureInvoiceNo, ensureReceiptNo } from './numbering';
import { receiptPng } from './receipt';
import { useBisnis } from './store';
import { Dialog, Field, btnGhost, btnPrimary, inputCls } from './ui';

export function SendDialog({ bookingId, phone: phoneIn = '', name = '', template: first, onClose }: { bookingId: string | null; phone?: string; name?: string; template?: string; onClose: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const studio = useBrand((s) => s.studio);
  const logo = useBrandLogo();
  const booking = bookingId ? (data.bookings.find((b) => b.id === bookingId) ?? null) : null;
  const client = booking ? clientOf(data, booking) : null;
  // The template asked for; else the one for the booking's stage; else the first.
  const [templateId, setTemplateId] = useState(() => first ?? (booking && data.templates.find((x) => x.columnId === booking.columnId)?.id) ?? data.templates[0]?.id ?? '');
  const tpl = data.templates.find((x) => x.id === templateId);
  const fill = (id: string) => fillTemplate(data.templates.find((x) => x.id === id)?.body ?? '', data, studio, booking, name);
  const [text, setText] = useState(() => fill(templateId));
  const [phone, setPhone] = useState(client?.phone || phoneIn);
  const [copied, setCopied] = useState<'text' | 'image' | null>(null);
  const missing = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

  // The picture to go with it: the invoice, or the latest payment's receipt (numbered first, if new).
  const attach = booking ? tpl?.attach : undefined;
  const payment = useMemo(() => (booking ? [...booking.payments].sort((a, b) => a.date.localeCompare(b.date)).at(-1) : undefined), [booking]);
  useEffect(() => {
    if (!booking) return;
    if (attach === 'invoice') ensureInvoiceNo(booking.id);
    if (attach === 'kuitansi' && payment) ensureReceiptNo(booking.id, payment.id);
  }, [attach, booking?.id, payment?.id]);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    setImage(null);
    if (!booking || !attach || (attach === 'kuitansi' && !payment)) return;
    let alive = true;
    const make = attach === 'invoice' ? invoicePng({ data, booking, client, studio, logo }) : receiptPng({ data, booking, payment: payment!, client, studio, logo });
    make.then((blob) => alive && setImage({ blob, url: URL.createObjectURL(blob) }), () => {});
    return () => {
      alive = false;
    };
  }, [attach, booking, payment, client, studio, logo]);

  const flash = (what: 'text' | 'image') => (setCopied(what), window.setTimeout(() => setCopied(null), 1800));
  const copyText = async () => (await navigator.clipboard.writeText(text), flash('text'));
  const open = async () => {
    // The picture on the clipboard first, so it is one ⌘V away in the chat.
    if (image) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
        flash('image');
      } catch {
        /* the text still goes */
      }
    }
    openUrl(waLink(phone, text)).catch(() => {});
  };
  const saveImage = async () => {
    if (!image) return;
    const label = attach === 'invoice' ? booking?.invoiceNo || 'Invoice' : payment?.receiptNo || 'Kuitansi';
    const path = await save({ title: t('Simpan gambar'), defaultPath: `${label} ${client?.name ?? ''}`.trim().replace(/[\\/:*?"<>|]/g, '-') + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (path) await api.writeUserFile(path, new Uint8Array(await image.blob.arrayBuffer())).catch(() => {});
  };

  return (
    <Dialog
      title={t('Kirim pesan WhatsApp')}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button type="button" onClick={copyText} className={btnGhost}>
            {copied === 'text' ? <Check size={14} className="text-pick" /> : <Copy size={14} />} {copied === 'text' ? t('Tersalin') : t('Salin teks')}
          </button>
          <button type="button" disabled={!waNumber(phone)} onClick={open} className={btnPrimary}>
            <MessageCircle size={15} /> {image ? t('Salin gambar & buka WhatsApp') : t('Buka WhatsApp')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Template')}>
          <select value={templateId} onChange={(e) => (setTemplateId(e.target.value), setText(fill(e.target.value)))} className={inputCls}>
            {data.templates.map((x) => {
              const stage = x.columnId ? data.columns.find((c) => c.id === x.columnId)?.name : null;
              return (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {stage ? ` · ${stage}` : ''}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label={t('Nomor WhatsApp')}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" inputMode="tel" className={inputCls} />
        </Field>
      </div>
      <Field label={t('Pesan')} hint={t('Bisa diubah sebelum dikirim. Pesan terkirim dari WhatsApp kamu sendiri.')}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className={cx(inputCls, 'h-auto resize-y py-2 leading-relaxed')} />
      </Field>
      {missing.length > 0 && <p className="-mt-3 text-[11px] text-maybe">{t('Belum terisi: {list}. Lengkapi bookingnya atau ketik sendiri.', { list: missing.map((m) => `{${m}}`).join(', ') })}</p>}
      {attach && (
        <div className="flex items-start gap-3 rounded-xl border border-line-soft bg-bg p-3">
          <span className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
            {image ? <img src={image.url} alt="" className="max-h-full max-w-full" /> : <ImageIcon size={18} className="text-faint" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] font-medium">{attach === 'invoice' ? t('Gambar invoice') : t('Gambar kuitansi pembayaran terakhir')}</span>
            {attach === 'kuitansi' && !payment ? (
              <span className="text-[11px] text-maybe">{t('Belum ada pembayaran tercatat, jadi belum ada kuitansi.')}</span>
            ) : (
              <span className="text-[11px] leading-snug text-faint">
                {copied === 'image' ? t('Gambar tersalin. Di chat WhatsApp, tekan ⌘V untuk menempelkannya.') : t('Link WhatsApp hanya membawa teks: gambarnya disalin saat WhatsApp dibuka, lalu tempel di chat dengan ⌘V.')}
              </span>
            )}
            {image && (
              <button type="button" onClick={saveImage} className="mt-0.5 flex items-center gap-1 self-start text-[11px] font-medium text-gold-text hover:underline">
                <Download size={11} /> {t('Simpan gambar…')}
              </button>
            )}
          </span>
        </div>
      )}
    </Dialog>
  );
}
