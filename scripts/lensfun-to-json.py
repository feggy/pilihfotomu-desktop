"""Lensfun's lens database (CC BY-SA 3.0) as the compact JSON Edit foto ›
Lens Corrections reads (public/lensfun.json): per lens its maker, names,
calibration crop factor, distortion and lateral chromatic aberration (TCA)
per focal length, and vignetting per focal length and aperture (the
farthest distance only).

usage: python3 -I scripts/lensfun-to-json.py <lensfun>/data/db public/lensfun.json
"""
import glob
import json
import os
import sys
import xml.etree.ElementTree as ET

src, dst = sys.argv[1], sys.argv[2]
lenses = []
for path in sorted(glob.glob(os.path.join(src, '*.xml'))):
    for lens in ET.parse(path).getroot().iter('lens'):
        cal = lens.find('calibration')
        if cal is None:
            continue
        dist = []
        for d in cal.findall('distortion'):
            m = d.get('model')
            f = float(d.get('focal', 0))
            if m == 'ptlens':
                dist.append([f, 'ptlens', float(d.get('a', 0)), float(d.get('b', 0)), float(d.get('c', 0))])
            elif m == 'poly3':
                dist.append([f, 'poly3', float(d.get('k1', 0)), 0, 0])
            elif m == 'poly5':
                dist.append([f, 'poly5', float(d.get('k1', 0)), float(d.get('k2', 0)), 0])
        vig = {}
        for v in cal.findall('vignetting'):
            if v.get('model') != 'pa':
                continue
            key = (float(v.get('focal', 0)), float(v.get('aperture', 0)))
            dist_m = float(v.get('distance', 1000))
            if key not in vig or dist_m > vig[key][0]:
                vig[key] = (dist_m, [key[0], key[1], float(v.get('k1', 0)), float(v.get('k2', 0)), float(v.get('k3', 0))])
        tca = []
        for t in cal.findall('tca'):
            m = t.get('model')
            f = float(t.get('focal', 0))
            g = lambda k, d=0.0: float(t.get(k, d))
            if m == 'linear':
                tca.append([f, 'linear', g('kr', 1), g('kb', 1), 0, 0, 0, 0])
            elif m == 'poly3':
                tca.append([f, 'poly3', g('vr', 1), g('vb', 1), g('cr'), g('cb'), g('br'), g('bb')])
        if not dist and not vig and not tca:
            continue
        names = [m.text.strip() for m in lens.findall('model') if m.text]
        lenses.append({
            'maker': (lens.findtext('maker') or '').strip(),
            'models': list(dict.fromkeys(names)),
            'crop': float(lens.findtext('cropfactor') or 1),
            'aspect': float(lens.findtext('aspect-ratio') or 1.5) if (lens.findtext('aspect-ratio') or '').replace('.', '', 1).isdigit() else 1.5,
            'dist': sorted(dist),
            'vig': sorted(v[1] for v in vig.values()),
            'tca': sorted(tca),
        })
with open(dst, 'w') as f:
    json.dump({'license': 'Lensfun lens database, CC BY-SA 3.0 (https://lensfun.github.io)', 'lenses': lenses}, f, separators=(',', ':'))
print(len(lenses), 'lenses', os.path.getsize(dst), 'bytes')
