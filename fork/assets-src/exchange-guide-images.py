from PIL import Image, ImageDraw
S = 1206 / 920  # 预览坐标 → 原图
def src(n): return Image.open(f'/Users/metajs/Downloads/IMG_{n}.PNG').convert('RGB')
def box(y0, y1): return (0, round(y0 * S), 1206, round(y1 * S))
RED, GREEN, BG = (255, 77, 79), (34, 197, 94), (30, 35, 41)

def stack(parts, gap=18):
    h = sum(p.height for p in parts) + gap * (len(parts) - 1)
    out = Image.new('RGB', (1206, h), BG); y = 0; d = ImageDraw.Draw(out)
    for i, p in enumerate(parts):
        out.paste(p, (0, y)); y += p.height
        if i < len(parts) - 1:  # 省略号分隔：中间裁掉的部分
            for x in range(40, 1166, 28): d.line([(x, y + gap // 2), (x + 14, y + gap // 2)], fill=(90, 96, 104), width=3)
            y += gap
    return out

def rect(d, xy, c, w=6, r=18):
    d.rounded_rectangle([round(v * S) for v in xy], radius=r, outline=c, width=w)

def ring(d, cx, cy, rad, c, w=6):
    cx, cy, rad = cx * S, cy * S, rad * S
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=c, width=w)

def save(img, name, width=600):
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.save(f'{name}.webp', 'WEBP', quality=72, method=6)
    img.save(f'{name}-preview.png')

# 1) 填订单金额 → 到账数量少了手续费，点 ⇋
a = src(4584)
top, rows = a.crop(box(410, 650)), a.crop(box(1028, 1162))
img = stack([top, rows]); d = ImageDraw.Draw(img)
off = top.height / S + 18 / S - 1028  # rows 区坐标换算
rect(d, (26, 1038 + off, 900, 1086 + off), RED)           # 到账数量 9.99
ring(d, 231, 1061 + off, 26, (240, 185, 11), 7)            # ⇋ 按钮
save(img, 'step1-enter')

# 2) 弹窗：到账数量=订单金额，点确认
b = src(4585).crop(box(1300, 1900)); d = ImageDraw.Draw(b)
o = -1300
rect(d, (22, 1660 + o, 520, 1765 + o), GREEN)              # 到账数量 10.00
rect(d, (28, 1788 + o, 892, 1892 + o), (240, 185, 11), 7)  # 确认
save(b, 'step2-confirm')

# 3) 结果：提现数量自动变成 金额+手续费，到账数量=订单金额
c = src(4586)
top, rows = c.crop(box(410, 650)), c.crop(box(1028, 1162))
img = stack([top, rows]); d = ImageDraw.Draw(img)
rect(d, (30, 418 - 410, 350, 572 - 410), (240, 185, 11))   # 10.01
rect(d, (26, 1038 + off, 900, 1086 + off), GREEN)          # 到账数量 10.00
save(img, 'step3-result')
