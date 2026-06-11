{
  "targets": [
    {
      "target_name": "macos_window_effects",
      "sources": ["src/effects.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "conditions": [
        [
          "OS=='mac' and target_arch=='arm64'",
          {
            "xcode_settings": {
              "OTHER_CPLUSPLUSFLAGS": ["-arch x86_64"],
              "OTHER_LDFLAGS": ["-arch x86_64"]
            }
          }
        ],
        [
          "OS=='mac' and target_arch=='x64'",
          {
            "xcode_settings": {
              "OTHER_CPLUSPLUSFLAGS": ["-arch arm64"],
              "OTHER_LDFLAGS": ["-arch arm64"]
            }
          }
        ]
      ],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc"],
        "OTHER_LDFLAGS": ["-framework AppKit", "-framework QuartzCore"],
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      }
    }
  ]
}
