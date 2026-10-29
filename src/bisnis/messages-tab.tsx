/**
 * Pesan: the studio's WhatsApp templates, written once and filled per
 * booking ({nama}, {sisa}…), and the pricelist from its packages — copied,
 * or opened in WhatsApp for whoever asked.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, Copy, MessageCircle, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { useBrand } from '../kreasi/brand';
import { VARIABLES, fillTemplate, pricelistText, waLink, waNumber } from './messages';
import { DEFAULT_TEMPLATES, newId } from './model';
import { useBisnis } from './store';
import type { MessageTemplate } from './types';
import { Field, SectionTitle, btnGhost, btnPrimary, inputCls } from './ui';
import { SaveBar, useDirty, useUnsaved } from './unsaved';

export function MessagesTab() {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const studio = useBrand((s) => s.studio);
  const [picked, setPicked] = useState(data.templates[0]?.id ?? '');
  const tpl = data.templates.find((x) => x.id === picked) ?? data.templates[0];
  const setTpl = (patch: Partial<MessageTemplate>) => tpl && update((d) => ({ ...d, templates: d.templates.map((x) => (x.id === tpl.id ? { ...x, ...patch } : x)) }));
  // Filled from the newest booking, so the preview reads like a real message.
  const sample = [...data.bookings].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

  // The template is edited as a copy, kept by Simpan perubahan; going to another one first asks.
  const [name, setName] = useState(tpl?.name ?? '');
  const [body, setBody] = useState(tpl?.body ?? '');
  const [stage, setStage] = useState(tpl?.columnId ?? '');
  const [attach, setAttach] = useState<'' | 'invoice' | 'kuitansi'>(tpl?.attach ?? '');
  const reset = () => (setName(tpl?.name ?? ''), setBody(tpl?.body ?? ''), setStage(tpl?.columnId ?? ''), setAttach(tpl?.attach ?? ''));
  useEffect(reset, [tpl?.id]);
  const dirty = !!tpl && (name !== tpl.name || body !== tpl.body || stage !== (tpl.columnId ?? '') || attach !== (tpl.attach ?? ''));
  useDirty(dirty);
  const guard = useUnsaved((s) => s.guard);
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, at)}{${key}}${body.slice(el?.selectionEnd ?? at)}`;
    setBody(next);
    requestAnimationFrame(() => el && (el.focus(), (el.selectionStart = el.selectionEnd = at + key.length + 2)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-28 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8">
        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => guard(() => update((d) => ({ ...d, templates: [...d.templates, ...DEFAULT_TEMPLATES.filter((x) => !d.templates.some((y) => y.id === x.id))] })))}
                  title={t('Kembalikan template bawaan yang terhapus')}
                  className={cx(btnGhost, 'h-8 px-3 text-xs')}
                >
                  <RotateCcw size={13} /> {t('Template bawaan')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    guard(() => {
                      const id = newId();
                      update((d) => ({ ...d, templates: [...d.templates, { id, name: t('Template baru'), body: 'Halo {nama}, ' }] }));
                      setPicked(id);
                    })
                  }
                  className={cx(btnPrimary, 'h-8 px-3 text-xs')}
                >
                  <Plus size={14} /> {t('Template')}
                </button>
              </span>
            }
          >
            {t('Template pesan WhatsApp')}
          </SectionTitle>
          <div className="grid min-h-[420px] grid-cols-[220px_1fr_1fr] gap-4">
            <nav className="flex flex-col gap-1">
              {data.templates.map((x) => (
                <button key={x.id} type="button" onClick={() => x.id !== tpl?.id && guard(() => setPicked(x.id))} className={cx('flex flex-col rounded-lg px-3 py-2 text-left text-[13px]', x.id === tpl?.id ? 'bg-raised font-semibold text-fg ring-1 ring-gold' : 'text-muted hover:bg-panel hover:text-fg')}>
                  <span className="truncate">{x.name}</span>
                  {x.columnId && (
                    <span className="flex items-center gap-1.5 truncate text-[11px] font-normal text-faint">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: data.columns.find((c) => c.id === x.columnId)?.color }} />
                      {data.columns.find((c) => c.id === x.columnId)?.name}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            {tpl ? (
              <>
                <div className="flex flex-col gap-3">
                  <div className="flex items-end gap-2">
                    <Field label={t('Nama template')} className="flex-1">
                      <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                    </Field>
                    <button type="button" onClick={() => update((d) => ({ ...d, templates: d.templates.filter((x) => x.id !== tpl.id) }))} title={t('Hapus template')} className="mb-1 rounded-lg p-2 text-faint hover:text-reject">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <Field label={t('Isi pesan')} className="flex-1">
                    <textarea ref={area} value={body} onChange={(e) => setBody(e.target.value)} className={cx(inputCls, 'h-full min-h-56 resize-none py-2 leading-relaxed')} />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    {VARIABLES.map((v) => (
                      <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v.key)} title={t(v.label)} className="rounded-md bg-panel px-1.5 py-0.5 font-mono text-[11px] text-gold-text hover:bg-raised">
                        {`{${v.key}}`}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-faint">{t('Klik isian untuk menaruhnya di posisi kursor. *teks* jadi tebal di WhatsApp.')}</span>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('Untuk tahap')} hint={t('Terpilih otomatis saat mengirim pesan ke booking di tahap ini.')}>
                      <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls}>
                        <option value="">{t('Semua tahap')}</option>
                        {data.columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t('Lampiran gambar')}>
                      <select value={attach} onChange={(e) => setAttach(e.target.value as '' | 'invoice' | 'kuitansi')} className={inputCls}>
                        <option value="">{t('Tidak ada')}</option>
                        <option value="invoice">{t('Invoice')}</option>
                        <option value="kuitansi">{t('Kuitansi pembayaran terakhir')}</option>
                      </select>
                    </Field>
                  </div>
                  {dirty && <SaveBar onSave={() => setTpl({ name: name.trim() || tpl.name, body, columnId: stage || undefined, attach: attach || undefined })} onCancel={reset} />}
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-medium text-muted">{sample ? t('Pratinjau dengan booking terakhir') : t('Pratinjau')}</span>
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-[#0b1f17] p-4">
                    <p className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#1f5c45] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-white">{fillTemplate(body, data, studio, sample)}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="col-span-2 text-xs text-faint">{t('Belum ada template.')}</p>
            )}
          </div>
        </section>
        <Pricelist />
      </div>
    </div>
  );
}

/** The pricelist from the packages: copied, or sent to a number. */
function Pricelist() {
  const data = useBisnis((s) => s.data)!;
  const text = pricelistText(data);
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t('Pricelist')}</SectionTitle>
      <p className="-mt-1 text-xs text-faint">{t('Dibuat dari tab Paket (yang tidak diarsipkan). Salin untuk dikirim ke mana saja, atau buka langsung di WhatsApp ke calon klien.')}</p>
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <pre className="max-h-80 overflow-y-auto rounded-2xl bg-panel p-4 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-fg">{text || t('Belum ada paket. Isi dulu di tab Paket.')}</pre>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={!text}
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            className={btnGhost}
          >
            {copied ? <Check size={14} className="text-pick" /> : <Copy size={14} />} {copied ? t('Tersalin') : t('Salin pricelist')}
          </button>
          <Field label={t('Kirim ke nomor')}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" inputMode="tel" className={inputCls} />
          </Field>
          <button type="button" disabled={!text || !waNumber(phone)} onClick={() => openUrl(waLink(phone, text)).catch(() => {})} className={btnPrimary}>
            <MessageCircle size={15} /> {t('Buka WhatsApp')}
          </button>
          <span className="text-[11px] text-faint">{t('Pakai template "Pricelist" untuk sapaan dan penutup: isian {pricelist} berisi daftar ini.')}</span>
        </div>
      </div>
    </section>
  );
}
