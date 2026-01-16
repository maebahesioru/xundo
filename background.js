const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

browserAPI.runtime.onMessage.addListener((msg) => {
  if (msg.openOptions) browserAPI.runtime.openOptionsPage();
});

browserAPI.action.onClicked.addListener(() => {
  browserAPI.runtime.openOptionsPage();
});

browserAPI.commands.onCommand.addListener((command, tab) => {
  browserAPI.tabs.sendMessage(tab.id, { command });
});
