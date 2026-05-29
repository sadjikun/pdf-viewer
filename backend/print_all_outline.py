import json
from pathlib import Path

cache_dir = Path(r"c:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\backend\cache")
for json_path in cache_dir.glob("*/result.json"):
    print(f"=== Cache: {json_path.parent.name} ===")
    try:
        data = json.load(json_path.open(encoding="utf-8"))
        print("filename:", data.get("filename"))
        outline = data.get("outline", [])
        
        def print_nodes(nodes, indent=0):
            for n in nodes:
                print("  " * indent + f"- p.{n.get('page')} (lvl {n.get('level')}): {repr(n.get('title'))}")
                if n.get("children"):
                    print_nodes(n["children"], indent + 1)
        
        print_nodes(outline)
    except Exception as e:
        print("error:", e)
