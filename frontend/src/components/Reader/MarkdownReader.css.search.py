import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

css_path = r"c:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\frontend\src\components\Reader\MarkdownReader.css"
with open(css_path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's search for selectors containing "active", "target", "focus" or properties setting background to orange / var(--or)
rules = []
for m in re.finditer(r"([^{}]+)\{([^{}]+)\}", content):
    selector = m.group(1).strip()
    properties = m.group(2).strip()
    
    # Check if background/background-color contains orange or var(--or)
    has_bg_color = "background" in properties or "background-color" in properties
    uses_orange = "var(--or)" in properties or "orange" in properties or "#ff8c00" in properties or "#ffa726" in properties or "#f97316" in properties
    
    if (has_bg_color and uses_orange) or any(k in selector.lower() for k in [":target", "active", "highlight", "focus", "selected"]):
        rules.append((selector, properties))

print(f"Found {len(rules)} rules:")
for sel, prop in rules:
    print(f"Selector: {sel}")
    print(f"Properties: {prop}")
    print("-" * 50)
