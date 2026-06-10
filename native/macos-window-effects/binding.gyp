{
  "targets": [
    {
      "target_name": "macos_window_effects",
      "sources": ["src/effects.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc"],
        "OTHER_LDFLAGS": ["-framework AppKit", "-framework QuartzCore"],
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      }
    }
  ]
}
