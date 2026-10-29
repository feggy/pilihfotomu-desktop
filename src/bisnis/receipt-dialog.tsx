/** Kuitansi for one payment: the page as it prints, a number given the first time, saved as a PDF and opened. */

import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { FileDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { useBrand, useBrandLogo } from '../kreasi/brand';
import { clientOf } from './model';
import { drawReceipt, nextReceiptNo, receiptPdf } from './receipt';
import { useBisnis } from './store';
import { Dialog, btnPlain, btnPrimary } from './ui';

export function ReceiptDialog({ bookingId, paymentId, onClose }: { bookingId: string; paymentId: string; onClose: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const booking = data.bookings.find((b) => b.id === bookingId);
  const payment = booking?.payments.find((p) => p.id === paymentId);
  const studio = useBrand((s) => s.studio);
  const logo = useBrandLogo();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // A number the first time, kept after: the same kuitansi printed twice says the same.
  useEffect(() => {
    if (!payment || payment.receiptNo) return;
    update((d) => {
      // Read from the data as it is now: an effect run twice (or two dialogs) must not use up two numbers.
      if (d.bookings.find((b) => b.id === bookingId)?.payments.find((p) => p.id === paymentId)?.receiptNo) return d;
      const { no, next } = nextReceiptNo(d, payment.date);
      return {
        ...d,
        settings: { ...d.settings, nextReceipt: next },
        bookings: d.bookings.map((b) => (b.id === bookingId ? { ...b, payments: b.payments.map((p) => (p.id === paymentId ? { ...p, receiptNo: no } : p)) } : b)),
      };
    });
  }, [payment?.receiptNo]);

  const client = booking ? clientOf(data, booking) : null;
  useEffect(() => {
    if (!booking || !payment || !canvas.current) return;
    document.fonts.ready.then(() => canvas.current && drawReceipt(canvas.current, { data, booking, payment, client, studio, logo }));
  }, [data, booking, payment, client, studio, logo]);
  if (!booking || !payment) return null;

  const savePdf = async () => {
    const name = `${payment.receiptNo || 'Kuitansi'} ${client?.name ?? ''}`.trim().replace(/[\\/:*?"<>|]/g, '-');
    const path = await save({ title: t('Simpan kuitansi'), defaultPath: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) return;
    setBusy(true);
    try {
      const written = await api.writeUserFile(path, await receiptPdf({ data, booking, payment, client, studio, logo }));
      setSaved(true);
      openPath(written).catch(() => {});
    } catch (e) {
      useApp.getState().fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`${t('Kuitansi')} ${payment.receiptNo ?? ''}`}
      onClose={onClose}
      width={680}
      footer={
        <>
          {saved && <span className="mr-auto text-[11px] text-pick">{t('Tersimpan dan dibuka untuk dicetak.')}</span>}
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
