import sys
sys.path.append(r"c:\Users\MHDINGBI\Desktop\PDF-VIEWER\pdf-viewer\backend")
import pipeline
print("SECTION_PREFIX pattern:", pipeline._SECTION_PREFIX.pattern)
print("Match '1. Welcome':", pipeline._SECTION_PREFIX.match("1. Welcome"))
print("Match '2.1 Composite':", pipeline._SECTION_PREFIX.match("2.1 Composite"))
