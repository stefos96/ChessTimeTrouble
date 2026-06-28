const soundToggle = document.getElementById('soundToggle');
const glowColorPicker = document.getElementById('glowColorPicker');

// Load saved settings on popup open
chrome.storage.sync.get({ soundEnabled: true, glowColor: '#81B64C' }, (items) => {
    soundToggle.classList.toggle('enabled', items.soundEnabled);
    glowColorPicker.value = items.glowColor;
});

// Toggle sound setting on click
soundToggle.addEventListener('click', () => {
    soundToggle.classList.toggle('enabled');
    const isEnabled = soundToggle.classList.contains('enabled');
    chrome.storage.sync.set({ soundEnabled: isEnabled });
});

// Save color when user selects a new one
glowColorPicker.addEventListener('input', (e) => {
    const selectedColor = e.target.value;
    chrome.storage.sync.set({ glowColor: selectedColor });
});