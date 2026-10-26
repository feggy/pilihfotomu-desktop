import type { PhotoEntry } from '../lib/api';
import { t } from '../lib/i18n';
import { useKey } from '../lib/keys';
import { Kbd } from './ui';

/**
 * Under "Mungkin terpejam": one line saying the eye call is a guess and
 * how to overrule it (the Pilih button sits right above). Gone once the
 * photo is Pilih.
 */
export function EyesNote({ photo }: { photo: PhotoEntry }) {
  const kPick = useKey('pick');
  if (photo.status === 'pick' || !photo.reasons.some((r) => r.kind === 'eyesClosed')) return null;
  return (
    <span className="text-[11px] leading-snug text-faint">
      {t('AI bisa keliru membaca mata. Ternyata terbuka?')} {t('Tekan')} <Kbd>{kPick}</Kbd> {t('untuk Pilih.')}
    </span>
  );
}
