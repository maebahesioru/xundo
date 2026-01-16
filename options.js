const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

function i18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = browserAPI.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
}
i18n();

const input = document.getElementById('maxHistory');
const intervalInput = document.getElementById('interval');
const backupInput = document.getElementById('backupInterval');
const saveScrollInput = document.getElementById('saveScroll');
browserAPI.storage.local.get(['maxHistory', 'interval', 'backupInterval', 'saveScroll'], d => {
  input.value = d.maxHistory ?? 0;
  intervalInput.value = d.interval ?? 2;
  backupInput.value = d.backupInterval ?? 30;
  saveScrollInput.checked = d.saveScroll !== false;
});
document.getElementById('save').onclick = () => {
  browserAPI.storage.local.set({ 
    maxHistory: parseInt(input.value) || 0,
    interval: Math.max(0.1, parseFloat(intervalInput.value) || 2),
    backupInterval: Math.max(10, parseInt(backupInput.value) || 30),
    saveScroll: saveScrollInput.checked
  }, () => {
    document.getElementById('status').textContent = ' ' + (browserAPI.i18n.getMessage('saved') || 'Saved');
  });
};
document.getElementById('shortcuts').onclick = (e) => {
  e.preventDefault();
  browserAPI.tabs.create({ url: 'chrome://extensions/shortcuts' });
};

document.getElementById('clear').onclick = () => {
  if (!confirm(browserAPI.i18n.getMessage('clearConfirm') || 'Delete all history?')) return;
  const req = indexedDB.open('xundo', 1);
  req.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').clear();
    document.getElementById('clearStatus').textContent = ' ' + (browserAPI.i18n.getMessage('cleared') || 'Cleared');
    loadStats();
  };
};

function loadStats() {
  const req = indexedDB.open('xundo', 1);
  req.onupgradeneeded = (e) => e.target.result.createObjectStore('history');
  req.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('history', 'readonly');
    const store = tx.objectStore('history');
    const getReq = store.get('data');
    getReq.onsuccess = () => {
      const stats = document.getElementById('stats');
      if (!getReq.result) {
        stats.innerHTML = `
          <div class="stat-item"><div class="stat-value">0</div><div class="stat-label">履歴</div></div>
          <div class="stat-item"><div class="stat-value">0</div><div class="stat-label">ツイート</div></div>
          <div class="stat-item"><div class="stat-value">0 KB</div><div class="stat-label">使用量</div></div>
        `;
        return;
      }
      const compressed = getReq.result;
      const sizeKB = (compressed.length * 2 / 1024).toFixed(1);
      try {
        const decompressed = LZString.decompress(compressed);
        const history = decompressed ? JSON.parse(decompressed) : [];
        const totalTweets = history.reduce((sum, h) => sum + h.length, 0);
        stats.innerHTML = `
          <div class="stat-item"><div class="stat-value">${history.length}</div><div class="stat-label">履歴</div></div>
          <div class="stat-item"><div class="stat-value">${totalTweets}</div><div class="stat-label">ツイート</div></div>
          <div class="stat-item"><div class="stat-value">${sizeKB} KB</div><div class="stat-label">使用量</div></div>
        `;
      } catch {
        stats.innerHTML = `
          <div class="stat-item"><div class="stat-value">-</div><div class="stat-label">履歴</div></div>
          <div class="stat-item"><div class="stat-value">-</div><div class="stat-label">ツイート</div></div>
          <div class="stat-item"><div class="stat-value">${sizeKB} KB</div><div class="stat-label">使用量</div></div>
        `;
      }
    };
  };
}
loadStats();
