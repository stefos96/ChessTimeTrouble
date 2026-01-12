console.log("[LowTime] content script loaded");

const LOW_TIME_SECONDS = 30;
let overlay = null;
let intervalId = null;
let initialized = false;

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

/* ---------------- CLOCK ---------------- */

function getMyClockSeconds() {
    const clocks = document.querySelectorAll('[data-cy="clock-time"]');
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

    intervalId = setInterval(() => {
        const clocks = document.querySelectorAll('[data-cy="clock-time"]');
        if (!clocks.length) {
            console.log("[LowTime] game ended, stopping");
            clearInterval(intervalId);
            overlay?.remove();
            initialized = false;
            return;
        }

        // positionOverlay(overlay, board);

        const seconds = getMyClockSeconds();

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