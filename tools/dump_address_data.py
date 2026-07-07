# tools/dump_address_data.py
import re

def search_text(file_path):
    with open(file_path, 'rb') as f:
        data = f.read()

    keywords = ['SVMCAddress', 'SRBRAddress', 'SRIBAddress', 'SRINAddress']
    
    for kw in keywords:
        print(f"\n==================== Keyword: {kw} ====================")
        
        # Test UTF-8/ASCII bytes
        utf8_bytes = kw.encode('utf-8')
        # Test UTF-16LE bytes
        utf16_bytes = kw.encode('utf-16le')
        
        for encoding_name, target in [('UTF-8', utf8_bytes), ('UTF-16LE', utf16_bytes)]:
            idx = 0
            while True:
                idx = data.find(target, idx)
                if idx == -1:
                    break
                print(f"[{encoding_name}] Found at offset {idx} (0x{idx:X})")
                
                # Dump 400 bytes around the match
                start = max(0, idx - 100)
                end = min(len(data), idx + 500)
                chunk = data[start:end]
                
                print("--- Dump (ASCII representation, '.' for non-printable) ---")
                printable = []
                for b in chunk:
                    if 32 <= b <= 126:
                        printable.append(chr(b))
                    elif b == 10:
                        printable.append('\n')
                    elif b == 13:
                        printable.append('\r')
                    else:
                        printable.append('.')
                print(''.join(printable))
                
                print("--- Hex representation ---")
                # Group in chunks of 16
                for o in range(0, len(chunk), 16):
                    row = chunk[o:o+16]
                    hex_str = row.hex(' ')
                    ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in row)
                    print(f"{start + o:08X}  {hex_str:<47}  |{ascii_str}|")
                
                idx += len(target)

if __name__ == '__main__':
    search_text("/home/endri-pro/Videos/QuickBuild_Downloader/QD (2).exe")
