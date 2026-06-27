const soundToggle = document.getElementById('soundToggle');

// Load saved setting on popup open
chrome.storage.sync.get({ soundEnabled: true }, (items) => {
    soundToggle.classList.toggle('enabled', items.soundEnabled);
});

// Toggle sound setting on click
soundToggle.addEventListener('click', () => {
    soundToggle.classList.toggle('enabled');
    const isEnabled = soundToggle.classList.contains('enabled');
    
    // Save to Chrome storage
    chrome.storage.sync.set({ soundEnabled: isEnabled });
    
    console.log('[LowTime] Sound alerts:', isEnabled ? 'enabled' : 'disabled');
});
