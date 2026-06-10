module.exports =
  process.platform === 'darwin'
    ? require('./build/Release/macos_window_effects.node')
    : { setCornerRadius: () => false }
