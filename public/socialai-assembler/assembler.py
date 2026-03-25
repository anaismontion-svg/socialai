# assembler.py — Microservice Flask de génération de visuels Instagram
# Formats : single, story, carousel, citation

from flask import Flask, request, jsonify
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import numpy as np
import requests
import os
import textwrap
from io import BytesIO
from supabase import create_client

app = Flask(__name__)

SUPABASE_URL  = os.environ.get('SUPABASE_URL')
SUPABASE_KEY  = os.environ.get('SUPABASE_SERVICE_KEY')
FONT_BASE     = '/app/fonts/'
DEFAULT_FONTS = {
    'Lora-Italic':    'Lora-Italic-Variable.ttf',
    'Lora-Regular':   'Lora-Variable.ttf',
    'Poppins-Light':  'Poppins-Light.ttf',
    'Poppins-Regular':'Poppins-Regular.ttf',
    'Poppins-Medium': 'Poppins-Medium.ttf',
}

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ─────────────────────────────────────────────────────────────────────────────
# UTILITAIRES
# ─────────────────────────────────────────────────────────────────────────────

def hex_to_rgb(hex_color):
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def get_font(font_name, size):
    filename = DEFAULT_FONTS.get(font_name, 'Poppins-Light.ttf')
    path = os.path.join(FONT_BASE, filename)
    try:
        return ImageFont.truetype(path, size)
    except:
        return ImageFont.load_default()

def download_image(url):
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return Image.open(BytesIO(r.content)).convert('RGB')

def load_logo(url, width, style='thick'):
    r    = requests.get(url, timeout=15)
    logo = Image.open(BytesIO(r.content)).convert('RGBA')
    arr  = np.array(logo)
    rc, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    arr[:,:,3] = np.where((rc < 80) & (g < 80) & (b < 80), 0, arr[:,:,3])
    arr[:,:,0] = np.where(arr[:,:,3]>10, 255, 0)
    arr[:,:,1] = np.where(arr[:,:,3]>10, 255, 0)
    arr[:,:,2] = np.where(arr[:,:,3]>10, 255, 0)
    logo  = Image.fromarray(arr, 'RGBA')
    dilate = {'thick': 6, 'normal': 3, 'thin': 1}.get(style, 3)
    alpha  = logo.split()[3]
    for _ in range(dilate):
        alpha = alpha.filter(ImageFilter.MaxFilter(3))
    logo.putalpha(alpha)
    arr2 = np.array(logo)
    arr2[:,:,0] = np.where(arr2[:,:,3]>10, 255, 0)
    arr2[:,:,1] = np.where(arr2[:,:,3]>10, 255, 0)
    arr2[:,:,2] = np.where(arr2[:,:,3]>10, 255, 0)
    logo = Image.fromarray(arr2, 'RGBA')
    lw, lh = logo.size
    return logo.resize((width, int(lh * width / lw)), Image.LANCZOS)

def load_logo_dark(url, width, style='thick', color=(60, 25, 35)):
    logo = load_logo(url, width, style)
    arr  = np.array(logo)
    arr[:,:,0] = np.where(arr[:,:,3]>10, color[0], 0)
    arr[:,:,1] = np.where(arr[:,:,3]>10, color[1], 0)
    arr[:,:,2] = np.where(arr[:,:,3]>10, color[2], 0)
    return Image.fromarray(arr, 'RGBA')

def smart_crop(img, target_w, target_h):
    pw, ph    = img.size
    tgt_ratio = target_w / target_h
    src_ratio = pw / ph
    if src_ratio > tgt_ratio:
        new_w = int(ph * tgt_ratio)
        left  = (pw - new_w) // 2
        img   = img.crop((left, 0, left + new_w, ph))
    else:
        new_h = int(pw / tgt_ratio)
        top   = 0 if ph > pw else (ph - new_h) // 2
        top   = min(top, ph - new_h)
        img   = img.crop((0, top, pw, top + new_h))
    return img.resize((target_w, target_h), Image.LANCZOS)

def add_gradient(img, start_pct, max_alpha, color=(10,10,10)):
    W, H = img.size
    ov   = Image.new('RGBA', (W, H), (0,0,0,0))
    d    = ImageDraw.Draw(ov)
    for y in range(int(H * start_pct), H):
        a = int(max_alpha * (y - H * start_pct) / (H * (1 - start_pct)))
        d.line([(0,y),(W,y)], fill=(*color, a))
    return Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')

def add_gradient_top(img, end_pct, max_alpha, color):
    W, H      = img.size
    ov        = Image.new('RGBA', (W, H), (0,0,0,0))
    d         = ImageDraw.Draw(ov)
    fade_zone = int(H * end_pct)
    for y in range(fade_zone):
        a = int(max_alpha * (1 - y / fade_zone) ** 2.2)
        d.line([(0,y),(W,y)], fill=(*color, a))
    return Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')

def paste_layer(canvas, layer, x, y):
    c = canvas.convert('RGBA')
    c.paste(layer, (x, y), layer)
    return c.convert('RGB')

def draw_wrapped_text(draw, text, font, max_width, x, y, fill, line_spacing=1.4):
    words    = text.split()
    lines    = []
    current  = ''
    for word in words:
        test = f"{current} {word}".strip()
        bbox = draw.textbbox((0,0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    _, _, _, h = draw.textbbox((0,0), 'A', font=font)
    line_h = int(h * line_spacing)
    for i, line in enumerate(lines):
        draw.text((x, y + i * line_h), line, font=font, fill=fill)
    return y + len(lines) * line_h

def upload_to_supabase(img, filename, client_id):
    buf = BytesIO()
    img.save(buf, format='JPEG', quality=95)
    buf.seek(0)
    path = f"{client_id}/generated/{filename}"
    supabase.storage.from_('media').upload(
        path, buf.read(),
        file_options={"content-type": "image/jpeg", "upsert": "true"}
    )
    return supabase.storage.from_('media').get_public_url(path)

# ─────────────────────────────────────────────────────────────────────────────
# FORMAT 1 — SINGLE POST 1080×1080
# ─────────────────────────────────────────────────────────────────────────────
def generate_single(photo_url, logo_url, branding, titre, caption):
    W, H    = 1080, 1080
    palette = branding['palette']
    primary = hex_to_rgb(palette['primary'])
    light   = hex_to_rgb(palette.get('text_light', '#ffffff'))
    taupe   = hex_to_rgb(palette.get('secondary', '#c4aecf'))

    photo  = download_image(photo_url)
    photo  = ImageEnhance.Color(photo).enhance(0.88)
    canvas = smart_crop(photo, W, H)
    canvas = add_gradient(canvas, 0.46, 215)
    draw   = ImageDraw.Draw(canvas)

    if branding.get('frame_border', True):
        draw.rectangle([(18,18),(W-18,H-18)], outline=primary, width=1)

    logo_pos = branding.get('logo_position', 'bottom-right')
    logo     = load_logo(logo_url, 185, branding.get('logo_style','thick'))
    positions = {
        'bottom-right': (W - logo.width - 40, H - logo.height - 40),
        'bottom-left':  (40, H - logo.height - 40),
        'top-right':    (W - logo.width - 40, 40),
        'top-left':     (36, 32),
    }
    lx, ly = positions.get(logo_pos, positions['bottom-right'])
    canvas = paste_layer(canvas, logo, lx, ly)
    draw   = ImageDraw.Draw(canvas)

    ft = get_font(branding['fonts']['titre'], 56)
    fc = get_font(branding['fonts']['corps'], 29)

    caption2_y = H - 82
    caption1_y = caption2_y - 46
    sep_y      = caption1_y - 28
    titre_y    = sep_y - 72

    draw.text((56, titre_y), titre, font=ft, fill=primary)
    draw.line([(56, sep_y),(200, sep_y)], fill=primary, width=1)
    draw_wrapped_text(draw, caption, fc, W - 120, 56, caption1_y, light)
    return canvas

# ─────────────────────────────────────────────────────────────────────────────
# FORMAT 2 — STORY 1080×1920
# ─────────────────────────────────────────────────────────────────────────────
def generate_story(photo_url, logo_url, branding, titre, caption, tagline):
    W, H    = 1080, 1920
    palette = branding['palette']
    primary = hex_to_rgb(palette['primary'])
    light   = hex_to_rgb(palette.get('text_light', '#ffffff'))
    muted   = tuple(min(255, c + 30) for c in light)

    photo  = download_image(photo_url)
    canvas = smart_crop(photo, W, H)

    if branding.get('gradient_top', True):
        canvas = add_gradient_top(canvas, 0.38, 115, primary)
    canvas = add_gradient(canvas, 0.56, 220)

    logo = load_logo(logo_url, 320, branding.get('logo_style','thick'))
    canvas = paste_layer(canvas, logo, 36, 32)

    draw = ImageDraw.Draw(canvas)
    ft   = get_font(branding['fonts']['titre'], 66)
    fc   = get_font(branding['fonts']['corps'], 34)
    fg   = get_font(branding['fonts']['corps'], 27)

    draw.line([(80, H-372),(260, H-372)], fill=(255,255,255), width=1)
    draw.text((80, H-354), titre, font=ft, fill=primary)
    y = draw_wrapped_text(draw, caption, fc, W - 160, 80, H-272, light)
    draw.text((80, y + 20), tagline, font=fg, fill=muted)
    return canvas

# ─────────────────────────────────────────────────────────────────────────────
# FORMAT 3 — CAROUSEL SLIDE 1080×1080
# ─────────────────────────────────────────────────────────────────────────────
def generate_carousel_slide(photo_url, logo_url, branding, titre, caption,
                             slide_num, total_slides):
    W, H    = 1080, 1080
    palette = branding['palette']
    primary = hex_to_rgb(palette['primary'])
    light   = hex_to_rgb(palette.get('text_light', '#ffffff'))
    taupe   = hex_to_rgb(palette.get('secondary', '#c4aecf'))

    photo  = download_image(photo_url)
    photo  = ImageEnhance.Color(photo).enhance(0.88)
    canvas = smart_crop(photo, W, H)
    canvas = add_gradient(canvas, 0.48, 205)
    draw   = ImageDraw.Draw(canvas)

    if branding.get('frame_border', True):
        draw.rectangle([(18,18),(W-18,H-18)], outline=primary, width=1)

    fn = get_font(branding['fonts']['corps'], 22)
    draw.rounded_rectangle([(36,36),(130,70)], radius=14, fill=(13,13,13,170))
    draw.text((83, 53), f"{slide_num} / {total_slides}",
              font=fn, fill=primary, anchor='mm')

    logo   = load_logo(logo_url, 185, branding.get('logo_style','thick'))
    canvas = paste_layer(canvas, logo, W - logo.width - 40, H - logo.height - 40)
    draw   = ImageDraw.Draw(canvas)

    ft = get_font(branding['fonts']['titre'], 52)
    fc = get_font(branding['fonts']['corps'], 30)

    caption2_y = H - 82
    caption1_y = caption2_y - 46
    sep_y      = caption1_y - 28
    titre_y    = sep_y - 66

    draw.text((56, titre_y), titre, font=ft, fill=primary)
    draw.line([(56, sep_y),(200, sep_y)], fill=primary, width=1)
    draw_wrapped_text(draw, caption, fc, W - 120, 56, caption1_y, light)
    return canvas

# ─────────────────────────────────────────────────────────────────────────────
# FORMAT 4 — CITATION 1080×1080
# Fond coloré uni + citation générée par IA — pas de photo
# ─────────────────────────────────────────────────────────────────────────────
def generate_citation(logo_url, branding, citation_text, sous_titre=None,
                       variant=0):
    W, H    = 1080, 1080
    palette = branding['palette']

    # Alterner entre 3 variantes de fond selon le variant
    bg_options = [
        palette.get('dark',      '#0d0d0d'),   # variant 0 — fond sombre
        palette.get('primary',   '#e8b4b8'),   # variant 1 — fond couleur primaire
        palette.get('light',     '#f5f0eb'),   # variant 2 — fond clair
    ]
    text_options = [
        palette.get('text_light', '#ffffff'),  # texte sur sombre
        palette.get('text_dark',  '#2c1a1e'),  # texte sur primaire
        palette.get('text_dark',  '#2c1a1e'),  # texte sur clair
    ]
    accent_options = [
        palette.get('primary',   '#e8b4b8'),   # accent sur sombre
        palette.get('dark',      '#0d0d0d'),   # accent sur primaire
        palette.get('primary',   '#e8b4b8'),   # accent sur clair
    ]

    v      = variant % 3
    bg_rgb = hex_to_rgb(bg_options[v])
    tx_rgb = hex_to_rgb(text_options[v])
    ac_rgb = hex_to_rgb(accent_options[v])

    # Fond uni
    canvas = Image.new('RGB', (W, H), bg_rgb)
    draw   = ImageDraw.Draw(canvas)

    # Cadre fin en accent
    draw.rectangle([(30,30),(W-30,H-30)], outline=ac_rgb, width=1)

    # Guillemets décoratifs grands
    fq = get_font(branding['fonts']['titre'], 180)
    draw.text((60, 20), '\u201c', font=fq, fill=(*ac_rgb, 40))

    # Citation — centrée verticalement
    ft       = get_font(branding['fonts']['titre'], 58)
    fc       = get_font(branding['fonts']['corps'], 30)
    max_w    = W - 160

    # Calculer hauteur totale pour centrage
    words    = citation_text.split()
    lines    = []
    current  = ''
    for word in words:
        test = f"{current} {word}".strip()
        bbox = draw.textbbox((0,0), test, font=ft)
        if bbox[2] - bbox[0] <= max_w:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    _, _, _, lh = draw.textbbox((0,0), 'A', font=ft)
    line_h     = int(lh * 1.5)
    total_h    = len(lines) * line_h
    start_y    = (H - total_h) // 2 - 40

    # Dessiner chaque ligne centrée
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0,0), line, font=ft)
        lw   = bbox[2] - bbox[0]
        x    = (W - lw) // 2
        draw.text((x, start_y + i * line_h), line, font=ft, fill=tx_rgb)

    # Ligne décorative sous la citation
    sep_y = start_y + total_h + 30
    draw.line([(W//2 - 60, sep_y),(W//2 + 60, sep_y)], fill=ac_rgb, width=1)

    # Sous-titre (tagline ou nom client)
    if sous_titre:
        bbox = draw.textbbox((0,0), sous_titre, font=fc)
        sw   = bbox[2] - bbox[0]
        draw.text(((W - sw)//2, sep_y + 20), sous_titre, font=fc,
                  fill=(*tx_rgb[:3], 180) if len(tx_rgb) == 3 else tx_rgb)

    # Logo — couleur adaptée au fond
    if v == 0:
        logo = load_logo(logo_url, 180, branding.get('logo_style','thick'))
    else:
        dark_color = hex_to_rgb(palette.get('dark', '#0d0d0d'))
        logo = load_logo_dark(logo_url, 180, branding.get('logo_style','thick'),
                              color=dark_color)

    logo_x = (W - logo.width) // 2
    logo_y = H - logo.height - 50
    canvas = paste_layer(canvas, logo, logo_x, logo_y)
    return canvas

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT PRINCIPAL — POST /assemble
# ─────────────────────────────────────────────────────────────────────────────
@app.route('/assemble', methods=['POST'])
def assemble():
    try:
        data        = request.json
        client_id   = data['client_id']
        format_type = data['format']
        photo_urls  = data.get('photo_urls', [])
        logo_url    = data['logo_url']
        branding    = data['branding']
        titre       = data.get('titre', '')
        caption     = data.get('caption', '')
        tagline     = data.get('tagline', branding.get('tagline', ''))
        titres      = data.get('titres', [titre])
        captions    = data.get('captions', [caption])
        citation    = data.get('citation_text', '')
        sous_titre  = data.get('sous_titre', tagline)
        variant     = data.get('variant', 0)

        import time
        ts          = int(time.time())
        output_urls = []

        if format_type == 'single':
            img = generate_single(photo_urls[0], logo_url, branding, titre, caption)
            output_urls.append(upload_to_supabase(img, f"single_{client_id}_{ts}.jpg", client_id))

        elif format_type == 'story':
            img = generate_story(photo_urls[0], logo_url, branding, titre, caption, tagline)
            output_urls.append(upload_to_supabase(img, f"story_{client_id}_{ts}.jpg", client_id))

        elif format_type == 'carousel':
            total = len(photo_urls)
            for i, photo_url in enumerate(photo_urls):
                img = generate_carousel_slide(
                    photo_url, logo_url, branding,
                    titres[i] if i < len(titres) else titre,
                    captions[i] if i < len(captions) else caption,
                    i + 1, total
                )
                output_urls.append(upload_to_supabase(
                    img, f"carousel_{client_id}_{i+1}_{ts}.jpg", client_id))

        elif format_type == 'citation':
            img = generate_citation(logo_url, branding, citation, sous_titre, variant)
            output_urls.append(upload_to_supabase(img, f"citation_{client_id}_{ts}.jpg", client_id))

        return jsonify({ 'success': True, 'urls': output_urls })

    except Exception as e:
        import traceback
        print(f"❌ Erreur assembleur: {e}\n{traceback.format_exc()}")
        return jsonify({ 'success': False, 'error': str(e) }), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({ 'status': 'ok' })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port)