console.log("[LowTime] content script loaded");

let board;

const LOW_TIME_SECONDS = 30;
let overlayContainer = null;
let intervalId = null;
let initialized = false;
let lastSoundTime = {};
let currentSeconds = null;

// Three.js variables
let renderer, scene, camera, particleSystem, uniforms;

/* ---------------- FULL-WINDOW CANVAS OVERLAY ---------------- */
const style = document.createElement("style");
style.textContent = `
#threejs-overlay-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -5;
    display: none;
    pointer-events: none; 
}
#threejs-overlay-container canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
}
`;
document.head.appendChild(style);

/* ---------------- TIME PARSING ---------------- */
function parseTime(text) {
    if (!text) return null;
    const match = text.trim().match(/(\d+):(\d+)/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/* ---------------- THREE.JS INITIALIZATION ---------------- */
function initThreeJS(container) {
    if (!board) return;

    camera = new THREE.OrthographicCamera(
        -window.innerWidth / 2,
        window.innerWidth / 2,
        window.innerHeight / 2,
        -window.innerHeight / 2,
        1,
        1000
    );
    camera.position.z = 500;

    scene = new THREE.Scene();

    // Grid Dimensions
    const rows = 50;
    const cols = 50;
    const thickness = 5;
    const particleCount = (rows * cols) - ((rows - thickness * 2) * (cols - thickness * 2));

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const gridCoords = new Float32Array(particleCount * 2);

    let index = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const isBorder = r < thickness || r >= rows - thickness || c < thickness || c >= cols - thickness;

            if (isBorder) {
                const normX = (c / (cols - 1)) - 0.5;
                const normY = (r / (rows - 1)) - 0.5;

                gridCoords[index * 2] = normX;
                gridCoords[index * 2 + 1] = normY;

                positions[index * 3] = 0;
                positions[index * 3 + 1] = 0;
                positions[index * 3 + 2] = 0;
                index++;
            }
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('gridCoord', new THREE.BufferAttribute(gridCoords, 2));

    uniforms = {
        color: { value: new THREE.Color(0x81B64C) },
        pointSize: { value: window.devicePixelRatio * 3.5 }
    };

    const vertexShader = `
        uniform float pointSize;
        void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = pointSize;
        }
    `;

    const fragmentShader = `
        uniform vec3 color;
        void main() {
            gl_FragColor = vec4(color, 1.0);
        }
    `;

    const shaderMaterial = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthTest: false
    });

    particleSystem = new THREE.Points(geometry, shaderMaterial);
    scene.add(particleSystem);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    updateMeshPositionAndScale();
    animateThreeJS();
}

let targetWidth = 0;
let targetHeight = 0;
let targetCenterX = 0;
let targetCenterY = 0;

function updateMeshPositionAndScale() {
    if (!board || !particleSystem) return;

    const rect = board.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const padding = 20;
    targetWidth = rect.width + padding;
    targetHeight = rect.height + padding;

    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    const boardCenterX = rect.left + (rect.width / 2);
    const boardCenterY = rect.top + (rect.height / 2);

    targetCenterX = boardCenterX - screenCenterX;
    targetCenterY = screenCenterY - boardCenterY;
}

function animateThreeJS() {
    requestAnimationFrame(animateThreeJS);
    if (!particleSystem) return;

    const time = Date.now() * 0.001;

    // Default: Smooth, gentle fluid motion
    let speedModifier = 2.0;
    let intensityModifier = 0.03;
    let waveFrequency = 12.0; // Controls how tightly packed the wavy ripples are

    if (currentSeconds !== null && currentSeconds <= LOW_TIME_SECONDS) {
        if (currentSeconds <= 10) {
            speedModifier = 7.5;       // Fast, high-tension elastic snap
            intensityModifier = 0.09;  // Heavy displacement
            waveFrequency = 20.0;      // Erratic, tightly grouped ripples
        } else if (currentSeconds <= 20) {
            speedModifier = 5.5;
            intensityModifier = 0.07;
            waveFrequency = 16.0;
        } else if (currentSeconds <= 25) {
            speedModifier = 3.8;
            intensityModifier = 0.05;
            waveFrequency = 14.0;
        } else if (currentSeconds <= 30) {
            speedModifier = 2.8;
            intensityModifier = 0.04;
            waveFrequency = 13.0;
        } else {
            speedModifier = 2.3;
            intensityModifier = 0.035;
            waveFrequency = 12.5;
        }
    }

    const geometry = particleSystem.geometry;
    const positions = geometry.attributes.position.array;
    const gridCoords = geometry.attributes.gridCoord.array;
    const count = geometry.attributes.position.count;

    for (let i = 0; i < count; i++) {
        const normX = gridCoords[i * 2];
        const normY = gridCoords[i * 2 + 1];

        // Determine particle's distance from the absolute core center (0,0) to map the wave gradient
        const distanceFromCenter = Math.sqrt(normX * normX + normY * normY);

        // Elastic Wave Equation: combines time progression with a spatial distance offset
        // Subtracting 'distanceFromCenter * waveFrequency' creates a ripple that travels outward
        const wave = Math.sin(time * speedModifier - distanceFromCenter * waveFrequency);

        // Dynamic elasticity factor applied uniquely to each grid point
        const elasticBreathFactor = 1.0 + wave * intensityModifier;

        // Apply grid coordinates transformed by the unique ripple factor and center it onto the board
        positions[i * 3]     = (normX * targetWidth * elasticBreathFactor) + targetCenterX;
        positions[i * 3 + 1] = (normY * targetHeight * elasticBreathFactor) + targetCenterY;
        positions[i * 3 + 2] = 0;
    }

    geometry.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
}

/* ---------------- OVERLAY SETUP ---------------- */
function createOverlay(board) {
    const threeContainer = document.createElement("div");
    threeContainer.id = "threejs-overlay-container";
    document.body.appendChild(threeContainer);

    initThreeJS(threeContainer);
    return threeContainer;
}

/* ---------------- WINDOW RESIZE HANDLING ---------------- */
window.addEventListener('resize', () => {
    if (initialized && renderer && camera) {
        renderer.setSize(window.innerWidth, window.innerHeight);

        camera.left = -window.innerWidth / 2;
        camera.right = window.innerWidth / 2;
        camera.top = window.innerHeight / 2;
        camera.bottom = -window.innerHeight / 2;
        camera.updateProjectionMatrix();

        updateMeshPositionAndScale();
    }
});

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

function playBeep() { playTone(800, 0.15, 'sine', 0.3); }
function playWarning() {
    playTone(600, 0.1, 'sine', 0.3);
    setTimeout(() => playTone(900, 0.1, 'sine', 0.3), 110);
}
function playTick() { playTone(1200, 0.05, 'sine', 0.2); }

function playSoundForSeconds(seconds) {
    chrome.storage.sync.get({ soundEnabled: true }, (items) => {
        if (!items.soundEnabled) return;
        const now = Date.now();
        if (seconds % 10 === 0 && (!lastSoundTime['beep'] || now - lastSoundTime['beep'] > 500)) {
            playBeep();
            lastSoundTime['beep'] = now;
        }
        if (seconds === 30 && (!lastSoundTime['warning'] || now - lastSoundTime['warning'] > 500)) {
            playWarning();
            lastSoundTime['warning'] = now;
        }
        if (seconds <= 10 && (!lastSoundTime['tick'] || now - lastSoundTime['tick'] > 900)) {
            playTick();
            lastSoundTime['tick'] = now;
        }
    });
}

function getMyClockSeconds() {
    const clocks = document.querySelectorAll('.clock-component.clock-bottom span');
    if (!clocks.length) return null;
    return parseTime(clocks[clocks.length - 1].textContent);
}

/* ---------------- MAIN LOOP ---------------- */
function start(board) {
    if (initialized) return;
    initialized = true;

    console.log("[LowTime] board found", board);
    overlayContainer = createOverlay(board);

    let previousTime = null;

    intervalId = setInterval(() => {
        const clocks = document.querySelectorAll('.clock-component.clock-bottom span');

        if (!clocks.length) {
            console.log("[LowTime] game ended, stopping");
            clearInterval(intervalId);
            overlayContainer?.remove();
            initialized = false;
            currentSeconds = null;
            return;
        }

        currentSeconds = getMyClockSeconds();

        if (previousTime !== currentSeconds) {
            if (currentSeconds !== null && currentSeconds <= LOW_TIME_SECONDS) {
                playSoundForSeconds(currentSeconds);
            }
            previousTime = currentSeconds;
        }

        if (currentSeconds !== null) {
            updateMeshPositionAndScale();
            if (overlayContainer) overlayContainer.style.display = "block";
        } else {
            if (overlayContainer) overlayContainer.style.display = "none";
        }
    }, 250);
}

/* ---------------- OBSERVER ---------------- */
const observer = new MutationObserver(() => {
    board = document.querySelector("wc-chess-board, .board");
    if (board) {
        observer.disconnect();
        start(board);
    }
});

observer.observe(document.body, { childList: true, subtree: true });