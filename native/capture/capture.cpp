#include <windows.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <jni.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <array>
#include <atomic>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace capture = winrt::Windows::Graphics::Capture;
namespace directx = winrt::Windows::Graphics::DirectX;
namespace direct3d = directx::Direct3D11;

namespace {
// Matches WindowCapture.Status. QPC is used for BOTH arrival and observation times.
enum Status : jint { Waiting = 0, Running = 1, Minimized = 2, Closed = 3, Error = 4 };

int64_t nowNanos() {
    static const int64_t frequency = [] { LARGE_INTEGER v; QueryPerformanceFrequency(&v); return v.QuadPart; }();
    LARGE_INTEGER v;
    QueryPerformanceCounter(&v);
    return v.QuadPart / frequency * 1'000'000'000LL + v.QuadPart % frequency * 1'000'000'000LL / frequency;
}

struct DpiScope {
    DPI_AWARENESS_CONTEXT previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    ~DpiScope() { SetThreadDpiAwarenessContext(previous); }
};

void initializeApartment() {
    struct Apartment {
        Apartment() { winrt::init_apartment(winrt::apartment_type::multi_threaded); }
        ~Apartment() { winrt::uninit_apartment(); }
    };
    thread_local Apartment apartment;
}

jstring javaString(JNIEnv* env, std::wstring const& value) {
    return env->NewString(reinterpret_cast<jchar const*>(value.data()), static_cast<jsize>(value.size()));
}

void throwJava(JNIEnv* env, std::wstring const& message) {
    auto type = env->FindClass("java/lang/IllegalStateException");
    auto constructor = env->GetMethodID(type, "<init>", "(Ljava/lang/String;)V");
    auto text = javaString(env, message);
    auto error = env->NewObject(type, constructor, text);
    env->Throw(static_cast<jthrowable>(error));
}

struct Metrics {
    int windowWidth;
    int windowHeight;
    std::array<jint, 8> clientHints;
    UINT dpi;
    bool operator==(Metrics const&) const = default;
};

Metrics metrics(HWND hwnd) {
    DpiScope scope;
    RECT window{}, client{}, extended{};
    winrt::check_bool(GetWindowRect(hwnd, &window));
    winrt::check_bool(GetClientRect(hwnd, &client));
    POINT origin{0, 0};
    winrt::check_bool(ClientToScreen(hwnd, &origin));
    winrt::check_hresult(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &extended, sizeof(extended)));
    return {window.right - window.left, window.bottom - window.top,
        {origin.x - extended.left, origin.y - extended.top, client.right, client.bottom,
         origin.x - window.left, origin.y - window.top, client.right, client.bottom}, GetDpiForWindow(hwnd)};
}

struct FrameSnapshot {
    Status status = Waiting;
    std::wstring detail = L"等待 WGC 首帧";
    int64_t id = 0;
    int64_t arrival = 0;
    int width = 0;
    int height = 0;
    std::vector<jint> pixels;
};

// One WGC source, one most recent CPU image. Callbacks never invoke Java/JNI.
class FrameSource : public std::enable_shared_from_this<FrameSource> {
    capture::GraphicsCaptureItem item{nullptr};
    capture::Direct3D11CaptureFramePool pool{nullptr};
    capture::GraphicsCaptureSession session{nullptr};
    direct3d::IDirect3DDevice device{nullptr};
    winrt::com_ptr<ID3D11Device> d3d;
    winrt::com_ptr<ID3D11DeviceContext> context;
    winrt::com_ptr<ID3D11Texture2D> staging;
    winrt::Windows::Graphics::SizeInt32 poolSize{};
    winrt::event_token arrivedToken{};
    winrt::event_token closedToken{};
    bool arrivedRegistered = false;
    bool closedRegistered = false;
    std::atomic_bool stopped = false;
    std::mutex frameMutex;
    std::mutex dataMutex;
    FrameSnapshot latest;

    void fail(std::wstring const& message) {
        std::lock_guard lock(dataMutex);
        latest.status = Error;
        latest.detail = message;
        latest.pixels.clear();
    }

    void onFrame(capture::Direct3D11CaptureFramePool const& sender) {
        std::lock_guard frameLock(frameMutex);
        if (stopped.load()) return;
        int64_t arrival = nowNanos();
        try {
            auto frame = sender.TryGetNextFrame();
            if (!frame) return; // The event can be queued after another callback drains the pool.
            auto size = frame.ContentSize();
            bool resized = size.Width != poolSize.Width || size.Height != poolSize.Height;
            if (size.Width <= 0 || size.Height <= 0) { frame.Close(); return; }
            auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
            winrt::com_ptr<ID3D11Texture2D> texture;
            winrt::check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D), texture.put_void()));
            D3D11_TEXTURE2D_DESC desc{};
            texture->GetDesc(&desc);
            // ContentSize may grow before the old frame-pool texture grows.
            if (resized) {
                {
                    std::lock_guard dataLock(dataMutex);
                    latest.status = Waiting;
                    latest.detail = L"捕获尺寸变化，等待新帧";
                    latest.pixels.clear();
                }
                frame.Close();
                frame = nullptr;
                poolSize = size;
                staging = nullptr;
                sender.Recreate(device, directx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
                return;
            }
            if (static_cast<UINT>(size.Width) > desc.Width || static_cast<UINT>(size.Height) > desc.Height) {
                frame.Close();
                return;
            }
            if (!staging) {
                desc.Usage = D3D11_USAGE_STAGING;
                desc.BindFlags = 0;
                desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
                desc.MiscFlags = 0;
                winrt::check_hresult(d3d->CreateTexture2D(&desc, nullptr, staging.put()));
            }
            context->CopyResource(staging.get(), texture.get());
            std::vector<jint> pixels(static_cast<size_t>(size.Width) * size.Height);
            D3D11_MAPPED_SUBRESOURCE mapped{};
            winrt::check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
            for (int y = 0; y < size.Height; ++y) {
                auto row = reinterpret_cast<uint32_t const*>(static_cast<uint8_t const*>(mapped.pData) + y * mapped.RowPitch);
                for (int x = 0; x < size.Width; ++x)
                    pixels[static_cast<size_t>(y) * size.Width + x] = static_cast<jint>(row[x] | 0xff000000U);
            }
            context->Unmap(staging.get(), 0);
            frame.Close();
            std::lock_guard dataLock(dataMutex);
            if (!stopped.load() && latest.status != Closed && latest.status != Error) {
                latest.status = Running;
                latest.detail = L"捕获中";
                ++latest.id;
                latest.arrival = arrival;
                latest.width = size.Width;
                latest.height = size.Height;
                latest.pixels = std::move(pixels);
            }
        } catch (winrt::hresult_error const& e) {
            if (!stopped.load()) fail(L"WGC: " + std::wstring(e.message().c_str()));
        } catch (std::exception const& e) {
            if (!stopped.load()) fail(winrt::to_hstring(e.what()).c_str());
        }
    }

public:
    void start(HWND hwnd) {
        auto factory = winrt::get_activation_factory<capture::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        winrt::check_hresult(factory->CreateForWindow(hwnd, winrt::guid_of<capture::GraphicsCaptureItem>(), winrt::put_abi(item)));
        winrt::check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            nullptr, 0, D3D11_SDK_VERSION, d3d.put(), nullptr, context.put()));
        winrt::com_ptr<IDXGIDevice> dxgi = d3d.as<IDXGIDevice>();
        winrt::com_ptr<IInspectable> inspectable;
        winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
        device = inspectable.as<direct3d::IDirect3DDevice>();
        poolSize = item.Size();
        pool = capture::Direct3D11CaptureFramePool::CreateFreeThreaded(device,
            directx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, poolSize);
        session = pool.CreateCaptureSession(item);
        if (winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(
                L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsCursorCaptureEnabled"))
            session.IsCursorCaptureEnabled(false);
        auto weak = weak_from_this();
        closedToken = item.Closed([weak](auto const&, auto const&) {
            if (auto self = weak.lock()) {
                std::lock_guard lock(self->dataMutex);
                self->latest.status = Closed;
                self->latest.detail = L"目标窗口已关闭，请刷新并重新选择";
                self->latest.pixels.clear();
            }
        });
        closedRegistered = true;
        arrivedToken = pool.FrameArrived([weak](auto const& sender, auto const&) {
            if (auto self = weak.lock()) self->onFrame(sender);
        });
        arrivedRegistered = true;
        session.StartCapture();
    }

    FrameSnapshot snapshot(bool copyPixels, int64_t previousId) {
        std::lock_guard lock(dataMutex);
        HRESULT removed = d3d->GetDeviceRemovedReason();
        if (FAILED(removed) && latest.status != Closed) {
            latest.status = Error;
            latest.detail = L"D3D 设备失效: " + std::wstring(winrt::hresult_error(removed).message().c_str());
            latest.pixels.clear();
        }
        FrameSnapshot result{latest.status, latest.detail, latest.id, latest.arrival, latest.width, latest.height, {}};
        if (latest.status == Running && copyPixels && previousId != latest.id) result.pixels = latest.pixels;
        return result;
    }

    // Keep the item.Closed subscription alive while minimized, but drop the pool/session.
    void stop() {
        if (stopped.exchange(true)) return;
        if (arrivedRegistered) { pool.FrameArrived(arrivedToken); arrivedRegistered = false; }
        if (session) session.Close();
        if (pool) pool.Close();
    }

    ~FrameSource() {
        // Closing a target can race with cleanup; destruction must not cross a JNI/WinRT boundary with an exception.
        try { stop(); } catch (winrt::hresult_error const&) {}
        if (closedRegistered) {
            try { item.Closed(closedToken); } catch (winrt::hresult_error const&) {}
        }
    }
};

struct Session {
    HWND hwnd;
    DWORD pid;
    int64_t revision = 0;
    bool paused = false;
    Metrics previous{};
    std::shared_ptr<FrameSource> source;

    FrameSnapshot poll(Metrics const& current, int64_t previousRevision, int64_t previousId) {
        if (source) {
            auto state = source->snapshot(false, previousId);
            if (state.status == Closed || state.status == Error) return state;
        }
        if (IsIconic(hwnd)) {
            if (!paused) { if (source) source->stop(); paused = true; ++revision; }
            return {Minimized, L"窗口已最小化，识别暂停", 0, 0, 0, 0, {}};
        }
        if (!source || paused || !(current == previous)) {
            // A fresh pool prevents old pixels from surviving minimize/restore, DPI or size changes.
            if (source) source->stop();
            source.reset();
            paused = false;
            previous = current;
            ++revision;
            source = std::make_shared<FrameSource>();
            source->start(hwnd);
        }
        return source->snapshot(true, previousRevision != revision ? -1 : previousId);
    }
};

struct WindowEntry { HWND hwnd; DWORD pid; std::wstring title; };
BOOL CALLBACK enumerate(HWND hwnd, LPARAM parameter) {
    DWORD pid;
    GetWindowThreadProcessId(hwnd, &pid);
    if (!IsWindowVisible(hwnd) || pid == GetCurrentProcessId() || GetWindowTextLengthW(hwnd) == 0) return TRUE;
    DWORD cloaked = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) return TRUE;
    int length = GetWindowTextLengthW(hwnd);
    std::wstring title(static_cast<size_t>(length) + 1, L'\0');
    int copied = GetWindowTextW(hwnd, title.data(), length + 1);
    title.resize(copied);
    if (!title.empty()) reinterpret_cast<std::vector<WindowEntry>*>(parameter)->push_back({hwnd, pid, std::move(title)});
    return TRUE;
}
}

extern "C" JNIEXPORT jobjectArray JNICALL Java_io_github_rsocr_desktop_capture_WindowCapture_windows0(JNIEnv* env, jclass) {
    try {
        DpiScope scope;
        std::vector<WindowEntry> windows;
        winrt::check_bool(EnumWindows(enumerate, reinterpret_cast<LPARAM>(&windows)));
        auto type = env->FindClass("io/github/rsocr/desktop/capture/WindowCapture$Window");
        auto constructor = env->GetMethodID(type, "<init>", "(JILjava/lang/String;)V");
        auto result = env->NewObjectArray(static_cast<jsize>(windows.size()), type, nullptr);
        for (jsize i = 0; i < static_cast<jsize>(windows.size()); ++i) {
            auto const& w = windows[i];
            auto title = javaString(env, w.title);
            auto entry = env->NewObject(type, constructor, reinterpret_cast<jlong>(w.hwnd), static_cast<jint>(w.pid), title);
            env->SetObjectArrayElement(result, i, entry);
            env->DeleteLocalRef(entry);
            env->DeleteLocalRef(title);
        }
        return result;
    } catch (winrt::hresult_error const& e) { throwJava(env, e.message().c_str()); return nullptr; }
      catch (std::exception const& e) { throwJava(env, winrt::to_hstring(e.what()).c_str()); return nullptr; }
}

extern "C" JNIEXPORT jlong JNICALL Java_io_github_rsocr_desktop_capture_WindowCapture_open0(JNIEnv* env, jclass, jlong hwnd, jint pid) {
    try {
        initializeApartment();
        if (!capture::GraphicsCaptureSession::IsSupported()) winrt::throw_hresult(E_NOTIMPL);
        auto session = std::make_unique<Session>();
        session->hwnd = reinterpret_cast<HWND>(hwnd);
        session->pid = static_cast<DWORD>(pid);
        DWORD actualPid = 0;
        GetWindowThreadProcessId(session->hwnd, &actualPid);
        if (!IsWindow(session->hwnd) || actualPid != session->pid) throw winrt::hresult_invalid_argument(L"目标窗口已失效，请重新选择");
        session->poll(metrics(session->hwnd), -1, -1);
        return reinterpret_cast<jlong>(session.release());
    } catch (winrt::hresult_error const& e) { throwJava(env, e.message().c_str()); return 0; }
      catch (std::exception const& e) { throwJava(env, winrt::to_hstring(e.what()).c_str()); return 0; }
}

extern "C" JNIEXPORT jobject JNICALL Java_io_github_rsocr_desktop_capture_WindowCapture_poll0(
        JNIEnv* env, jclass, jlong handle, jlong previousRevision, jlong previousId) {
    try {
        auto& session = *reinterpret_cast<Session*>(handle);
        DWORD actualPid = 0;
        GetWindowThreadProcessId(session.hwnd, &actualPid);
        Metrics current{};
        FrameSnapshot frame;
        if (!IsWindow(session.hwnd) || actualPid != session.pid)
            frame = {Closed, L"目标窗口已关闭，请刷新并重新选择", 0, 0, 0, 0, {}};
        else {
            current = metrics(session.hwnd);
            frame = session.poll(current, previousRevision, previousId);
        }
        auto type = env->FindClass("io/github/rsocr/desktop/capture/WindowCapture$NativeSnapshot");
        auto constructor = env->GetMethodID(type, "<init>", "(ILjava/lang/String;JJJJII[I[II)V");
        auto detail = javaString(env, frame.detail);
        jintArray pixels = nullptr;
        if (!frame.pixels.empty()) {
            pixels = env->NewIntArray(static_cast<jsize>(frame.pixels.size()));
            env->SetIntArrayRegion(pixels, 0, static_cast<jsize>(frame.pixels.size()), frame.pixels.data());
        }
        auto hints = env->NewIntArray(8);
        env->SetIntArrayRegion(hints, 0, 8, current.clientHints.data());
        return env->NewObject(type, constructor, static_cast<jint>(frame.status), detail, static_cast<jlong>(session.revision),
            static_cast<jlong>(frame.id), static_cast<jlong>(frame.arrival), static_cast<jlong>(nowNanos()),
            frame.width, frame.height, pixels, hints, static_cast<jint>(current.dpi));
    } catch (winrt::hresult_error const& e) { throwJava(env, e.message().c_str()); return nullptr; }
      catch (std::exception const& e) { throwJava(env, winrt::to_hstring(e.what()).c_str()); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL Java_io_github_rsocr_desktop_capture_WindowCapture_close0(JNIEnv*, jclass, jlong handle) {
    delete reinterpret_cast<Session*>(handle);
}
