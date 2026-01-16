let savedTweets = [];
let savedHash = '';
let savedScrollPos = 0;
let historyStack = [];
let scrollStack = [];
let forwardStack = [];
let forwardScrollStack = [];
let maxHistory = 10;
let debounceTimer;
let debounceDelay = 2000;
let backupInterval = 30000;
let saveScroll = true;
let db;

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('xundo', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('history');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e);
  });
}

async function loadFromDB() {
  try {
    db = await openDB();
    return new Promise(resolve => {
      const tx = db.transaction('history', 'readonly');
      const req = tx.objectStore('history').get('data');
      req.onsuccess = () => {
        if (req.result) {
          setTimeout(() => {
            const decompressed = LZString.decompress(req.result);
            resolve(decompressed ? JSON.parse(decompressed) : []);
          }, 0);
        } else resolve([]);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

function saveToDB() {
  if (!db) return;
  const data = maxHistory ? historyStack.slice(-maxHistory) : historyStack;
  const compressed = LZString.compress(JSON.stringify(data));
  const tx = db.transaction('history', 'readwrite');
  tx.objectStore('history').put(compressed, 'data');
}

async function init() {
  if (!browserAPI.runtime?.id) return;
  const settings = await browserAPI.storage.local.get(['maxHistory', 'interval', 'backupInterval', 'saveScroll']);
  maxHistory = parseInt(settings.maxHistory) || 0;
  debounceDelay = (parseFloat(settings.interval) || 2) * 1000;
  backupInterval = (parseInt(settings.backupInterval) || 30) * 1000;
  saveScroll = settings.saveScroll !== false;
  historyStack = await loadFromDB();
  observeTL();
  setInterval(saveToDB, backupInterval);
}

function getTweetIds() {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');
  return Array.from(tweets).map(t => {
    const link = t.querySelector('a[href*="/status/"]');
    return link?.href || '';
  }).filter(Boolean).join(',');
}

function observeTL() {
  let currentObserver = null;
  const tryObserve = () => {
    const tl = document.querySelector('[data-testid="primaryColumn"] section');
    if (tl && !tl.dataset.xundoObserved) {
      tl.dataset.xundoObserved = 'true';
      if (currentObserver) currentObserver.disconnect();
      currentObserver = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkAndSave, debounceDelay);
      });
      currentObserver.observe(tl, { childList: true, subtree: true });
      checkAndSave();
    }
    setTimeout(tryObserve, 1000);
  };
  tryObserve();
}

function checkAndSave() {
  if (!/^https:\/\/(x|twitter)\.com\/home/.test(location.href)) return;
  const hash = getTweetIds();
  if (hash && hash !== savedHash) {
    if (savedTweets.length > 0) {
      historyStack.push(savedTweets);
      scrollStack.push(savedScrollPos);
    }
    savedTweets = scrapeTweets();
    savedHash = hash;
    savedScrollPos = window.scrollY;
    forwardStack = [];
    forwardScrollStack = [];
    if (maxHistory && historyStack.length > maxHistory) {
      historyStack.shift();
      scrollStack.shift();
    }
    updateCounts();
  }
}

window.addEventListener('beforeunload', saveToDB);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveToDB();
});

init();

function scrapeTweets() {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');
  return Array.from(tweets).map(t => t.outerHTML);
}

function restore(tweets, scrollPos = 0) {
  const timeline = document.querySelector('[data-testid="primaryColumn"]');
  const container = timeline?.querySelector('section > div > div');
  if (container) {
    container.innerHTML = tweets.join('');
    container.querySelectorAll('img').forEach(img => {
      if (img.dataset.src) img.src = img.dataset.src;
      if (img.srcset === '') img.srcset = img.dataset.srcset || '';
      img.loading = 'eager';
    });
    container.querySelectorAll('[data-testid="tweet"]').forEach(el => {
      const link = el.querySelector('a[href*="/status/"]');
      if (!link) return;
      const url = link.href;
      el.querySelector('[data-testid="like"]')?.addEventListener('click', e => {
        e.stopPropagation();
        window.open(url, '_blank');
      });
      el.querySelector('[data-testid="reply"]')?.addEventListener('click', e => {
        e.stopPropagation();
        window.open(url, '_blank');
      });
      el.querySelector('[data-testid="retweet"]')?.addEventListener('click', e => {
        e.stopPropagation();
        window.open(url, '_blank');
      });
      el.style.cursor = 'pointer';
      el.onclick = () => window.location.href = url;
    });
    savedTweets = tweets;
    if (saveScroll) setTimeout(() => window.scrollTo(0, scrollPos), 100);
  }
}

function insertHeader() {
  if (!/^https:\/\/(x|twitter)\.com\/home/.test(location.href)) {
    document.getElementById('xundo-bar')?.remove();
    document.getElementById('xundo-dropdown')?.remove();
    return;
  }
  const header = document.querySelector('[data-testid="primaryColumn"] > div > div');
  if (!header) return;
  const h2 = document.querySelector('h2[role="heading"]');
  if (!h2) return;
  const textColor = getComputedStyle(h2).color;
  if (textColor === 'rgb(0, 0, 0)' && document.body.style.backgroundColor !== 'rgb(255, 255, 255)') return;
  const existing = document.getElementById('xundo-bar');
  if (existing) {
    existing.querySelectorAll('button').forEach(b => b.style.color = textColor);
    return;
  }
  const bar = document.createElement('div');
  bar.id = 'xundo-bar';
  const bg = getComputedStyle(document.querySelector('[data-testid="primaryColumn"]')).backgroundColor;
  const borderColor = '#536471';
  bar.style.cssText = `display:flex;border-bottom:1px solid ${borderColor};background:${bg};position:relative;`;
  bar.innerHTML = `<button id="xundo-back" style="flex:1;padding:12px;background:transparent;color:${textColor};border:none;border-right:1px solid ${borderColor};cursor:pointer;font-size:14px;text-align:center;">← 戻る (${historyStack.length})</button><button id="xundo-forward" style="flex:1;padding:12px;background:transparent;color:${textColor};border:none;border-right:1px solid ${borderColor};cursor:pointer;font-size:14px;text-align:center;">進む → (${forwardStack.length})</button><button id="xundo-search" style="padding:12px 16px;background:transparent;color:${textColor};border:none;cursor:pointer;font-size:14px;">🔍</button>`;
  header.after(bar);
  
  const dropdown = document.createElement('div');
  dropdown.id = 'xundo-dropdown';
  dropdown.style.cssText = `display:none;position:absolute;top:100%;left:0;right:50%;background:${bg};border:1px solid ${borderColor};border-radius:8px;max-height:300px;overflow-y:auto;z-index:9999;`;
  bar.appendChild(dropdown);

  const searchBox = document.createElement('div');
  searchBox.id = 'xundo-searchbox';
  searchBox.style.cssText = `display:none;position:absolute;top:100%;right:0;left:50%;background:${bg};border:1px solid ${borderColor};border-radius:8px;z-index:9999;`;
  searchBox.innerHTML = `<input type="text" id="xundo-search-input" placeholder="キーワード検索..." style="width:100%;padding:10px;border:none;border-bottom:1px solid ${borderColor};background:transparent;color:${textColor};box-sizing:border-box;outline:none;"><div id="xundo-search-results" style="max-height:250px;overflow-y:auto;"></div>`;
  bar.appendChild(searchBox);

  document.getElementById('xundo-back').onclick = (e) => {
    e.stopPropagation();
    if (historyStack.length === 0) return;
    const itemBg = bg;
    dropdown.innerHTML = historyStack.map((_, i) => 
      `<div class="xundo-item" data-index="${i}" style="padding:10px;cursor:pointer;border-bottom:1px solid ${borderColor};color:${textColor};background:${itemBg};">${historyStack.length - i}回前</div>`
    ).reverse().join('');
    dropdown.querySelectorAll('.xundo-item').forEach(item => {
      item.onmouseenter = () => item.style.opacity = '0.7';
      item.onmouseleave = () => item.style.opacity = '1';
    });
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  };
  
  dropdown.onclick = (e) => {
    const item = e.target.closest('.xundo-item');
    if (!item) return;
    const idx = parseInt(item.dataset.index);
    forwardStack.push(savedTweets);
    forwardScrollStack.push(window.scrollY);
    for (let i = historyStack.length - 1; i > idx; i--) {
      forwardStack.push(historyStack.pop());
      forwardScrollStack.push(scrollStack.pop());
    }
    const scrollPos = scrollStack.pop();
    restore(historyStack.pop(), scrollPos);
    dropdown.style.display = 'none';
    updateCounts();
  };

  document.getElementById('xundo-forward').onclick = () => {
    if (forwardStack.length === 0) return;
    historyStack.push(savedTweets);
    scrollStack.push(window.scrollY);
    const scrollPos = forwardScrollStack.pop();
    restore(forwardStack.pop(), scrollPos);
    updateCounts();
  };

  document.getElementById('xundo-search').onclick = (e) => {
    e.stopPropagation();
    dropdown.style.display = 'none';
    searchBox.style.display = searchBox.style.display === 'none' ? 'block' : 'none';
    if (searchBox.style.display === 'block') {
      document.getElementById('xundo-search-input').focus();
    }
  };

  document.getElementById('xundo-search-input').onclick = (e) => e.stopPropagation();
  
  document.getElementById('xundo-search-input').oninput = (e) => {
    const query = e.target.value.toLowerCase();
    const results = document.getElementById('xundo-search-results');
    if (!query) { results.innerHTML = ''; return; }
    
    const matches = [];
    historyStack.forEach((tweets, idx) => {
      tweets.forEach(html => {
        const text = html.replace(/<[^>]*>/g, '').toLowerCase();
        if (text.includes(query)) {
          const preview = html.replace(/<[^>]*>/g, '').slice(0, 50);
          matches.push({ idx, preview });
        }
      });
    });
    
    results.innerHTML = matches.slice(0, 20).map(m => 
      `<div class="xundo-search-item" data-index="${m.idx}" style="padding:10px;cursor:pointer;border-bottom:1px solid ${borderColor};color:${textColor};background:${bg};">${historyStack.length - m.idx}回前: ${m.preview}...</div>`
    ).join('') || `<div style="padding:10px;color:${textColor};">見つかりません</div>`;
    
    results.querySelectorAll('.xundo-search-item').forEach(item => {
      item.onmouseenter = () => item.style.opacity = '0.7';
      item.onmouseleave = () => item.style.opacity = '1';
      item.onclick = () => {
        const idx = parseInt(item.dataset.index);
        forwardStack.push(savedTweets);
        forwardScrollStack.push(window.scrollY);
        for (let i = historyStack.length - 1; i > idx; i--) {
          forwardStack.push(historyStack.pop());
          forwardScrollStack.push(scrollStack.pop());
        }
        const scrollPos = scrollStack.pop();
        restore(historyStack.pop(), scrollPos);
        searchBox.style.display = 'none';
        updateCounts();
      };
    });
  };
  
  document.addEventListener('click', () => { dropdown.style.display = 'none'; searchBox.style.display = 'none'; });
}

function updateCounts() {
  const back = document.getElementById('xundo-back');
  const forward = document.getElementById('xundo-forward');
  if (back) back.textContent = `← 戻る (${historyStack.length})`;
  if (forward) forward.textContent = `進む → (${forwardStack.length})`;
}

setInterval(updateCounts, 1000);

setInterval(insertHeader, 1000);

browserAPI.runtime.onMessage.addListener((msg) => {
  if (!browserAPI.runtime?.id) return;
  if (msg.command === 'undo') document.getElementById('xundo-back')?.click();
  if (msg.command === 'redo') document.getElementById('xundo-forward')?.click();
});
