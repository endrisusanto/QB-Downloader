# tools/parse_resources.py
import struct
import base64
from hashlib import sha256

def decrypt_aes_ecb(ciphertext_base64):
    try:
        import subprocess
        # Key material: SHA256("123456789012345678901234567890")
        passphrase = b"123456789012345678901234567890"
        key = sha256(passphrase).digest()
        key_hex = key.hex()
        
        ciphertext = base64.b64decode(ciphertext_base64)
        
        # Run openssl command: openssl enc -d -aes-256-ecb -K key_hex -nopad
        p = subprocess.Popen(
            ['openssl', 'enc', '-d', '-aes-256-ecb', '-K', key_hex, '-nopad'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        decrypted, err = p.communicate(input=ciphertext)
        if p.returncode != 0:
            return f"<openssl failed: {err.decode().strip()}>"
            
        # PKCS7 unpadding
        padding_len = decrypted[-1]
        if padding_len < 1 or padding_len > 16:
            return decrypted.decode('utf-8', errors='ignore')
        
        unpadded = decrypted[:-padding_len]
        return unpadded.decode('utf-8')
    except Exception as e:
        return f"<decryption failed: {e}>"

def read_7bit_encoded_int(data, offset):
    value = 0
    shift = 0
    while True:
        b = data[offset]
        offset += 1
        value |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            break
        shift += 7
    return value, offset

def parse_resources(bin_path):
    with open(bin_path, 'rb') as f:
        data = f.read()

    # The resources block starts at offset 4 (after some CLI alignment maybe, or magic is at offset 4)
    magic_offset = data.find(b'\xCE\xCA\xEF\xBE') # BEEFCACE
    if magic_offset == -1:
        print("BEEFCACE magic not found")
        return
    
    print(f"Parsing resources block starting at offset {magic_offset} (0x{magic_offset:X})")
    
    offset = magic_offset
    magic = struct.unpack('<I', data[offset:offset+4])[0]
    offset += 4
    
    version = struct.unpack('<I', data[offset:offset+4])[0]
    offset += 4
    
    readers_size = struct.unpack('<I', data[offset:offset+4])[0]
    offset += 4
    
    # Skip the readers block completely
    offset += readers_size
    
    # Version 2 header starts here
    ver_v2 = struct.unpack('<I', data[offset:offset+4])[0]
    offset += 4
    
    num_resources = struct.unpack('<I', data[offset:offset+4])[0]
    offset += 4
    
    num_types = struct.unpack('<I', data[offset:offset+4])[0]
    offset += 4
    
    print(f"Resources format version: {ver_v2}")
    print(f"Number of resources: {num_resources}")
    print(f"Number of types: {num_types}")

    # Read type hashes/names
    type_names = []
    for _ in range(num_types):
        length, offset = read_7bit_encoded_int(data, offset)
        type_name = data[offset:offset+length].decode('utf-8', errors='ignore')
        type_names.append(type_name)
        offset += length

    # Align name table offset to 8 bytes relative to start of v2 header?
    # Actually, Name hashes are next.
    # Name table has: hashes (4 bytes each) and name offsets (4 bytes each)
    name_hashes = []
    name_offsets = []
    for _ in range(num_resources):
        hash_val = struct.unpack('<I', data[offset:offset+4])[0]
        offset += 4
        name_hashes.append(hash_val)
        
    for _ in range(num_resources):
        name_offset = struct.unpack('<I', data[offset:offset+4])[0]
        offset += 4
        name_offsets.append(name_offset)

    # Data offsets start offset
    data_offsets_start = offset
    
    # Read name strings and map to data offsets
    # Name strings are relative to name_offsets_start which is data_offsets_start
    name_strings = []
    for no in name_offsets:
        # Read name from data_offsets_start + no
        name_addr = data_offsets_start + no
        # Name is a length prefixed UTF-8 or UTF-16 string depending on version
        # Actually it's stored as length-prefixed UTF-8 in V2 resources
        length, name_addr = read_7bit_encoded_int(data, name_addr)
        name = data[name_addr:name_addr+length].decode('utf-8', errors='ignore')
        name_strings.append(name)

    # Read data offsets table
    # Data offsets table starts after the name strings
    # But wait, data offsets are 4 bytes each, total num_resources
    # Where does the data offsets table start?
    # The layout is: name hashes, name offsets, name strings, data offsets, data table.
    # Actually, let's find the data offsets table.
    # In .resources format, the data offsets table is at:
    # data_offsets_start + (some offset).
    # Let's find it by looking for the block of 4-byte integers.
    # Or, we can scan forward from the end of name strings.
    # Let's read it relative to the end of name strings block.
    # Actually, the name strings block ends at:
    # the max (name_addr + length) of all name strings.
    max_name_end = max(data_offsets_start + no + 4 for no in name_offsets) # approximate
    # Let's find the data offsets table by align/seek.
    # In .resources, the data offsets table is at:
    # offset = opt_offset
    # Let's just parse it directly.
    # Actually, we can read the 4-byte offsets starting after the name strings.
    # Let's align to 4-byte boundary.
    cur_offset = (max_name_end + 3) & ~3
    
    # Read data offsets
    data_offsets = []
    for _ in range(num_resources):
        data_offset = struct.unpack('<I', data[cur_offset:cur_offset+4])[0]
        cur_offset += 4
        data_offsets.append(data_offset)

    # Data table start
    data_table_start = cur_offset

    # Now extract all resources!
    print("\n--- Extracted Resources ---")
    for i in range(num_resources):
        name = name_strings[i]
        d_off = data_offsets[i]
        
        # Read data from data_table_start + d_off
        data_addr = data_table_start + d_off
        type_code, data_addr = read_7bit_encoded_int(data, data_addr)
        
        # Type code: 0 = Null, 1 = String, 2 = Boolean, 3 = Char, 4 = SByte, ...
        # String is 1, or type_code >= 8 means user-defined type
        if type_code == 1: # String
            str_len, data_addr = read_7bit_encoded_int(data, data_addr)
            val = data[data_addr:data_addr+str_len].decode('utf-8', errors='ignore')
        else:
            # Let's just try to read as length-prefixed string if it has text
            str_len, data_addr = read_7bit_encoded_int(data, data_addr)
            val = data[data_addr:data_addr+str_len].decode('utf-8', errors='ignore')
            
        print(f"Key: {name}")
        print(f"Raw Value: {val}")
        
        # Check if it looks like Base64 ciphertext
        cleaned_val = val.strip()
        if cleaned_val.endswith('=') or (len(cleaned_val) > 20 and all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=' for c in cleaned_val)):
            decrypted = decrypt_aes_ecb(cleaned_val)
            print(f"Decrypted Value: {decrypted}")
        print("-" * 50)

if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print("Usage: python3 parse_resources.py <resources_bin_path>")
        sys.exit(1)
    parse_resources(sys.argv[1])
