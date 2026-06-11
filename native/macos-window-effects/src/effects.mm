// macOS rounds windows at the radius baked into the linked SDK (pre-Tahoe
// for Electron) with no public override. A non-opaque window with a clear
// background drops the system corner mask, so rounding the content view's
// layer defines the shape instead — clipping Electron's vibrancy
// NSVisualEffectView with it, which CSS in the renderer cannot reach.

#include <napi.h>

#include <cstring>

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

// BrowserWindow.getNativeWindowHandle() yields a Buffer holding an NSView*.
// ARC forbids casting the raw byte pointer to an ObjC pointer type directly,
// so copy the pointer value out and bridge it without ownership transfer.
static NSView* ViewFromHandle(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsBuffer()) return nil;
  auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) return nil;
  void* handle = nullptr;
  std::memcpy(&handle, buffer.Data(), sizeof(handle));
  return (__bridge NSView*)handle;
}

// setCornerRadius(handle: Buffer, radius: number): boolean
// A radius of 0 restores square corners (used while fullscreen).
static Napi::Value SetCornerRadius(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSView* contentView = ViewFromHandle(info);
  NSWindow* window = contentView.window;
  if (!window || info.Length() < 2 || !info[1].IsNumber()) {
    return Napi::Boolean::New(env, false);
  }
  const double radius = info[1].As<Napi::Number>().DoubleValue();

  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  contentView.wantsLayer = YES;
  contentView.layer.cornerRadius = radius;
  contentView.layer.cornerCurve = kCACornerCurveContinuous;
  contentView.layer.masksToBounds = radius > 0;
  [window invalidateShadow];

  return Napi::Boolean::New(env, true);
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setCornerRadius", Napi::Function::New(env, SetCornerRadius));
  return exports;
}

NODE_API_MODULE(macos_window_effects, Init)
