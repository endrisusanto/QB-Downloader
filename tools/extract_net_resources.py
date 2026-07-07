# tools/extract_net_resources.py
import struct

def extract_resources(pe_path):
    with open(pe_path, 'rb') as f:
        data = f.read()

    # Verify MZ signature
    if data[0:2] != b'MZ':
        print("Not a valid PE file (missing MZ signature)")
        return

    # PE header offset
    pe_offset = struct.unpack('<I', data[0x3C:0x40])[0]
    if data[pe_offset:pe_offset+4] != b'PE\x00\x00':
        print("Not a valid PE file (missing PE signature)")
        return

    # COFF header
    num_sections = struct.unpack('<H', data[pe_offset+6:pe_offset+8])[0]
    size_opt_header = struct.unpack('<H', data[pe_offset+20:pe_offset+22])[0]
    
    # Optional header offset
    opt_header_offset = pe_offset + 24
    magic = struct.unpack('<H', data[opt_header_offset:opt_header_offset+2])[0]
    
    # Check if PE32 or PE32+
    if magic == 0x10b: # PE32
        cli_dir_offset = opt_header_offset + 208 # DataDirectory[14]
    elif magic == 0x20b: # PE32+
        cli_dir_offset = opt_header_offset + 224
    else:
        print(f"Unknown magic: {magic:X}")
        return

    cli_va, cli_size = struct.unpack('<II', data[cli_dir_offset:cli_dir_offset+8])
    if cli_va == 0 or cli_size == 0:
        print("No CLI header (not a .NET assembly)")
        return

    # Read section headers to map VA to file offset
    section_headers_offset = opt_header_offset + size_opt_header
    sections = []
    for i in range(num_sections):
        offset = section_headers_offset + (i * 40)
        sec_name = data[offset:offset+8].rstrip(b'\x00').decode('ascii', errors='ignore')
        vsize, va, raw_size, raw_ptr = struct.unpack('<IIII', data[offset+8:offset+24])
        sections.append({
            'name': sec_name,
            'va': va,
            'vsize': vsize,
            'raw_ptr': raw_ptr,
            'raw_size': raw_size
        })

    def rva_to_offset(rva):
        for sec in sections:
            if sec['va'] <= rva < sec['va'] + sec['vsize']:
                return sec['raw_ptr'] + (rva - sec['va'])
        return None

    cli_header_offset = rva_to_offset(cli_va)
    if not cli_header_offset:
        print("Could not map CLI header VA to file offset")
        return

    # CLI Header details
    # cb (size): 4 bytes, major: 2, minor: 2, metadata: 8, flags: 4, entrypoint: 4, resources: 8
    resources_va, resources_size = struct.unpack('<II', data[cli_header_offset+24:cli_header_offset+32])
    print(f"CLI Resources VA: 0x{resources_va:X}, Size: {resources_size} bytes")

    if resources_va == 0 or resources_size == 0:
        print("No embedded resources found in CLI header")
        return

    resources_offset = rva_to_offset(resources_va)
    if not resources_offset:
        print("Could not map CLI Resources VA to file offset")
        return

    print(f"CLI Resources offset in file: 0x{resources_offset:X}")
    resources_data = data[resources_offset:resources_offset+resources_size]
    
    with open('/home/endri-pro/Videos/QuickBuild_Downloader/tools/raw_resources.bin', 'wb') as out_f:
        out_f.write(resources_data)
    print("Saved raw resources block to tools/raw_resources.bin")

    # Let's try to search the resources_data for any printable ASCII string patterns of length >= 6
    print("\nScanning raw resources data for text strings...")
    idx = 0
    while idx < len(resources_data):
        # Scan for length-prefixed strings or plain text
        # .NET Resources (.resources format) starts with 0xBEEFCACE magic
        # and has type table and name/data offsets.
        # But we can also do a simple search for strings.
        # Let's search for sequences of printable characters.
        start = idx
        while idx < len(resources_data) and 32 <= resources_data[idx] <= 126:
            idx += 1
        length = idx - start
        if length >= 6:
            text = resources_data[start:idx].decode('ascii', errors='ignore')
            # Filter out some garbage
            if not text.startswith(('System.', 'mscorlib', 'Version=', 'PublicKeyToken=')):
                print(f"  String at resource offset {start} (0x{start:X}): {text}")
        idx += 1

if __name__ == '__main__':
    import sys
    if len(sys.argv) < 3:
        print("Usage: python3 extract_net_resources.py <pe_path> <out_path>")
        sys.exit(1)
    
    # Verify MZ signature
    pe_path = sys.argv[1]
    out_path = sys.argv[2]
    
    with open(pe_path, 'rb') as f:
        data = f.read()

    # Verify MZ signature
    if data[0:2] != b'MZ':
        print("Not a valid PE file (missing MZ signature)")
        sys.exit(1)

    # PE header offset
    pe_offset = struct.unpack('<I', data[0x3C:0x40])[0]
    if data[pe_offset:pe_offset+4] != b'PE\x00\x00':
        print("Not a valid PE file (missing PE signature)")
        sys.exit(1)

    # COFF header
    num_sections = struct.unpack('<H', data[pe_offset+6:pe_offset+8])[0]
    size_opt_header = struct.unpack('<H', data[pe_offset+20:pe_offset+22])[0]
    
    # Optional header offset
    opt_header_offset = pe_offset + 24
    magic = struct.unpack('<H', data[opt_header_offset:opt_header_offset+2])[0]
    
    # Check if PE32 or PE32+
    if magic == 0x10b: # PE32
        cli_dir_offset = opt_header_offset + 208 # DataDirectory[14]
    elif magic == 0x20b: # PE32+
        cli_dir_offset = opt_header_offset + 224
    else:
        print(f"Unknown magic: {magic:X}")
        sys.exit(1)

    cli_va, cli_size = struct.unpack('<II', data[cli_dir_offset:cli_dir_offset+8])
    if cli_va == 0 or cli_size == 0:
        print("No CLI header (not a .NET assembly)")
        sys.exit(1)

    # Read section headers to map VA to file offset
    section_headers_offset = opt_header_offset + size_opt_header
    sections = []
    for i in range(num_sections):
        offset = section_headers_offset + (i * 40)
        sec_name = data[offset:offset+8].rstrip(b'\x00').decode('ascii', errors='ignore')
        vsize, va, raw_size, raw_ptr = struct.unpack('<IIII', data[offset+8:offset+24])
        sections.append({
            'name': sec_name,
            'va': va,
            'vsize': vsize,
            'raw_ptr': raw_ptr,
            'raw_size': raw_size
        })

    def rva_to_offset(rva):
        for sec in sections:
            if sec['va'] <= rva < sec['va'] + sec['vsize']:
                return sec['raw_ptr'] + (rva - sec['va'])
        return None

    cli_header_offset = rva_to_offset(cli_va)
    if not cli_header_offset:
        print("Could not map CLI header VA to file offset")
        sys.exit(1)

    # CLI Header details
    resources_va, resources_size = struct.unpack('<II', data[cli_header_offset+24:cli_header_offset+32])
    print(f"CLI Resources VA: 0x{resources_va:X}, Size: {resources_size} bytes")

    if resources_va == 0 or resources_size == 0:
        print("No embedded resources found in CLI header")
        sys.exit(1)

    resources_offset = rva_to_offset(resources_va)
    if not resources_offset:
        print("Could not map CLI Resources VA to file offset")
        sys.exit(1)

    print(f"CLI Resources offset in file: 0x{resources_offset:X}")
    resources_data = data[resources_offset:resources_offset+resources_size]
    
    with open(out_path, 'wb') as out_f:
        out_f.write(resources_data)
    print(f"Saved raw resources block to {out_path}")

