import { ScrollText } from 'lucide-react';
import { useState } from 'react';

import notices from '../../THIRD-PARTY-NOTICES.txt?raw';
import { lang, t } from '../lib/i18n';
import { PRIVACY, TERMS, TERMS_DATE, TERMS_VERSION, type LegalDoc } from '../lib/legal';
import { Button, Segmented, cx } from './ui';

export type LegalTab = 'terms' | 'privacy' | 'notices';

/** One document, headings and paragraphs. */
function Doc({ doc }: { doc: LegalDoc }) {
  return (
    <article className="flex flex-col gap-4 text-[13px] leading-relaxed text-muted select-text">
      <h2 className="text-[15px] font-semibold text-fg">{doc.title}</h2>
      <p className="text-xs text-faint">{t('Berlaku sejak {date}', { date: TERMS_DATE[lang()] })}</p>
      {doc.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-semibold text-fg">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}

/**
 * Ketentuan Penggunaan, Kebijakan Privasi and the third-party notices, as
 * tabs. `fill`: inside a box of fixed height, the tabs stay put and only the
 * document scrolls.
 */
export function LegalDocs({ initial = 'terms', fill }: { initial?: LegalTab; fill?: boolean }) {
  const [tab, setTab] = useState<LegalTab>(initial);
  return (
    <div className={cx('flex flex-col gap-5', fill && 'min-h-0 flex-1')}>
      <div className="shrink-0 whitespace-nowrap">
        <Segmented<LegalTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'terms', label: t('Ketentuan') },
            { value: 'privacy', label: t('Privasi') },
            { value: 'notices', label: t('Pihak ketiga') },
          ]}
        />
      </div>
      <div key={tab} className={cx(fill && 'min-h-0 flex-1 overflow-y-auto pr-2')}>
        {tab === 'terms' && <Doc doc={TERMS[lang()]} />}
        {tab === 'privacy' && <Doc doc={PRIVACY[lang()]} />}
        {tab === 'notices' && <pre className="text-xs leading-relaxed whitespace-pre-wrap text-muted select-text">{notices}</pre>}
      </div>
    </div>
  );
}

const KEY = 'pilihfotomu.terms';

/** The terms version agreed to on this device (0 when none, or storage is unreadable). */
function agreed(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * First launch, or after the terms changed: the main points and the full
 * documents, agreed to before anything else.
 */
export function TermsGate() {
  const [ok, setOk] = useState(() => agreed() >= TERMS_VERSION);
  const [checked, setChecked] = useState(false);
  const [reading, setReading] = useState(false);
  if (ok) return null;
  const accept = () => {
    try {
      localStorage.setItem(KEY, String(TERMS_VERSION));
    } catch {
      // Asked again next launch; nothing else depends on it.
    }
    setOk(true);
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-full w-full max-w-[560px] flex-col gap-4 rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <span className="flex items-center gap-2.5 text-base font-semibold">
          <ScrollText size={18} className="text-gold-text" /> {t('Sebelum mulai')}
        </span>
        {reading ? (
          <div className="flex h-[60vh] min-h-0 flex-col">
            <LegalDocs fill />
          </div>
        ) : (
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] leading-relaxed text-muted">
            <li>{t('Penilaian AI adalah saran dan bisa keliru. Periksa kembali sebelum foto diserahkan atau dilewati: keputusan akhir ada di tangan Anda.')}</li>
            <li>{t('Semua foto diproses di perangkat ini. Tidak ada yang di-upload, dan file asli tidak pernah diubah.')}</li>
            <li>{t('Wajah dikenali hanya untuk menilai mata, fokus dan mengelompokkan orang dalam sesi. Anda bertanggung jawab atas izin klien sesuai UU Pelindungan Data Pribadi.')}</li>
            <li>{t('Tetap buat cadangan foto Anda.')}</li>
          </ul>
        )}
        <button type="button" onClick={() => setReading((v) => !v)} className="self-start text-xs font-medium text-gold-text hover:underline">
          {reading ? t('Kembali ke ringkasan') : t('Baca Ketentuan Penggunaan dan Kebijakan Privasi lengkap')}
        </button>
        <label className="flex items-start gap-2.5 text-[13px]">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 accent-[var(--color-gold)]" />
          {t('Saya sudah membaca dan menyetujui Ketentuan Penggunaan dan Kebijakan Privasi.')}
        </label>
        <Button variant="primary" disabled={!checked} onClick={accept} className="self-end">
          {t('Setuju dan lanjutkan')}
        </Button>
      </div>
    </div>
  );
}
