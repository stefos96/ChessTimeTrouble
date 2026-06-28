console.log("[LowTime] content script loaded");

let board;

const LOW_TIME_SECONDS = 30;
let overlayContainer = null;
let intervalId = null;
let initialized = false;
let lastSoundTime = {};
let currentSeconds = null;

// Three.js variables
let renderer, scene, camera, particleSystem, scatteredGlowSystem, uniforms, scatteredGlowUniforms;

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

    // 1. GENERATE CORE PARTICLES LAYER
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
        pointSize: { value: window.devicePixelRatio * 5.0 }
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
            vec2 centerDist = gl_PointCoord - vec2(0.5);
            float dist = length(centerDist);
            if (dist > 0.5) discard;
            float alpha = smoothstep(0.5, 0.1, dist);
            gl_FragColor = vec4(color, alpha);
        }
    `;

    const shaderMaterial = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending
    });

    particleSystem = new THREE.Points(geometry, shaderMaterial);
    scene.add(particleSystem);

    // 2. GENERATE SCATTERED AMORPHOUS BACKGROUND GLOW
    // This system creates highly scattered, softer particles positioned directly behind the main framework
    const scatterCount = 100;
    const scatteredGeo = new THREE.BufferGeometry();
    const scatterPositions = new Float32Array(scatterCount * 3);
    const scatterGridCoords = new Float32Array(scatterCount * 2);
    const scatterData = new Float32Array(scatterCount * 3); // custom offset X, offset Y, size/speed scaling

    for (let i = 0; i < scatterCount; i++) {
        // Tie to a random index selection from core grid parameters to balance it uniformly
        const targetCoreIndex = Math.floor(Math.random() * particleCount);
        scatterGridCoords[i * 2] = gridCoords[targetCoreIndex * 2];
        scatterGridCoords[i * 2 + 1] = gridCoords[targetCoreIndex * 2 + 1];

        scatterPositions[i * 3] = 0;
        scatterPositions[i * 3 + 1] = 0;
        scatterPositions[i * 3 + 2] = -10; // Placed firmly behind core point variables

        // Random dispersion parameters to build a nebulous shape profile
        scatterData[i * 3] = (Math.random() - 0.5) * 65.0;     // Offset X footprint spread
        scatterData[i * 3 + 1] = (Math.random() - 0.5) * 65.0; // Offset Y footprint spread
        scatterData[i * 3 + 2] = Math.random() * 0.6 + 0.6;    // Individual dynamic scale multiplier
    }

    scatteredGeo.setAttribute('position', new THREE.BufferAttribute(scatterPositions, 3));
    scatteredGeo.setAttribute('gridCoord', new THREE.BufferAttribute(scatterGridCoords, 2));
    scatteredGeo.setAttribute('scatterData', new THREE.BufferAttribute(scatterData, 3));

    scatteredGlowUniforms = {
        color: { value: new THREE.Color(0x81B64C) },
        pointSize: { value: window.devicePixelRatio * 200.0 } // Massive soft points to achieve bleeding
    };

    const scatterVertexShader = `
        attribute vec3 scatterData;
        uniform float pointSize;
        varying float vScale;

        void main() {
            vScale = scatterData.z;
            // Apply coordinates + structural random dispersion factors 
            vec3 scatteredPos = position + vec3(scatterData.xy, 0.0);
            vec4 mvPosition = modelViewMatrix * vec4(scatteredPos, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            
            // Generate variable sizing scaling conditions per element
            gl_PointSize = pointSize * vScale;
        }
    `;

    const scatterFragmentShader = `
        uniform vec3 color;
        varying float vScale;

        void main() {
            vec2 centerDist = gl_PointCoord - vec2(0.5);
            float dist = length(centerDist);
            if (dist > 0.5) discard;

            // Hyper-extended soft edge fallback mix to simulate atmospheric glow scattering
            float alpha = smoothstep(0.5, 0.0, dist) * (0.09 * vScale);

            gl_FragColor = vec4(color, alpha);
        }
    `;

    const scatteredGlowMaterial = new THREE.ShaderMaterial({
        uniforms: scatteredGlowUniforms,
        vertexShader: scatterVertexShader,
        fragmentShader: scatterFragmentShader,
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending
    });

    scatteredGlowSystem = new THREE.Points(scatteredGeo, scatteredGlowMaterial);
    scene.add(scatteredGlowSystem);

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
    if (!board) return;

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
    if (!particleSystem || !scatteredGlowSystem) return;

    const time = Date.now() * 0.001;

    // Default: Smooth, gentle fluid motion
    let speedModifier = 2.0;
    let intensityModifier = 0.03;
    let waveFrequency = 12.0;

    if (currentSeconds !== null && currentSeconds <= LOW_TIME_SECONDS) {
        if (currentSeconds <= 10) {
            speedModifier = 7.5;
            intensityModifier = 0.09;
            waveFrequency = 20.0;
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

    // 1. ANIMATE FOREGROUND PARTICLES
    const coreGeo = particleSystem.geometry;
    const corePositions = coreGeo.attributes.position.array;
    const coreGridCoords = coreGeo.attributes.gridCoord.array;
    const coreCount = coreGeo.attributes.position.count;

    for (let i = 0; i < coreCount; i++) {
        const normX = coreGridCoords[i * 2];
        const normY = coreGridCoords[i * 2 + 1];

        const distanceFromCenter = Math.sqrt(normX * normX + normY * normY);
        const wave = Math.sin(time * speedModifier - distanceFromCenter * waveFrequency);
        const elasticBreathFactor = 1.0 + wave * intensityModifier;

        corePositions[i * 3]     = (normX * targetWidth * elasticBreathFactor) + targetCenterX;
        corePositions[i * 3 + 1] = (normY * targetHeight * elasticBreathFactor) + targetCenterY;
    }
    coreGeo.attributes.position.needsUpdate = true;


    // 2. ANIMATE SCATTERED BACKGROUND GLOW (Now aligned with matching physical tracking spaces)
    const scatterGeo = scatteredGlowSystem.geometry;
    const scatterPositions = scatterGeo.attributes.position.array;
    const scatterGridCoords = scatterGeo.attributes.gridCoord.array;
    const scatterData = scatterGeo.attributes.scatterData.array;
    const scatterCount = scatterGeo.attributes.position.count;

    // Controls how far out the light breaks past the hard edge limits of the board
    const scatterSpread = 60.0;

    for (let i = 0; i < scatterCount; i++) {
        const normX = scatterGridCoords[i * 2];
        const normY = scatterGridCoords[i * 2 + 1];
        const individualScale = scatterData[i * 3 + 2];

        const distanceFromCenter = Math.sqrt(normX * normX + normY * normY);

        // Slightly desynchronize individual motion speeds to break up hard shapes
        const wave = Math.sin(time * (speedModifier * 0.8) - distanceFromCenter * (waveFrequency * individualScale));
        const elasticBreathFactor = 1.0 + wave * (intensityModifier * 1.3);

        // Corrected calculation combining correct board dimensions, scaling, offsets, and global positioning parameters
        scatterPositions[i * 3]     = (normX * (targetWidth + scatterSpread) * elasticBreathFactor) + targetCenterX;
        scatterPositions[i * 3 + 1] = (normY * (targetHeight + scatterSpread) * elasticBreathFactor) + targetCenterY;
    }
    scatterGeo.attributes.position.needsUpdate = true;

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