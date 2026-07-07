# tools/scan_pe.py
import sys

def scan_file(file_path):
    with open(file_path, 'rb') as f:
        data = f.read()
    
    keywords = [b'SVMCAddress', b'SRBRAddress', b'SRIBAddress', b'SRINAddress']
    
    for kw in keywords:
        print(f"\n=== Searching for: {kw.decode()} ===")
        idx = 0
        while True:
            idx = data.find(kw, idx)
            if idx == -1:
                break
            print(f"Found at offset: {idx} (0x{idx:X})")
            
            # Print 300 bytes after the keyword to find the embedded data
            start = idx
            end = idx + 400
            snippet = data[start:end]
            
            print("Raw snippet (hex):")
            print(snippet.hex(' ', 16))
            
            print("\nASCII Representation:")
            printable = []
            for b in snippet:
                if 32 <= b <= 126:
                    printable.append(chr(b))
                elif b == 10:
                    printable.append('\n')
                elif b == 13:
                    printable.append('\r')
                else:
                    printable.append('.')
            print(''.join(printable))
            
            idx += len(kw)

if __name__ == '__main__':
    file_path = "/home/endri-pro/Videos/QuickBuild_Downloader/QD (2).exe"
    scan_file(file_path)
