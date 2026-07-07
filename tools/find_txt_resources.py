# tools/find_txt_resources.py
import struct

def scan_resources(bin_path):
    with open(bin_path, 'rb') as f:
        data = f.read()
    
    print(f"Loaded raw resources binary of size {len(data)} bytes")
    
    # Check BEEFCACE magic
    magic_offset = data.find(b'\xCE\xCA\xEF\xBE') # BEEFCACE in little-endian
    if magic_offset != -1:
        print(f"Found BEEFCACE magic at offset {magic_offset} (0x{magic_offset:X})")
        # Let's search for keywords inside the BEEFCACE block
        search_block = data[magic_offset:]
    else:
        print("BEEFCACE magic not found, searching entire data")
        search_block = data
        magic_offset = 0

    keywords = [b'SVMCAddress.txt', b'SRBRAddress.txt', b'SRIBAddress.txt', b'SRINAddress.txt']
    
    for kw in keywords:
        print(f"\nSearching for keyword: {kw.decode()}")
        idx = 0
        while True:
            idx = search_block.find(kw, idx)
            if idx == -1:
                break
            absolute_offset = magic_offset + idx
            print(f"  Found '{kw.decode()}' at absolute offset {absolute_offset} (0x{absolute_offset:X})")
            
            # Let's scan forward. A .NET resource file contains name entries, and then data entries.
            # Usually, the names are stored together, and they have offsets to the data section.
            # But the data section itself contains the string values.
            # Let's search the rest of the file for the actual content of the text files.
            # The text file probably contains a server URL like 'http://...' or 'https://...'.
            # Let's search for any 'http' or '10.' or 'samsung' near or after this offset.
            idx += len(kw)

    # Let's search the entire raw_resources.bin for any strings containing '.net' or 'http'
    print("\nScanning for server addresses (http, 10.x, samsung.net) in raw resources...")
    import re
    # Match URL or hostname patterns in the binary data
    patterns = [
        re.compile(b'https?://[a-zA-Z0-9.-]+(?::[0-9]+)?(?:/[a-zA-Z0-9_.-]+)*'),
        re.compile(b'[a-zA-Z0-9.-]+\\.sec\\.samsung\\.net'),
        re.compile(b'10\\.[0-9]+\\.[0-9]+\\.[0-9]+')
    ]
    
    found = set()
    for pattern in patterns:
        for match in pattern.finditer(data):
            val = match.group(0).decode('ascii', errors='ignore')
            if val not in found and len(val) > 4:
                found.add(val)
                print(f"  Match: {val} at offset {match.start()} (0x{match.start():X})")

if __name__ == '__main__':
    scan_resources("/home/endri-pro/Videos/QuickBuild_Downloader/tools/raw_resources.bin")
