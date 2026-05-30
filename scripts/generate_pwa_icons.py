from PIL import Image, ImageDraw
from pathlib import Path

def create_icon(size, path):
    # Dark background #0f1117
    img = Image.new('RGB', (size, size), '#0f1117')
    draw = ImageDraw.Draw(img)
    
    margin = size // 5
    spine_w = size // 16
    spine_x = (size - spine_w) // 2
    
    # Left page (light gray #e8edf8)
    draw.rectangle([margin, margin, spine_x, size - margin], fill='#e8edf8')
    # Right page (light gray #e8edf8)
    draw.rectangle([spine_x + spine_w, margin, size - margin, size - margin], fill='#e8edf8')
    
    # Spine (orange #ff8c00)
    radius = max(2, size // 40)
    draw.rounded_rectangle(
        [spine_x - size//40, margin - size//80, spine_x + spine_w + size//40, size - margin + size//80], 
        radius=radius, 
        fill='#ff8c00'
    )
    
    # Page text lines (simulated)
    line_y_start = margin + size // 10
    line_y_end = size - margin - size // 10
    line_spacing = size // 16
    line_w = max(1, size // 120)
    for y in range(line_y_start, line_y_end, line_spacing):
        # Left page lines
        draw.line([margin + size//16, y, spine_x - size//16, y], fill='#ff8c00', width=line_w)
        # Right page lines
        draw.line([spine_x + spine_w + size//16, y, size - margin - size//16, y], fill='#ff8c00', width=line_w)
        
    img.save(path, 'PNG')

if __name__ == '__main__':
    root = Path(__file__).parent.parent
    public_dir = root / 'frontend' / 'public'
    public_dir.mkdir(parents=True, exist_ok=True)
    
    create_icon(192, public_dir / 'icon-192.png')
    create_icon(512, public_dir / 'icon-512.png')
    print("PWA icons generated successfully inside frontend/public!")
