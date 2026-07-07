# tools/list_extracted.py
import os

dir_path = "/home/endri-pro/Videos/QuickBuild_Downloader/tools/extracted"
for fname in sorted(os.listdir(dir_path)):
    path = os.path.join(dir_path, fname)
    size = os.path.getsize(path)
    if size == 0:
        continue
        
    with open(path, 'rb') as f:
        head = f.read(100)
        
    # Check if printable ASCII text
    is_text = all(32 <= b <= 126 or b in [9, 10, 13] for b in head)
    
    head_str = head.decode('ascii', errors='ignore').strip().replace('\r', '').replace('\n', ' \\n ')
    
    print(f"File: {fname:<50} | Size: {size:<8} bytes | IsText: {is_text:<5} | Head: {head_str[:80]}")
