/* PixelTriks sample plugin — the smallest useful example.
   Load it from Controls & plugins (⌘K → "Controls"), or from the console:
     GF.plugins.add('./plugins/hello.js')
   The default export receives the GF namespace. Registering a command makes
   it appear in the command palette immediately; bind() gives it a shortcut. */
export default function (GF) {
  GF.commands.register({
    id: 'plugin.hello',
    title: 'Hello from a plugin 👋',
    group: 'Plugins',
    run: () => GF.util.toast('👋 Hello! This action came from plugins/hello.js'),
  });
  GF.commands.rebind('mod+shift+h', 'plugin.hello');
}
