/**
 * Invoice: the page as it will print, a number given the first time, and
 * Simpan PDF — saved where the photographer chooses and opened, ready to
 * print or send.
 */

import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { FileDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { useBrand, useBrandLogo } from '../kreasi/brand';
import { drawInvoice, invoicePdf, nextInvoiceNo } from './invoice';
import { clientOf } from './model';
import { useBisnis } from './store';
import { Dialog, btnPlain, btnPrimary } from './ui';

export function InvoiceDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const booking = data.bookings.find((b) => b.id === bookingId);
  const studio = useBrand((s) => s.studio);
  const logo = useBrandLogo();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  // A number the first time it is made, kept after.
  useEffect(() => {
    if (!booking || booking.invoiceNo) return;
    update((d) => {
      const { no, next } = nextInvoiceNo(d);
      return { ...d, settings: { ...d.settings, nextInvoice: next }, bookings: d.bookings.map((b) => (b.id === bookingId ? { ...b, invoiceNo: no } : b)) };
    });
  }, [booking?.invoiceNo]);

  const client = booking ? clientOf(data, booking) : null;
  useEffect(() => {
    if (!booking || !canvas.current) return;
    document.fonts.ready.then(() => canvas.current && drawInvoice(canvas.current, { data, booking, client, studio, logo }));
  }, [data, booking, client, studio, logo]);
  if (!booking) return null;

  const savePdf = async () => {
    const name = `${booking.invoiceNo || 'Invoice'} ${client?.name ?? ''}`.trim().replace(/[\\/:*?"<>|]/g, '-');
    const path = await save({ title: t('Simpan invoice'), defaultPath: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) return;
    setBusy(true);
    try {
      const written = await api.writeUserFile(path, await invoicePdf({ data, booking, client, studio, logo }));
      setSaved(written);
      openPath(written).catch(() => {});
    } catch (e) {
      useApp.getState().fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`${t('Invoice')} ${booking.invoiceNo}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          {saved && <span className="mr-auto truncate text-[11px] text-pick">{t('Tersimpan dan dibuka untuk dicetak.')}</span>}
          {!studio && <span className="mr-auto text-[11px] text-faint">{t('Nama dan logo studio diambil dari Brand studio.')}</span>}
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Tutup')}
          </button>
          <button type="button" onClick={savePdf} disabled={busy} className={btnPrimary}>
            <FileDown size={15} /> {busy ? t('Menyimpan…') : t('Simpan PDF')}
          </button>
        </>
      }
    >
      <canvas ref={canvas} className="w-full rounded-md shadow-[0_8px_30px_rgb(0_0_0/0.35)]" />
    </Dialog>
  );
}
