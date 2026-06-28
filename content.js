console.log("[LowTime] content script loaded");

let board;

const LOW_TIME_SECONDS = 30;
const PADDING = 20; // 20px canvas padding on all sides
let overlayContainer = null;
let intervalId = null;
let initialized = false;
let lastSoundTime = {};
let currentSeconds = null; // Track current seconds for Three.js animation speed

// Three.js variables
let renderer, scene, camera, boxMesh, uniforms, displacement;

/* ---------------- FIRE CSS REMOVED / ONLY BASIC OVERLAY CONTAINER ---------------- */
const style = document.createElement("style");
style.textContent = `
/* Three.js Absolute Overlay Container */
#threejs-overlay-container {
    position: absolute;
    z-index: -5;
    display: none;
    pointer-events: none; 
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
    const rect = board.getBoundingClientRect();

    // Canvas is larger to give room for the animations to spill over
    const expandedWidth = rect.width + (PADDING * 2);
    const expandedHeight = rect.height + (PADDING * 2);

    // 1. Setup Orthographic Camera mapping 1:1 with the canvas container size
    camera = new THREE.OrthographicCamera(
        -expandedWidth / 2,  // Left
        expandedWidth / 2,   // Right
        expandedHeight / 2,  // Top
        -expandedHeight / 2, // Bottom
        1,                   // Near
        1000                 // Far
    );
    camera.position.z = 500;

    scene = new THREE.Scene();

    // 2. The 3D Mesh matches the original board size exactly, leaving 20px padding inside the canvas boundaries
    const segments = 40;
    const geometry = new THREE.BoxGeometry(rect.width, rect.height, 20, segments, segments, segments);

    // 3. Populate custom displacement array for every vertex
    const numVertices = geometry.attributes.position.count;
    displacement = new Float32Array(numVertices);

    for (let i = 0; i < numVertices; i++) {
        displacement[i] = Math.random() * 15;
    }

    geometry.setAttribute('displacement', new THREE.BufferAttribute(displacement, 1));

    // 4. Uniforms configuration
    uniforms = {
        amplitude: { value: 1.0 },
        color: { value: new THREE.Color(0x81B64C) }
    };

    // 5. Shaders handling vertex protrusion along normals
    const vertexShader = `
        uniform float amplitude;
        attribute float displacement;
        varying vec3 vNormal;
        
        void main() {
            vNormal = normal;
            vec3 newPosition = position + normal * displacement * amplitude;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
    `;

    const fragmentShader = `
        uniform vec3 color;
        varying vec3 vNormal;
        
        void main() {
            vec3 light = vec3(0.5, 0.2, 1.0);
            light = normalize(light);
            float dProd = max(0.1, dot(vNormal, light));
            
            gl_FragColor = vec4(color * dProd, 1.0);
        }
    `;

    // 6. Create Material and Mesh
    const shaderMaterial = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        wireframe: false
    });

    boxMesh = new THREE.Mesh(geometry, shaderMaterial);
    scene.add(boxMesh);

    // 7. Setup WebGL Renderer matching canvas size
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(expandedWidth, expandedHeight);
    container.appendChild(renderer.domElement);

    animateThreeJS();
}

function animateThreeJS() {
    requestAnimationFrame(animateThreeJS);
    if (!boxMesh) return;

    const time = Date.now() * 0.001;

    boxMesh.rotation.y = 0;
    boxMesh.rotation.x = 0;

    // Dynamically adjust speeds based on remaining seconds
    let speedModifier = 1.0;
    let intensityModifier = 1.0;

    if (currentSeconds !== null && currentSeconds <= LOW_TIME_SECONDS) {
        if (currentSeconds <= 10) {
            speedModifier = 4.0;      // Super fast spikes
            intensityModifier = 1.8;  // Taller spikes
        } else if (currentSeconds <= 20) {
            speedModifier = 2.5;      // Fast spikes
            intensityModifier = 1.4;
        } else if (currentSeconds <= 25) {
            speedModifier = 1.5;      // Medium spikes
            intensityModifier = 1.1;
        } else {
            speedModifier = 0.8;      // Slow, subtle spikes
            intensityModifier = 0.7;
        }
    }

    // Apply speed modifiers to vertex waves and scaling amplitudes
    uniforms.amplitude.value = (0.5 + Math.sin(time * 2.0 * speedModifier) * 0.3) * intensityModifier;

    const attribute = boxMesh.geometry.attributes.displacement;
    for (let i = 0; i < attribute.count; i++) {
        attribute.array[i] += Math.sin(i + time * 5 * speedModifier) * 0.5 * speedModifier;
        if (attribute.array[i] > 25) attribute.array[i] = 10;
        if (attribute.array[i] < 0) attribute.array[i] = 10;
    }
    attribute.needsUpdate = true;

    renderer.render(scene, camera);
}

/* ---------------- OVERLAY ---------------- */
function createOverlay(board) {
    // ThreeJS Container aligned over the board
    const threeContainer = document.createElement("div");
    threeContainer.id = "threejs-overlay-container";

    document.body.appendChild(threeContainer);
    positionOverlay(threeContainer, board);

    initThreeJS(threeContainer);

    return threeContainer;
}

function positionOverlay(el, board) {
    const rect = board.getBoundingClientRect();

    // Position HTML container 20px wider and higher than the board, perfectly centered
    el.style.left = (rect.left + window.scrollX - PADDING) + "px";
    el.style.top = (rect.top + window.scrollY - PADDING) + "px";
    el.style.width = (rect.width + (PADDING * 2)) + "px";
    el.style.height = (rect.height + (PADDING * 2)) + "px";
}

/* ---------------- RE-POSITION AND SCALE ON WINDOW RESIZE ---------------- */
window.addEventListener('resize', () => {
    if (board && initialized && overlayContainer) {
        positionOverlay(overlayContainer, board);

        const rect = board.getBoundingClientRect();
        const expandedWidth = rect.width + (PADDING * 2);
        const expandedHeight = rect.height + (PADDING * 2);

        if (renderer && camera && boxMesh) {
            renderer.setSize(expandedWidth, expandedHeight);

            // Update orthographic camera bounds dynamically
            camera.left = -expandedWidth / 2;
            camera.right = expandedWidth / 2;
            camera.top = expandedHeight / 2;
            camera.bottom = -expandedHeight / 2;
            camera.updateProjectionMatrix();

            // Re-size geometry to match original board dimensions precisely
            boxMesh.geometry.dispose();
            boxMesh.geometry = new THREE.BoxGeometry(rect.width, rect.height, 20, 40, 40, 40);

            // Re-populate custom displacement for the new geometry sizes
            const numVertices = boxMesh.geometry.attributes.position.count;
            displacement = new Float32Array(numVertices);
            for (let i = 0; i < numVertices; i++) {
                displacement[i] = Math.random() * 15;
            }
            boxMesh.geometry.setAttribute('displacement', new THREE.BufferAttribute(displacement, 1));
        }
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

        if (currentSeconds !== null && currentSeconds <= LOW_TIME_SECONDS) {
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