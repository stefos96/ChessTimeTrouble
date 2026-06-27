console.log("[LowTime] content script loaded");

const LOW_TIME_SECONDS = 30;
let overlay = null;
let intervalId = null;
let initialized = false;
let lastSoundTime = {}; // Track last sound played for each sound type

/* ---------------- TIME PARSING ---------------- */

function parseTime(text) {
    if (!text) return null;
    const match = text.trim().match(/(\d+):(\d+)/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/* ---------------- FIRE CSS ---------------- */

const style = document.createElement("style");
style.textContent = `
@keyframes firePulse {
  0% {
    box-shadow:
      0 0 8px 3px #ff4500,
      0 0 16px 6px #ff6a00,
      0 0 26px 10px rgba(255, 140, 0, 0.8);
  }
  50% {
    box-shadow:
      0 0 12px 4px #ff6a00,
      0 0 22px 8px #ffa500,
      0 0 36px 14px rgba(255, 69, 0, 0.9);
  }
  100% {
    box-shadow:
      0 0 8px 3px #ff4500,
      0 0 16px 6px #ff6a00,
      0 0 26px 10px rgba(255, 140, 0, 0.8);
  }
}
`;
document.head.appendChild(style);

/* ---------------- OVERLAY ---------------- */

function createOverlay(board) {
    const el = document.createElement("div");
    el.id = "low-time-fire-overlay";
    el.hidden = true;

    Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        borderRadius: "6px",
        zIndex: "9999",
        animation: "firePulse 0.35s infinite alternate",
        willChange: "box-shadow"
    });

    document.body.appendChild(el);
    positionOverlay(el, board);
    return el;
}

function positionOverlay(el, board) {
    const rect = board.getBoundingClientRect();
    el.style.left = rect.left + "px";
    el.style.top = rect.top + "px";
    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
}

/* ---------------- SOUND SYSTEM ---------------- */

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playTone(frequency, duration, type = 'sine', volume = 0.3) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}

function playBeep() {
    // Standard beep: 800Hz for 150ms
    playTone(800, 0.15, 'sine', 0.3);
}

function playWarning() {
    // Unique warning at 30 seconds: two ascending tones
    playTone(600, 0.1, 'sine', 0.3);
    setTimeout(() => playTone(900, 0.1, 'sine', 0.3), 110);
}

function playTick() {
    // Clock ticking sound: short high-pitched beep
    playTone(1200, 0.05, 'sine', 0.2);
}

function playSoundForSeconds(seconds) {
    // Check if sound is enabled in settings
    chrome.storage.sync.get({ soundEnabled: true }, (items) => {
        if (!items.soundEnabled) return;
        
        const now = Date.now();
        
        // Every 10 seconds in the main window (60-50, 40-50, etc.)
        if (seconds % 10 === 0 && (!lastSoundTime['beep'] || now - lastSoundTime['beep'] > 500)) {
            playBeep();
            lastSoundTime['beep'] = now;
        }
        
        // Unique sound at exactly 30 seconds
        if (seconds === 30 && (!lastSoundTime['warning'] || now - lastSoundTime['warning'] > 500)) {
            playWarning();
            lastSoundTime['warning'] = now;
        }
        
        // Ticking sound every second when <= 10 seconds
        if (seconds <= 10 && (!lastSoundTime['tick'] || now - lastSoundTime['tick'] > 900)) {
            playTick();
            lastSoundTime['tick'] = now;
        }
    });
}

/* ---------------- CLOCK ---------------- */

function getMyClockSeconds() {
    const clocks = document.querySelectorAll('.clock-component.clock-bottom span');

    if (!clocks.length) return null;

    // bottom clock = player clock
    return parseTime(clocks[clocks.length - 1].textContent);
}

/* ---------------- MAIN LOOP ---------------- */

function start(board) {
    if (initialized) return;
    initialized = true;

    console.log("[LowTime] board found", board);

    overlay = createOverlay(board);

    let previousTime = null;

    intervalId = setInterval(() => {
        const clocks = document.querySelectorAll('.clock-component.clock-bottom span');
        if (!clocks.length) {
            console.log("[LowTime] game ended, stopping");
            clearInterval(intervalId);
            overlay?.remove();
            initialized = false;
            return;
        }

        // positionOverlay(overlay, board);

        const seconds = getMyClockSeconds();
        console.log(seconds)

        if (previousTime !== seconds) {
            // Play sounds based on time intervals
            if (seconds !== null && seconds <= LOW_TIME_SECONDS) {
                playSoundForSeconds(seconds);
            }

            previousTime = seconds;
        }

        if (seconds !== null && seconds <= LOW_TIME_SECONDS) {
            overlay.hidden = false;

            // 🔥 Increase intensity under 10 seconds
            overlay.style.animationDuration =
                seconds <= 10 ? "0.20s" : "0.35s";
        } else {
            overlay.hidden = true;
        }
    }, 250);
}

/* ---------------- OBSERVER ---------------- */

const observer = new MutationObserver(() => {
    const board = document.querySelector("wc-chess-board, .board");
    if (board) {
        observer.disconnect();
        start(board);
    }
});

observer.observe(document.body, { childList: true, subtree: true });