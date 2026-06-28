console.log("[LowTime] content script loaded");

let board

const LOW_TIME_SECONDS = 30;
let overlay = null;
let intervalId = null;
let initialized = false;
let lastSoundTime = {};

// Three.js variables
let renderer, scene, camera, boxMesh, uniforms, displacement;

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
@keyframes fireSubtle {
  0% { box-shadow: 0 0 6px 2px rgba(255, 69, 0, 0.4); }
  50% { box-shadow: 0 0 16px 6px rgba(255, 140, 0, 0.4); }
  100% { box-shadow: 0 0 6px 2px rgba(255, 69, 0, 0.4); }
}
@keyframes fireMedium {
  0% { box-shadow: 0 0 10px 4px #ff4500; }
  50% { box-shadow: 0 0 28px 12px #ffa500; }
  100% { box-shadow: 0 0 10px 4px #ff4500; }
}
@keyframes fireFast {
  0% { box-shadow: 0 0 14px 6px #ff4500; }
  50% { box-shadow: 0 0 40px 18px #ffa500; }
  100% { box-shadow: 0 0 14px 6px #ff4500; }
}
@keyframes fireIntense {
  0% { box-shadow: 0 0 18px 8px #ff4500; }
  50% { box-shadow: 0 0 50px 24px #ffa500; }
  100% { box-shadow: 0 0 18px 8px #ff4500; }
}

/* Three.js Centered Canvas Container */
#threejs-overlay-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;  
    height: 100%; 
    z-index: 5;
    pointer-events: none; 
    display: none;
}
`;
document.head.appendChild(style);

/* ---------------- THREE.JS INITIALIZATION ---------------- */
function initThreeJS(container) {
    // 1. Setup Camera and Scene
    camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    camera.position.z = 350;

    scene = new THREE.Scene();

    // 2. Create a highly subdivided Box Geometry (Rectangle)
    // Width, Height, Depth, followed by segment counts (64x64x64 creates thousands of vertices for spikes)
    const width = 140;
    const height = 140;
    const depth = 20;
    const segments = 40;
    const geometry = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);

    // 3. Populate custom displacement array for every vertex
    const numVertices = geometry.attributes.position.count;
    displacement = new Float32Array(numVertices);

    for (let i = 0; i < numVertices; i++) {
        // Random baseline length for each spike
        displacement[i] = Math.random() * 15;
    }

    // Attach custom attribute to the geometry
    geometry.setAttribute('displacement', new THREE.BufferAttribute(displacement, 1));

    // 4. Uniforms configuration
    uniforms = {
        amplitude: { value: 1.0 },
        color: { value: new THREE.Color(0x81B64C) } // Deep blue look matching your example image
    };

    // 5. Shaders handling vertex protrusion along normals
    const vertexShader = `
        uniform float amplitude;
        attribute float displacement;
        varying vec3 vNormal;
        
        void main() {
            vNormal = normal;
            // Push the vertex outward along the surface normal
            vec3 newPosition = position + normal * displacement * amplitude;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
    `;

    const fragmentShader = `
        uniform vec3 color;
        varying vec3 vNormal;
        
        void main() {
            // Light vector to give 3D depth map shadows to the spikes
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

    // 7. Setup WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);

    let rectWidth = 400
    let rectHeight = 400

    if (board) {
        const rect = board.getBoundingClientRect();
        rectWidth = rect.width + 100;
        rectHeight = rect.height + 100;
    }
    renderer.setSize(rectWidth, rectHeight);
    container.appendChild(renderer.domElement);

    animateThreeJS();
}

function animateThreeJS() {
    requestAnimationFrame(animateThreeJS);
    if (!boxMesh) return;

    const time = Date.now() * 0.001;

    // Slowly rotate the spiky box
    // boxMesh.rotation.y = time * 0.3;
    // boxMesh.rotation.x = time * 0.2;

    boxMesh.rotation.y = 0
    boxMesh.rotation.x = 0

    // Change the overall scale pulse of the spikes over time
    uniforms.amplitude.value = 0.5 + Math.sin(time * 2.0) * 0.3;

    // Dynamically update individual spikes to make them dance and ripple
    const attribute = boxMesh.geometry.attributes.displacement;
    for (let i = 0; i < attribute.count; i++) {
        attribute.array[i] += Math.sin(i + time * 5) * 0.5;
        // Bound checking
        if (attribute.array[i] > 25) attribute.array[i] = 10;
        if (attribute.array[i] < 0) attribute.array[i] = 10;
    }
    // Flag to Three.js that data mutated
    attribute.needsUpdate = true;

    renderer.render(scene, camera);
}

/* ---------------- OVERLAY ---------------- */
function createOverlay(board) {
    // 1. Board Fire Overlay
    const el = document.createElement("div");
    el.id = "low-time-fire-overlay";
    el.hidden = true;

    Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        borderRadius: "6px",
        zIndex: "-5",
        willChange: "box-shadow"
    });

    document.body.appendChild(el);
    positionOverlay(el, board);

    // 2. Centered ThreeJS Container
    const threeContainer = document.createElement("div");
    threeContainer.id = "threejs-overlay-container";
    document.body.appendChild(threeContainer);

    initThreeJS(threeContainer);

    return el;
}

function positionOverlay(el, board) {
    const rect = board.getBoundingClientRect();
    el.style.left = rect.left + "px";
    el.style.top = rect.top + "px";
    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
    el.style.position = "absolute";
    el.style.zIndex = "-1";
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
    overlay = createOverlay(board);

    let previousTime = null;

    intervalId = setInterval(() => {
        const clocks = document.querySelectorAll('.clock-component.clock-bottom span');
        const threeContainer = document.getElementById("threejs-overlay-container");

        if (!clocks.length) {
            console.log("[LowTime] game ended, stopping");
            clearInterval(intervalId);
            overlay?.remove();
            threeContainer?.remove();
            initialized = false;
            return;
        }

        const seconds = getMyClockSeconds();

        if (previousTime !== seconds) {
            if (seconds !== null && seconds <= LOW_TIME_SECONDS) {
                playSoundForSeconds(seconds);
            }
            previousTime = seconds;
        }

        if (seconds !== null && seconds <= LOW_TIME_SECONDS) {
            overlay.hidden = false;
            if (threeContainer) threeContainer.style.display = "block";

            if (seconds <= 10) {
                overlay.style.animationName = "fireIntense";
                overlay.style.animationDuration = "0.15s";
            } else if (seconds <= 20) {
                overlay.style.animationName = "fireFast";
                overlay.style.animationDuration = "0.25s";
            } else if (seconds <= 25) {
                overlay.style.animationName = "fireMedium";
                overlay.style.animationDuration = "0.40s";
            } else {
                overlay.style.animationName = "fireSubtle";
                overlay.style.animationDuration = "0.60s";
            }
        } else {
            overlay.hidden = true;
            if (threeContainer) threeContainer.style.display = "none";
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