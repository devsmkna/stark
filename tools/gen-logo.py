"""Ricava il marchio vettoriale dal logo originale in PNG.

    python3 tools/gen-logo.py

Perché non si ridisegna a mano con un font: il font del logo non è pubblico, e
rimetterlo con un carattere «somigliante» darebbe un marchio quasi giusto — che è
peggio di uno dichiaratamente diverso. Si vettorizza l'originale.

Il risultato usa `currentColor` per le lettere: una sola immagine per il tema chiaro
e per quello scuro, invece di due varianti da tenere allineate. La A conserva il suo
sfumato, che regge su entrambi i fondi.
"""
from PIL import Image, ImageFilter, ImageOps
import colorsys, io, re, subprocess, sys
from pathlib import Path

SRC = Path('.promptops-assets/ElevenLabs_image_gpt-image-2_voglio solo la _2026-08-24T12_52_43.png')
OUT = Path('docs/logo')
BOX = (270, 221, 1095, 340)   # il marchio dentro la tavola, senza sfondo attorno
SCALE = 2                     # si traccia in grande: i bordi vengono più netti

def masks(img):
    """Due maschere: le lettere bianche e la A, che è l'unico pezzo colorato."""
    w, h = img.size
    px = img.load()
    lettere, acca = Image.new('L', (w, h), 0), Image.new('L', (w, h), 0)
    L, A = lettere.load(), acca.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            _, lum, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if lum < 0.22:
                continue
            (A if sat > 0.42 else L)[x, y] = int(lum * 255)
    return lettere, acca

def clean(gray):
    """Sfoca e poi taglia netto: il bordo smette di essere a gradini, e potrace
    smette di rincorrere il rumore dell'antialias producendo migliaia di segmenti."""
    blurred = gray.filter(ImageFilter.GaussianBlur(1.2))
    bw = blurred.point(lambda v: 255 if v > 118 else 0).convert('1')
    # potrace traccia ciò che è NERO: la forma va invertita, o si ottiene lo sfondo.
    return ImageOps.invert(bw.convert('L')).convert('1')

def trace(mask, name):
    pbm = f'/tmp/stark-{name}.pbm'
    mask.save(pbm)
    svg_path = f'/tmp/stark-{name}.svg'
    subprocess.run(['potrace', '-s', '-a', '1.0', '-O', '1.0', '-t', '20',
                    '-o', svg_path, pbm], check=True)
    svg = io.open(svg_path, encoding='utf-8').read()
    body = re.search(r'<g transform="[^"]+"[^>]*>(.*?)</g>', svg, re.S).group(1)
    return ' '.join(re.findall(r'\bd="([^"]+)"', body))

TEMPLATE = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="STARK">
  <title>STARK</title>
  <!-- GENERATO da tools/gen-logo.py a partire dal logo originale. Non modificare a mano.
       Le lettere usano currentColor, quindi la stessa immagine sta bene sul chiaro e
       sullo scuro: non esistono due varianti da tenere allineate. -->
  <defs>
    <linearGradient id="starkA" x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0" stop-color="#6482F3"/>
      <stop offset="1" stop-color="#9A6FEF"/>
    </linearGradient>
  </defs>
  <g transform="translate(0,{h}) scale(0.1,-0.1)">
    <path fill="currentColor" d="{letters}"/>
    <path fill="url(#starkA)" d="{a}"/>
  </g>
</svg>
'''

def main():
    if not SRC.exists():
        sys.exit(f'manca il logo originale: {SRC}')
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.open(SRC).convert('RGB').crop(BOX)
    img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
    gl, ga = masks(img)
    letters, a = clean(gl), clean(ga)
    svg = TEMPLATE.format(w=img.width, h=img.height,
                          letters=trace(letters, 'letters'), a=trace(a, 'a'))
    (OUT / 'stark-wordmark.svg').write_text(svg, encoding='utf-8')
    print(f'{OUT}/stark-wordmark.svg — {len(svg)} byte')

    # Lo stesso marchio come componente, così la UI non carica un file a parte e
    # `currentColor` funziona davvero: dentro un <img> non funzionerebbe.
    comp = Path('ui/src/components/Logo.svelte')
    inner = svg.split('>', 1)[1].rsplit('</svg>', 1)[0]
    comp.write_text(
        '<!-- GENERATO da tools/gen-logo.py. Non modificare a mano. -->\n'
        '<script lang="ts">\n'
        "  let { height = 14 }: { height?: number } = $props()\n"
        '</script>\n\n'
        f'<svg viewBox="0 0 {img.width} {img.height}" height={{height}} role="img" aria-label="STARK"'
        ' style="display:block;width:auto">' + inner + '</svg>\n',
        encoding='utf-8')
    print(f'{comp} — {comp.stat().st_size} byte')

if __name__ == '__main__':
    main()
