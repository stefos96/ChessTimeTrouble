console.log("[LowTime] content script loaded");

let board;

const LOW_TIME_SECONDS = 30;
let overlayContainer = null;
let intervalId = null;
let initialized = false;
let lastSoundTime = {};
let currentSeconds = null;

// Three.js variables
let renderer, scene, camera, boxMesh, uniforms, displacement;

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

    const geometry = new THREE.SphereGeometry(1, 64, 64);

    const numVertices = geometry.attributes.position.count;
    displacement = new Float32Array(numVertices);
    for (let i = 0; i < numVertices; i++) {
        displacement[i] = Math.random() * 15;
    }
    geometry.setAttribute('displacement', new THREE.BufferAttribute(displacement, 1));

    uniforms = {
        amplitude: { value: 1.0 },
        color: { value: new THREE.Color(0x81B64C) }
    };

    const vertexShader = `
        uniform float amplitude;
        attribute float displacement;
        varying vec3 vNormal;
        
        void main() {
            vNormal = normal;
            vec3 direction = normalize(position);
            vec3 newPosition = position + direction * (displacement * amplitude * 0.05);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
    `;

    const fragmentShader = `
        uniform vec3 color;
        varying vec3 vNormal;
        
        void main() {
            vec3 light = vec3(0.5, 0.2, 1.0);
            light = normalize(light);
            float dProd = max(0.2, dot(vNormal, light));
            gl_FragColor = vec4(color * dProd, 1.0);
        }
    `;

    const shaderMaterial = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        wireframe: false
    });

    boxMesh = new THREE.Mesh(geometry, shaderMaterial);
    scene.add(boxMesh);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    updateMeshPositionAndScale();

    animateThreeJS();
}

// Moved calculations out of RAF loop to avoid triggering chess engine state lockups
function updateMeshPositionAndScale() {
    if (!board || !boxMesh) return;

    const rect = board.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // Guard against hidden elements

    boxMesh.scale.set(rect.width / 2, rect.height / 2, 10);

    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    const boardCenterX = rect.left + (rect.width / 2);
    const boardCenterY = rect.top + (rect.height / 2);

    boxMesh.position.x = boardCenterX - screenCenterX;
    boxMesh.position.y = screenCenterY - boardCenterY;
}

function animateThreeJS() {
    requestAnimationFrame(animateThreeJS);
    if (!boxMesh) return;

    const time = Date.now() * 0.001;

    // Default: Smooth, slow idle breathing for times > 30 seconds
    let speedModifier = 0.5;
    let intensityModifier = 0.6;

    if (currentSeconds !== null && currentSeconds <= LOW_TIME_SECONDS) {
        if (currentSeconds <= 10) {
            speedModifier = 4.0;
            intensityModifier = 1.8;
        } else if (currentSeconds <= 20) {
            speedModifier = 2.5;
            intensityModifier = 1.4;
        } else if (currentSeconds <= 25) {
            speedModifier = 1.5;
            intensityModifier = 1.1;
        } else if (currentSeconds <= 30) {
            speedModifier = 1.4;
            intensityModifier = 1.08;
        } else if (currentSeconds <= 40) {
            speedModifier = 1.35;
            intensityModifier = 1.05;
        } else {
            speedModifier = 1.3;
            intensityModifier = 1.0;
        }
    }

    // Set the baseline scale pulsation via uniforms
    uniforms.amplitude.value = (0.5 + Math.sin(time * 2.0 * speedModifier) * 0.3) * intensityModifier;

    const attribute = boxMesh.geometry.attributes.displacement;
    for (let i = 0; i < attribute.count; i++) {
        if (currentSeconds > 40) {
            // Calm, uniform breathing rhythm applied to ALL vertices equally (No jagged spikes!)
            // It uses a shifting sine wave so it behaves like an inflating/deflating clean sphere
            attribute.array[i] = 4.0 + Math.sin(time * 1.5) * 1.5;
        } else if (currentSeconds > 30 && currentSeconds <= 40) {
            attribute.array[i] += Math.sin(i + time * 2 * speedModifier) * 0.5 * speedModifier;
            if (attribute.array[i] > 25) attribute.array[i] = 8;
            if (attribute.array[i] < 0) attribute.array[i] = 8;
        } else {
            // Standard chaotic spike logic during low time
            attribute.array[i] += Math.sin(i + time * 5 * speedModifier) * 0.5 * speedModifier;
            if (attribute.array[i] > 25) attribute.array[i] = 10;
            if (attribute.array[i] < 0) attribute.array[i] = 10;
        }
    }
    attribute.needsUpdate = true;

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
            // Safely verify and update positions every quarter second rather than every frame
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