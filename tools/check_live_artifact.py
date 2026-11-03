"""Record the native capture provenance and check the DLL embedded in the desktop JAR."""
from pathlib import Path
import hashlib,json,zipfile

ROOT=Path(__file__).resolve().parents[1]
reference=ROOT.parent/'g1-ocr'
sha=lambda data:hashlib.sha256(data).hexdigest()
original=(reference/'native/capture/capture.cpp').read_bytes()
current=(ROOT/'native/capture/capture.cpp').read_bytes()
expected=original.decode('utf-8').replace('Java_io_github_g1ocr_capture_WindowCapture_', 'Java_io_github_rsocr_desktop_capture_WindowCapture_').replace('io/github/g1ocr/capture/', 'io/github/rsocr/desktop/capture/')
assert current.decode('utf-8')==expected,'Native adaptation exceeds the recorded JNI namespace substitution'
dll=(ROOT/'.tools/capture/Release/rscapture.dll').read_bytes()
with zipfile.ZipFile(ROOT/'desktop/target/rs-ocr-desktop-0.1.0.jar') as jar:
    assert jar.read('native/windows-x64/rscapture.dll')==dll
report=dict(reference_project='g1-ocr',reference_tag='v0.0.3',reference_commit='9f65656e4489cde6f2112e77ba33b90037cb55d7',
            original_cpp_sha256=sha(original),rs_cpp_sha256=sha(current),native_changes='JNI namespace only',
            java_changes=['RS namespace','lazy bundled-DLL extraction and verified cache','Java clock alignment before pixel copy','wrap immutable native ARGB array without a second full-window copy'],
            native_dll_sha256=sha(dll),embedded_dll_identical=True,
            api_minimum_windows_build=18362,architecture='x64',tested_host_windows_build=26200,tested_dpi=144,
            api_reference='https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow',
            capture='Windows.Graphics.Capture / D3D11',desktop_capture_fallback=False,
            compiler='MSVC 14.44.35207',windows_sdk='10.0.26100.0',runtime_linkage='static MSVC CRT',
            toolchain_packages=json.loads((reference/'reports/native-toolchain.json').read_text(encoding='utf-8'))['packages'])
destination=ROOT/'reports/s5-live/native-capture.json'
destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Bundled x64 DLL verified; SHA-256 {sha(dll)}')
