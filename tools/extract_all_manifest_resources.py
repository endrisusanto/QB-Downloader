# tools/extract_all_manifest_resources.py
import struct
import os

def unpack_resources(bin_path):
    with open(bin_path, 'rb') as f:
        data = f.read()

    print(f"Loaded raw resources binary of size {len(data)} bytes")
    
    # List of resources in the metadata order
    # (extracted from the manifest resource table in the metadata stream)
    resource_names = [
        "QD.About.resources",
        "QD.AddNewFolder.resources",
        "QD.deleteFile.resources",
        "QD.GetDeviceLog.resources",
        "QD.LatestBuilds.resources",
        "QD.Properties.Resources.resources",
        "QD.chooseForSameFile.resources",
        "QD.QD.resources",
        "QD.QDMessageBox.resources",
        "QD.SettingPopup.resources",
        "QD.QuickDownload.resources",
        "QD.SVMCAddress.txt",
        "QD.SRBRAddress.txt",
        "QD.SRIBAddress.txt",
        "QD.SRINAddress.txt",
        "QD.Microsoft.WindowsAPICodePack.dll",
        "QD.Microsoft.WindowsAPICodePack.Shell.dll",
        "QD.System.Management.dll",
        "QD.Newtonsoft.Json.dll",
        "QD.Aga.Controls.dll",
        "QD.ExtraToolbox.dll",
        "QD.odin4.exe"
    ]

    os.makedirs("/home/endri-pro/Videos/QuickBuild_Downloader/tools/extracted", exist_ok=True)

    offset = 0
    res_idx = 0
    while offset < len(data):
        if offset + 4 > len(data):
            break
            
        res_size = struct.unpack('<I', data[offset:offset+4])[0]
        offset += 4
        
        if offset + res_size > len(data):
            print(f"Error: resource size {res_size} exceeds remaining data size")
            break
            
        res_data = data[offset:offset+res_size]
        offset += res_size
        
        if res_idx < len(resource_names):
            name = resource_names[res_idx]
        else:
            name = f"Resource_{res_idx}.bin"
            
        output_path = f"/home/endri-pro/Videos/QuickBuild_Downloader/tools/extracted/{name}"
        with open(output_path, 'wb') as out_f:
            out_f.write(res_data)
            
        print(f"Extracted: {name:<50} | Size: {res_size:<8} bytes | Offset: 0x{offset - res_size - 4:X}")
        res_idx += 1

if __name__ == '__main__':
    unpack_resources("/home/endri-pro/Videos/QuickBuild_Downloader/tools/raw_resources.bin")
