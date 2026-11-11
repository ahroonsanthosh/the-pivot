/* Wearable APS Sim: parts library, threats, environments and editor schema.
 *
 * Every part carries:
 *   rating   0-10 final-product suitability (null = not rated). Research novelty earns nothing.
 *   note     the reason behind the rating
 *   est      list of field keys that are planning estimates, not vendor numbers
 *   src      source links
 * Units: mass g, power W, cost EUR, lengths mm unless the field says otherwise.
 * Add parts here (or in the in-page library editor and export the JSON).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.APSCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

/* ------------------------------------------------------------------ categories and editor schema */
const LEVELS = [
  ["none", "Not rated / no protection"],
  ["fragment", "Fragments only"],
  ["handgun", "Handgun rounds (NIJ IIIA class)"],
  ["rifle", "Rifle rounds (NIJ III class)"],
  ["heavy", "Heavy MG / AP (beyond personal armour)"],
  ["never", "Not defeatable by a worn element"],
];

const COMMON_FIELDS = [
  { k: "name", label: "Name", type: "text" },
  { k: "vendor", label: "Vendor or origin", type: "text" },
  { k: "rating", label: "Final-product rating", unit: "/10", type: "num", min: 0, max: 10, step: 1, nullable: true },
  { k: "note", label: "Reason for rating", type: "textarea" },
  { k: "desc", label: "Role in the system", type: "textarea" },
  { k: "shortlist", label: "Retained as product candidate", type: "bool" },
  { k: "mass", label: "Mass", unit: "g", type: "num", min: 0, step: 0.1 },
  { k: "power", label: "Power while running", unit: "W", type: "num", min: 0, step: 0.05 },
  { k: "cost", label: "Unit cost", unit: "€", type: "num", min: 0, step: 1 },
  { k: "dims", label: "Dimensions", unit: "mm", type: "text" },
];

const CATEGORIES = {
  camera: {
    label: "Cameras", one: "Camera", color: "--accent",
    fields: [
      { k: "band", label: "Sensing type", type: "sel", opts: [["vis", "Visible / NIR frame camera"], ["lwir", "Thermal LWIR microbolometer"], ["event", "Event camera"]] },
      { k: "iface", label: "Interface", type: "sel", opts: [["usb3", "USB3"], ["mipi", "MIPI CSI-2"], ["usb2", "USB2"]] },
      { k: "hres", label: "Horizontal pixels", type: "num", min: 16, step: 1 },
      { k: "vres", label: "Vertical pixels", type: "num", min: 16, step: 1 },
      { k: "fps", label: "Frame rate at full resolution", unit: "fps", type: "num", min: 1, step: 1, hide: (p) => p.band === "event" },
      { k: "fpsMax", label: "Frame rate ceiling with ROI", unit: "fps", type: "num", min: 1, step: 1, hide: (p) => p.band === "event" },
      { k: "bits", label: "Bits per pixel streamed", unit: "bit", type: "num", min: 1, step: 1 },
      { k: "pitch", label: "Pixel pitch", unit: "µm", type: "num", min: 0.5, step: 0.01 },
      { k: "noise", label: "Relative noise σ (0.1 ms, daylight, f/2)", type: "num", min: 0.0005, step: 0.0005, help: "Per-pixel noise as a fraction of background signal. LWIR: NETD-equivalent, light-independent." },
      { k: "minExpUs", label: "Shortest exposure", unit: "µs", type: "num", min: 1, step: 1, hide: (p) => p.band !== "vis" },
      { k: "tauMs", label: "Thermal time constant", unit: "ms", type: "num", min: 0.1, step: 0.1, hide: (p) => p.band !== "lwir" },
      { k: "latUs", label: "Pixel latency", unit: "µs", type: "num", min: 1, step: 1, hide: (p) => p.band !== "event" },
      { k: "evThresh", label: "Contrast threshold", type: "num", min: 0.01, step: 0.01, hide: (p) => p.band !== "event" },
      { k: "bgRate", label: "Background noise events", unit: "Hz/px", type: "num", min: 0, step: 0.01, hide: (p) => p.band !== "event" },
      { k: "evRate", label: "Event rate while walking", unit: "Mev/s", type: "num", min: 0, step: 0.5, hide: (p) => p.band !== "event" },
      { k: "outLatMs", label: "Camera output latency", unit: "ms", type: "num", min: 0, step: 0.5, help: "Delay inside the camera before a frame leaves it (e.g. thermal cores)." },
      { k: "linkGbps", label: "Usable link per camera", unit: "Gbps", type: "num", min: 0.01, step: 0.1 },
    ],
  },
  lens: {
    label: "Lenses", one: "Lens", color: "--sensor",
    fields: [
      { k: "band", label: "Waveband", type: "sel", opts: [["vis", "Visible / NIR (M12, CS, C)"], ["lwir", "LWIR germanium"]] },
      { k: "hfov", label: "Horizontal field of view", unit: "°", type: "num", min: 2, max: 170, step: 1 },
      { k: "fno", label: "f-number", type: "num", min: 0.7, step: 0.1 },
      { k: "eta", label: "Energy in peak pixel", type: "num", min: 0.05, max: 1, step: 0.01, help: "Fraction of a point target's light landing in its brightest pixel (blur, sub-pixel phase)." },
    ],
  },
  radar: {
    label: "Radars", one: "Radar", color: "--radar",
    fields: [
      { k: "mode", label: "Output", type: "sel", opts: [["tracker", "Continuous tracker (bearing + range)"], ["presence", "Point cloud / presence"], ["chronograph", "Shot record (chronograph)"]] },
      { k: "ballistic", label: "Waveform built for ballistic targets", type: "bool", help: "If false, fast targets smear across range bins and lose coherent gain." },
      { k: "freq", label: "Centre frequency", unit: "GHz", type: "num", min: 1, step: 0.5 },
      { k: "bw", label: "Chirp bandwidth", unit: "GHz", type: "num", min: 0.001, step: 0.05 },
      { k: "tcUs", label: "Chirp period", unit: "µs", type: "num", min: 1, step: 1 },
      { k: "chirps", label: "Chirp loops per frame", type: "num", min: 1, step: 1 },
      { k: "tx", label: "TX channels (TDM)", type: "num", min: 1, step: 1 },
      { k: "rx", label: "RX channels", type: "num", min: 1, step: 1 },
      { k: "frameHz", label: "Frame rate", unit: "Hz", type: "num", min: 0.1, step: 1 },
      { k: "rRef", label: "Detection range on a 1 m² target", unit: "m", type: "num", min: 0.1, step: 0.5 },
      { k: "procMs", label: "Processing to output", unit: "ms", type: "num", min: 0, step: 0.5 },
      { k: "fovAz", label: "Field of view, azimuth half-angle", unit: "°", type: "num", min: 1, max: 90, step: 1 },
      { k: "fovEl", label: "Field of view, elevation half-angle", unit: "°", type: "num", min: 1, max: 90, step: 1 },
      { k: "bearingErr", label: "Bearing error (1σ)", unit: "°", type: "num", min: 0, step: 0.5 },
      { k: "confirm", label: "Frames to confirm a track", type: "num", min: 1, step: 1 },
      { k: "farH", label: "False cues per hour (alone)", unit: "/h", type: "num", min: 0, step: 1 },
    ],
  },
  compute: {
    label: "Compute", one: "Compute", color: "--sensor",
    fields: [
      { k: "usbGbps", label: "Usable USB3 bandwidth (all ports)", unit: "Gbps", type: "num", min: 0, step: 0.5 },
      { k: "csiPorts", label: "MIPI CSI camera ports", type: "num", min: 0, step: 1 },
      { k: "pixRate", label: "Detection throughput", unit: "Mpx/s", type: "num", min: 1, step: 10, help: "Pixels per second the frame-differencing pipeline sustains." },
      { k: "baseLatMs", label: "Fixed processing latency", unit: "ms", type: "num", min: 0, step: 0.1 },
      { k: "enclosure", label: "Enclosure and cooling mass", unit: "g", type: "num", min: 0, step: 5 },
      { k: "gpio", label: "Can drive actuators directly", type: "bool" },
    ],
  },
  controller: {
    label: "Controllers", one: "Controller", color: "--ok",
    fields: [
      { k: "latMs", label: "Cue-in to output latency", unit: "ms", type: "num", min: 0, step: 0.05 },
      { k: "provides", label: "Drive outputs (comma list: pwm, gpio)", type: "list" },
      { k: "mcu", label: "Microcontroller family", type: "text" },
    ],
  },
  driver: {
    label: "Drivers & firmware", one: "Driver", color: "--ok",
    fields: [
      { k: "latMs", label: "Added latency", unit: "ms", type: "num", min: 0, step: 0.05 },
      { k: "provides", label: "Drive outputs (comma list: pwm, step, dc)", type: "list" },
      { k: "needsMcu", label: "Only runs on this MCU family (blank = any)", type: "text" },
    ],
  },
  actuator: {
    label: "Actuators", one: "Actuator", color: "--resp",
    fields: [
      { k: "kind", label: "Kind", type: "sel", opts: [["servo", "Rotary servo"], ["stepper", "Stepper motor"], ["linear", "Linear actuator"]] },
      { k: "drive", label: "Needs drive signal", type: "sel", opts: [["pwm", "PWM / RC servo"], ["step", "Step / direction"], ["dc", "DC H-bridge"]] },
      { k: "speed", label: "Speed (°/s rotary, mm/s linear)", type: "num", min: 0.1, step: 1 },
      { k: "accel", label: "Acceleration limit (°/s², steppers)", type: "num", min: 0, step: 100 },
      { k: "range", label: "Travel (° rotary, mm linear)", type: "num", min: 1, step: 1 },
      { k: "deadMs", label: "Dead time before motion", unit: "ms", type: "num", min: 0, step: 0.5 },
      { k: "posErr", label: "Positioning error (° or mm)", type: "num", min: 0, step: 0.1 },
      { k: "idleW", label: "Holding / idle power", unit: "W", type: "num", min: 0, step: 0.05 },
      { k: "force", label: "Torque N·m or force N", type: "num", min: 0, step: 0.01 },
    ],
  },
  structure: {
    label: "Structure", one: "Structure", color: "--resp",
    fields: [
      { k: "role", label: "Role", type: "sel", opts: [["frame", "Turret frame"], ["gearing", "Bearing / gearing"]] },
      { k: "slew", label: "Slew range of the frame", unit: "°", type: "num", min: 0, max: 360, step: 1 },
      { k: "ratio", label: "Gear reduction (output slower by)", type: "num", min: 0.1, step: 0.1 },
      { k: "posErr", label: "Added pointing error", unit: "°", type: "num", min: 0, step: 0.1 },
    ],
  },
  pneumatic: {
    label: "Pneumatics", one: "Pneumatic part", color: "--resp",
    fields: [
      { k: "role", label: "Role", type: "sel", opts: [["source", "Pressure source"], ["valve", "Valve"], ["line", "Line / hose"]] },
      { k: "bar", label: "Delivered pressure", unit: "bar", type: "num", min: 0, step: 0.5 },
      { k: "deadMs", label: "Opening / transit delay", unit: "ms", type: "num", min: 0, step: 0.5 },
      { k: "duty", label: "Duty cycle while running", type: "num", min: 0, max: 1, step: 0.01 },
    ],
  },
  shield: {
    label: "Protective elements", one: "Protective element", color: "--bad",
    fields: [
      { k: "w", label: "Width", unit: "mm", type: "num", min: 10, step: 10 },
      { k: "h", label: "Height", unit: "mm", type: "num", min: 10, step: 10 },
      { k: "areal", label: "Areal density", unit: "kg/m²", type: "num", min: 0.01, step: 0.1 },
      { k: "level", label: "Stops", type: "sel", opts: LEVELS },
    ],
  },
};
const CATEGORY_ORDER = ["camera", "lens", "radar", "compute", "controller", "driver", "actuator", "structure", "pneumatic", "shield"];

const THREAT_FIELDS = [
  { k: "name", label: "Name", type: "text" },
  { k: "short", label: "Short label", type: "text" },
  { k: "group", label: "Group", type: "sel", opts: [["small", "Small arms"], ["explosive", "Explosive / indirect"], ["aerial", "Aerial"], ["ref", "Reference"]] },
  { k: "v0", label: "Muzzle / launch speed", unit: "m/s", type: "num", min: 1, step: 1 },
  { k: "powered", label: "Powered (no drag slowdown)", type: "bool" },
  { k: "mass", label: "Projectile mass", unit: "g", type: "num", min: 0.1, step: 0.1 },
  { k: "d", label: "Presented diameter", unit: "mm", type: "num", min: 0.5, step: 0.1 },
  { k: "cd", label: "Drag coefficient", type: "num", min: 0, step: 0.01 },
  { k: "rmin", label: "Firing distance, min", unit: "m", type: "num", min: 1, step: 1 },
  { k: "rmax", label: "Firing distance, max", unit: "m", type: "num", min: 1, step: 1 },
  { k: "elMin", label: "Arrival elevation, min", unit: "°", type: "num", min: -60, max: 85, step: 1 },
  { k: "elMax", label: "Arrival elevation, max", unit: "°", type: "num", min: -60, max: 85, step: 1 },
  { k: "cVis", label: "Visible contrast", type: "num", min: 0, step: 0.05 },
  { k: "cIR", label: "Thermal contrast", type: "num", min: 0, step: 0.1 },
  { k: "rcs", label: "Radar cross-section, nose-on", unit: "m²", type: "num", min: 1e-7, step: 1e-5 },
  { k: "req", label: "Protection needed", type: "sel", opts: LEVELS },
  { k: "note", label: "Notes", type: "textarea" },
];

/* ------------------------------------------------------------------ parts */
const S = {
  tiDs: { label: "TI IWR6843AOP datasheet", url: "https://www.ti.com/lit/ds/symlink/iwr6843aop.pdf" },
  tiEvm: { label: "TI IWR6843AOPEVM", url: "https://www.ti.com/tool/IWR6843AOPEVM" },
  tiPeople: { label: "TI 3D people tracking guide", url: "https://dev.ti.com/tirex/explore/content/radar_toolbox_3_30_00_06/source/ti/examples/Industrial_and_Personal_Electronics/People_Tracking/3D_People_Tracking/docs/3d_people_tracking_user_guide.html" },
  ariel: { label: "Richter et al., Remote Sens. 17(4):650 (2025)", url: "https://doi.org/10.3390/rs17040650" },
  ariel2020: { label: "Balal et al., Sensors 20:3284 (2020)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7308985" },
  labradar: { label: "LabRadar LX review (SSUSA)", url: "https://ssusa.org/content/preview-labradar-lx-compact-shooting-chronograph" },
  garmin: { label: "Garmin Xero C1 Pro manual", url: "https://static.garmin.com/pumac/xeroc1pro_OM_EN-SG.pdf" },
  kurfs: { label: "RTX KuRFS", url: "https://www.rtx.com/en/raytheon/what-we-do/integrated-air-and-missile-defense/kurfs" },
  ximea: { label: "XIMEA MQ003MG-CM", url: "https://www.ximea.com/en/products/usb3-vision-cameras-xiq-line/mq003mg-cm" },
  daheng: { label: "Daheng MER2-160-227U3M datasheet (via VA Imaging)", url: "https://va-imaging.com/products/usb-camera-3-0-1-6mp-monochrome-sony-imx273-mer2-160-227u3m" },
  pigs: { label: "Raspberry Pi Global Shutter Camera", url: "https://www.raspberrypi.com/products/raspberry-pi-global-shutter-camera/" },
  imx296crop: { label: "IMX296 cropped frame rates (community)", url: "https://gist.github.com/Hermann-SW/e6049fe1a24fc2b5a53c654e0e9f6b9c" },
  ancile: { label: "LaRocco et al., ANCILE preprint (2025)", url: "https://doi.org/10.20944/preprints202512.1271.v1" },
  ancileJ: { label: "ANCILE, Int. J. Protective Structures (2026)", url: "https://doi.org/10.1177/20414196261450628" },
  boson: { label: "Teledyne FLIR Boson", url: "https://oem.flir.com/en-ca/products/boson/" },
  bosonTau: { label: "FLIR microbolometer time constant", url: "https://www.flir.com/en-gb/support/instruments2/what-is-the-response-time-for-flir-microbolometer-cameras-thermal-time-constant/" },
  genx: { label: "Prophesee GenX320", url: "https://www.prophesee.ai/event-based-sensor-genx320/" },
  evk4: { label: "Prophesee EVK4", url: "https://www.prophesee.ai/event-camera-evk4/" },
  orin: { label: "NVIDIA Jetson Orin Nano Super", url: "https://developer.nvidia.com/blog/nvidia-jetson-orin-nano-developer-kit-gets-a-super-boost/" },
  orinDs: { label: "Jetson Orin Nano series datasheet", url: "https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/5380/Jetson_Orin_Nano_Series_DS-11105-001_v1.1.pdf" },
  pi5: { label: "Raspberry Pi 5 product brief", url: "https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008348-DS-6-raspberry-pi-5-product-brief.pdf" },
  kria: { label: "AMD Kria K26 SOM", url: "https://docs.amd.com/r/en-US/ds987-k26-som/K26-SOM-Mechanical-Dimensions" },
  teensy: { label: "PJRC Teensy 4.1", url: "https://www.pjrc.com/store/teensy41.html" },
  uno: { label: "Arduino Uno R3 datasheet", url: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf" },
  pca: { label: "NXP PCA9685 datasheet", url: "https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf" },
  grbl: { label: "GRBL", url: "https://github.com/gnea/grbl" },
  bondtech: { label: "Bondtech NEMA17 25 mm datasheet", url: "https://www.bondtech.se/wp-content/uploads/2019/02/13003-Nema17-25mm.pdf" },
  actuonix: { label: "Actuonix L12 datasheet", url: "https://www.actuonix.com/assets/images/datasheets/ActuonixL12Datasheet.pdf" },
  robotx: { label: "Robot Extreme 12 V 50 mm actuator", url: "https://robotextreme.pt/product/atuador-linear-electrico-12v-50mm/" },
  sg90: { label: "TowerPro SG90", url: "https://www.towerpro.com.tw/product/sg90-7/" },
  nij: { label: "NIJ Standard 0101.06", url: "https://nij.ojp.gov/library/publications/ballistic-resistance-body-armor-nij-standard-010106" },
};

const PARTS = [
  /* ---------------- cameras */
  { cat: "camera", id: "xiq-mq003cg", name: "XIMEA xiQ MQ003CG-CM", vendor: "XIMEA", rating: 7, shortlist: true,
    note: "Approximately 26 g, compact, over 500 FPS. Limited 648 × 488 resolution.",
    desc: "CMOSIS CMV300 global shutter, 7.4 µm pixels, USB 3.1 Gen1. Best frame rate per gram; VGA limits pixel angle. Colour (Bayer) variant is about 40% noisier than mono. XIMEA lists the MQ003 as discontinued (EOL) and points to the MQ013 family.",
    band: "vis", iface: "usb3", hres: 648, vres: 488, fps: 500, fpsMax: 1000, bits: 8, pitch: 7.4, noise: 0.017, minExpUs: 20, outLatMs: 0, linkGbps: 3.2,
    mass: 26.4, power: 1.5, cost: 313, dims: "26.4 × 26.4 × 25.3", est: ["noise", "fpsMax", "minExpUs", "cost"], src: [S.ximea] },
  { cat: "camera", id: "xiq-mq003mg", name: "XIMEA xiQ MQ003MG-CM (mono)", vendor: "XIMEA", rating: null,
    note: "Mono variant of the rated xiQ. Not separately rated. Discontinued (EOL).",
    desc: "Same body as the rated xiQ without the Bayer filter: more light per pixel, full-resolution detection.",
    band: "vis", iface: "usb3", hres: 648, vres: 488, fps: 500, fpsMax: 1000, bits: 8, pitch: 7.4, noise: 0.012, minExpUs: 20, outLatMs: 0, linkGbps: 3.2,
    mass: 26.4, power: 1.5, cost: 313, dims: "26.4 × 26.4 × 25.3", est: ["noise", "fpsMax", "minExpUs", "cost"], src: [S.ximea] },
  { cat: "camera", id: "daheng-mer2-160", name: "Daheng MER2-160-227U3M", vendor: "Daheng Imaging", rating: 7, shortlist: true,
    note: "227 FPS, 1440 × 1080, global shutter, 65 g, industrial USB3 interface.",
    desc: "Sony IMX273 1.6 MP mono, 3.45 µm. Finer pixel angle means longer detection range, but slower frames and more bandwidth. ROI frame rates are not published.",
    band: "vis", iface: "usb3", hres: 1440, vres: 1080, fps: 227, fpsMax: 800, bits: 8, pitch: 3.45, noise: 0.02, minExpUs: 20, outLatMs: 0, linkGbps: 3.2,
    mass: 65, power: 1.7, cost: 240, dims: "29 × 29 × 29", est: ["noise", "fpsMax", "minExpUs"], src: [S.daheng] },
  { cat: "camera", id: "imx296-ancile", name: "Sony IMX296 module (ANCILE)", vendor: "Sony / Raspberry Pi", rating: 5,
    note: "Good commercial image sensor, but ANCILE's 140 FPS implementation was insufficient for its intended application.",
    desc: "1.6 MP global shutter on MIPI CSI-2 (Raspberry Pi Global Shutter Camera). 60 fps full frame; cropped strips reach about 400–536 fps. ANCILE processed at 140 fps.",
    band: "vis", iface: "mipi", hres: 1456, vres: 1088, fps: 60, fpsMax: 536, bits: 10, pitch: 3.45, noise: 0.022, minExpUs: 30, outLatMs: 0, linkGbps: 1.6,
    mass: 34, power: 0.6, cost: 50, dims: "38 × 38 × 19.8", est: ["power", "noise", "minExpUs", "linkGbps"], src: [S.pigs, S.imx296crop, S.ancile] },
  { cat: "camera", id: "flir-boson-640", name: "Teledyne FLIR Boson 640 (suggested)", vendor: "Teledyne FLIR", rating: null,
    note: "Suggested extra, not on the rated list. Export-controlled: non-US buyers often get the 9 Hz version.",
    desc: "12 µm uncooled LWIR core. Rounds heat in flight, so thermal contrast is high, but 60 Hz, a 7–12 ms bolometer time constant and up to 25 ms video latency make it slow.",
    band: "lwir", iface: "usb2", hres: 640, vres: 512, fps: 60, fpsMax: 60, bits: 8, pitch: 12, noise: 0.006, tauMs: 10, outLatMs: 20, linkGbps: 0.35,
    mass: 7.5, power: 0.5, cost: 3500, dims: "21 × 21 × 11 (core)", est: ["noise", "tauMs", "outLatMs", "linkGbps"], src: [S.boson, S.bosonTau] },
  { cat: "camera", id: "prophesee-genx320", name: "Prophesee GenX320 (suggested)", vendor: "Prophesee", rating: null,
    note: "Suggested extra, not on the rated list. Event pixels respond in under 150 µs; 3 g module, milliwatts.",
    desc: "320 × 320 event sensor on 1-lane MIPI. No frames: each pixel reports brightness changes as they happen.",
    band: "event", iface: "mipi", hres: 320, vres: 320, fps: 1, fpsMax: 1, bits: 32, pitch: 6.3, noise: 0.02, latUs: 150, evThresh: 0.25, bgRate: 0.2, evRate: 8, outLatMs: 0, linkGbps: 1.0,
    mass: 3, power: 0.023, cost: 370, dims: "3 × 4 die; OpenMV module", est: ["noise", "bgRate", "evRate", "evThresh", "linkGbps"], src: [S.genx] },
  { cat: "camera", id: "prophesee-evk4", name: "Prophesee EVK4 HD / IMX636 (suggested)", vendor: "Prophesee / Sony", rating: null,
    note: "Suggested extra, not on the rated list. Prophesee sells the EVK4 excluding military and defence industries; the IMX636 sensor itself would need another route.",
    desc: "1280 × 720 event sensor over USB3. Fine pixel angle with sub-millisecond response; event rate climbs fast when the wearer moves.",
    band: "event", iface: "usb3", hres: 1280, vres: 720, fps: 1, fpsMax: 1, bits: 32, pitch: 4.86, noise: 0.02, latUs: 220, evThresh: 0.2, bgRate: 0.1, evRate: 40, outLatMs: 0, linkGbps: 1.6,
    mass: 40, power: 0.5, cost: 5000, dims: "30 × 30 × 36", est: ["noise", "bgRate", "evRate", "evThresh"], src: [S.evk4] },

  /* ---------------- lenses */
  { cat: "lens", id: "m12-100", name: "M12 wide · 100°", vendor: "Generic", rating: null, note: "Commodity lens, not on the rated list.",
    desc: "Wide coverage per pod, coarse pixel angle.", band: "vis", hfov: 100, fno: 2.0, eta: 0.45, mass: 30, power: 0, cost: 35, est: ["mass", "cost", "eta"], src: [] },
  { cat: "lens", id: "m12-70", name: "M12 standard · 70°", vendor: "Generic", rating: null, note: "Commodity lens, not on the rated list.",
    desc: "Middle ground between coverage and range.", band: "vis", hfov: 70, fno: 2.0, eta: 0.5, mass: 32, power: 0, cost: 35, est: ["mass", "cost", "eta"], src: [] },
  { cat: "lens", id: "m12-40", name: "M12 narrow · 40°", vendor: "Generic", rating: null, note: "Commodity lens, not on the rated list.",
    desc: "Long detection range per pod; needs many pods for full coverage.", band: "vis", hfov: 40, fno: 2.4, eta: 0.55, mass: 38, power: 0, cost: 40, est: ["mass", "cost", "eta"], src: [] },
  { cat: "lens", id: "cs-25", name: "CS-mount tele · 25°", vendor: "Generic", rating: null, note: "Commodity lens, not on the rated list.",
    desc: "Sector-watch lens for a forward-only pod.", band: "vis", hfov: 25, fno: 1.8, eta: 0.6, mass: 60, power: 0, cost: 70, est: ["mass", "cost", "eta"], src: [] },
  { cat: "lens", id: "ge-95", name: "Boson 4.9 mm compact · 95°", vendor: "Teledyne FLIR", rating: null, note: "Matched lens for the Boson core.",
    desc: "Wide thermal lens. Mass is the datasheet core-plus-lens figure minus the 7.5 g core.", band: "lwir", hfov: 95, fno: 1.1, eta: 0.45, mass: 12.5, power: 0, cost: 400, est: ["fno", "eta", "cost"], src: [S.boson] },
  { cat: "lens", id: "ge-50", name: "Boson 8.7 mm · 50°", vendor: "Teledyne FLIR", rating: null, note: "Matched lens for the Boson core.",
    desc: "Standard thermal lens. Heavy for its focal length.", band: "lwir", hfov: 50, fno: 1.0, eta: 0.5, mass: 62.5, power: 0, cost: 600, est: ["fno", "eta", "cost"], src: [S.boson] },
  { cat: "lens", id: "ge-32", name: "Boson 13.6 mm compact · 32°", vendor: "Teledyne FLIR", rating: null, note: "Matched lens for the Boson core.",
    desc: "Narrow, light thermal lens.", band: "lwir", hfov: 32, fno: 1.0, eta: 0.55, mass: 20.5, power: 0, cost: 700, est: ["hfov", "fno", "eta", "cost"], src: [S.boson] },

  /* ---------------- radars */
  { cat: "radar", id: "ti-iwr6843aop", name: "TI IWR6843AOP", vendor: "Texas Instruments", rating: 6, shortlist: true,
    note: "Excellent integration: 15 × 15 mm chip, integrated antennas, DSP and 3 TX / 4 RX. Ballistic capability unproven. The 6/10 is conditional on its suitability for the sensing function being established.",
    desc: "60–64 GHz antenna-on-package FMCW, ±60° × ±60°, 29° angular resolution. TI's AOP people-tracking config reaches 6 m (about 10 m in practice). Fast rounds smear across range bins, so treat it as an independent close-range cue.",
    mode: "presence", ballistic: false, freq: 62, bw: 3.6, tcUs: 50, chirps: 64, tx: 3, rx: 4, frameHz: 30, rRef: 10, procMs: 10, fovAz: 60, fovEl: 60,
    bearingErr: 10, confirm: 2, farH: 10, mass: 30, power: 2.5, cost: 190, dims: "15 × 15 chip; radar area under 15 × 36 on the EVM",
    est: ["tcUs", "chirps", "procMs", "bearingErr", "confirm", "farH", "mass", "bw"], src: [S.tiDs, S.tiEvm, S.tiPeople] },
  { cat: "radar", id: "ariel-wband-2025", name: "Ariel 2025 W-band research radar", vendor: "Ariel University (research)", rating: 3,
    note: "Actual bullet tracking demonstrated, but no documented compact commercial package.",
    desc: "CW Doppler at W-band (94–100 GHz), 1 RX + 2 TX, processed offline with an adaptive STFT. Narrow horn-lens beam (6.5° on the 2020 rig); detection began only a few metres out. Not real-time as published.",
    mode: "tracker", ballistic: true, freq: 94, bw: 0.02, tcUs: 250, chirps: 1, tx: 2, rx: 1, frameHz: 4000, rRef: 60, procMs: 3, fovAz: 3.5, fovEl: 3.5,
    bearingErr: 2, confirm: 2, farH: 2, mass: 3000, power: 40, cost: 25000, dims: "lab rig, horn-lens antennas",
    est: ["rRef", "frameHz", "procMs", "bearingErr", "confirm", "farH", "mass", "power", "cost", "bw", "tcUs"], src: [S.ariel, S.ariel2020] },
  { cat: "radar", id: "labradar-lx", name: "LabRadar LX", vendor: "LabRadar", rating: 3,
    note: "Excellent compact commercial hardware; chronograph output is unsuitable for continuous spatial tracking.",
    desc: "61.2–61.4 GHz Doppler chronograph, 65–5,000 fps. Measures outgoing shots along its boresight and reports a shot record afterwards; gives no bearing.",
    mode: "chronograph", ballistic: true, freq: 61.3, bw: 0.22, tcUs: 100, chirps: 1, tx: 1, rx: 1, frameHz: 100, rRef: 900, procMs: 400, fovAz: 10, fovEl: 10,
    bearingErr: 90, confirm: 1, farH: 0, mass: 326, power: 2.0, cost: 560, dims: "64 × 70 × 70",
    est: ["tcUs", "frameHz", "rRef", "procMs", "fovAz", "fovEl", "power"], src: [S.labradar] },
  { cat: "radar", id: "garmin-xero-c1", name: "Garmin Xero C1 Pro", vendor: "Garmin", rating: 3,
    note: "Only 105.6 g and IPX7 rated, but shot-record interface rather than continuous tracking.",
    desc: "Doppler chronograph for outgoing shots (100–5,000 fps), 6 h battery. Velocity records only, no spatial track. Band not published; 24 GHz inferred.",
    mode: "chronograph", ballistic: true, freq: 24, bw: 0.1, tcUs: 100, chirps: 1, tx: 1, rx: 1, frameHz: 100, rRef: 700, procMs: 400, fovAz: 10, fovEl: 10,
    bearingErr: 90, confirm: 1, farH: 0, mass: 105.6, power: 1.5, cost: 560, dims: "77 × 60.5 × 34.4",
    est: ["freq", "bw", "tcUs", "frameHz", "rRef", "procMs", "fovAz", "fovEl", "power"], src: [S.garmin] },
  { cat: "radar", id: "raytheon-kurfs", name: "Raytheon KuRFS", vendor: "Raytheon (RTX)", rating: 2,
    note: "Actual ballistic detection, but military-scale packaging, not wearable.",
    desc: "Ku-band AESA with 360° coverage, about 1.2 m across on a pallet. Cues C-RAM, SHORAD and counter-UAS weapons; RTX claims small drones beyond 15 km. Mass and power are not published.",
    mode: "tracker", ballistic: true, freq: 15, bw: 0.5, tcUs: 20, chirps: 64, tx: 1, rx: 1, frameHz: 50, rRef: 40000, procMs: 30, fovAz: 60, fovEl: 45,
    bearingErr: 0.5, confirm: 2, farH: 0.5, mass: 150000, power: 3000, cost: 2000000, dims: "≈1.2 m aperture (pallet)",
    est: ["bw", "tcUs", "chirps", "frameHz", "rRef", "procMs", "fovAz", "fovEl", "bearingErr", "confirm", "farH", "mass", "power", "cost"], src: [S.kurfs] },

  /* ---------------- compute */
  { cat: "compute", id: "orin-nano-super-15", name: "Jetson Orin Nano Super · 15 W", vendor: "NVIDIA", rating: 5, shortlist: true,
    note: "Powerful, but developer kit is bulky and consumes 7–25 W.",
    desc: "Dev kit (176 g): 4 × USB 3.2 Gen2 sharing UPHY lanes, two CSI connectors. CUDA frame differencing across every pod; the heaviest power line item.",
    usbGbps: 8, csiPorts: 2, pixRate: 1100, baseLatMs: 2.0, enclosure: 80, gpio: true,
    mass: 176, power: 15, cost: 384.48, dims: "100 × 79 × 21", est: ["pixRate", "baseLatMs", "enclosure", "usbGbps"], src: [S.orin] },
  { cat: "compute", id: "orin-nano-super-25", name: "Jetson Orin Nano Super · 25 W MAXN", vendor: "NVIDIA", rating: 5, shortlist: true,
    note: "Powerful, but developer kit is bulky and consumes 7–25 W.",
    desc: "Same board in its highest power mode: more throughput, shorter runtime.",
    usbGbps: 8, csiPorts: 2, pixRate: 1800, baseLatMs: 1.5, enclosure: 80, gpio: true,
    mass: 176, power: 25, cost: 384.48, dims: "100 × 79 × 21", est: ["pixRate", "baseLatMs", "enclosure", "usbGbps"], src: [S.orin] },
  { cat: "compute", id: "orin-nano-module", name: "Orin Nano module on custom carrier (suggested)", vendor: "NVIDIA + custom", rating: null,
    note: "Suggested product path for the rated Orin: the 28 g module without dev-kit bulk. Not separately rated.",
    desc: "Bare 69.6 × 45 mm SO-DIMM module (28 g, 8 CSI lanes) on a purpose-built carrier with a flat heat spreader.",
    usbGbps: 8, csiPorts: 4, pixRate: 1100, baseLatMs: 2.0, enclosure: 40, gpio: true,
    mass: 55, power: 15, cost: 450, dims: "69.6 × 45 module", est: ["mass", "cost", "pixRate", "baseLatMs", "enclosure"], src: [S.orinDs] },
  { cat: "compute", id: "pi5", name: "Raspberry Pi 5", vendor: "Raspberry Pi", rating: 4,
    note: "Compact enough, but limited compared with newer edge-AI platforms.",
    desc: "Two USB 3.0 ports at 5 Gb/s each, two 4-lane MIPI ports. Fine for one slow camera; saturates quickly with several fast ones. Prices rose sharply in 2026.",
    usbGbps: 6, csiPorts: 2, pixRate: 150, baseLatMs: 6.0, enclosure: 40, gpio: true,
    mass: 50, power: 7, cost: 100, dims: "85 × 56", est: ["pixRate", "baseLatMs", "usbGbps", "cost", "enclosure"], src: [S.pi5] },
  { cat: "compute", id: "kria-k26", name: "AMD Kria K26 FPGA SOM (suggested)", vendor: "AMD", rating: null,
    note: "Suggested extra, not on the rated list. Streams frame differencing in fabric with sub-millisecond latency.",
    desc: "FPGA system-on-module, 58 g, 7.5 W typical / 15 W max: many MIPI lanes, deterministic pixel pipelines.",
    usbGbps: 5, csiPorts: 4, pixRate: 3000, baseLatMs: 0.3, enclosure: 50, gpio: true,
    mass: 58, power: 7.5, cost: 300, dims: "77 × 60 × 11", est: ["usbGbps", "csiPorts", "pixRate", "baseLatMs", "enclosure"], src: [S.kria] },
  { cat: "compute", id: "laptop", name: "Commercial laptop", vendor: "Any", rating: 1,
    note: "Development tool, not a wearable component.",
    desc: "Bench development host (ANCILE used one alongside its Pi 5). Included so bench results can be compared with wearable options.",
    usbGbps: 10, csiPorts: 0, pixRate: 2500, baseLatMs: 3.0, enclosure: 0, gpio: false,
    mass: 2000, power: 45, cost: 1500, dims: "laptop", est: ["usbGbps", "pixRate", "baseLatMs", "mass", "power", "cost"], src: [S.ancile] },

  /* ---------------- controllers */
  { cat: "controller", id: "teensy41", name: "Teensy 4.1", vendor: "PJRC", rating: 7, shortlist: true,
    note: "Small, mature microcontroller; useful for supporting electronics.",
    desc: "600 MHz Cortex-M7: status LEDs, haptic direction cue, event timestamps and actuator commands over high-speed USB.",
    latMs: 0.15, provides: ["pwm", "gpio"], mcu: "imxrt", mass: 14, power: 0.5, cost: 41.3, dims: "61 × 18", est: ["latMs"], src: [S.teensy] },
  { cat: "controller", id: "arduino-uno", name: "Arduino Uno R3", vendor: "Arduino", rating: 3,
    note: "Large relative to capability; dated architecture.",
    desc: "16 MHz ATmega328P behind a USB-serial bridge at 115200 baud. Adds serial latency; host for GRBL in ANCILE.",
    latMs: 2.0, provides: ["pwm", "gpio"], mcu: "atmega328p", mass: 25, power: 0.25, cost: 27, dims: "68.6 × 53.4", est: ["latMs", "power", "cost"], src: [S.uno] },
  { cat: "controller", id: "host-gpio", name: "Compute GPIO (no controller)", vendor: "—", rating: null,
    note: "Not a separate part. Linux GPIO timing jitter makes this a bench shortcut.",
    desc: "The compute board drives outputs itself.",
    latMs: 0.6, provides: ["pwm", "gpio"], mcu: "host", mass: 0, power: 0, cost: 0, dims: "—", est: ["latMs"], src: [] },

  /* ---------------- drivers */
  { cat: "driver", id: "direct", name: "Direct from controller pins", vendor: "—", rating: null,
    note: "No extra board.", desc: "Servo PWM straight from the controller's timers; a new pulse can start on demand.",
    latMs: 0.02, provides: ["pwm"], needsMcu: "", mass: 0, power: 0, cost: 0, dims: "—", est: [], src: [] },
  { cat: "driver", id: "pca9685", name: "PCA9685 16-ch PWM board", vendor: "NXP (breakout)", rating: 4,
    note: "Useful servo controller, but unnecessary development-board overhead for a dense product.",
    desc: "I²C PWM expander, 24–1526 Hz. New values take effect in the following PWM cycle: up to 20 ms at the 50 Hz servo rate, 10 ms on average.",
    latMs: 10.2, provides: ["pwm"], needsMcu: "", mass: 9, power: 0.05, cost: 8, dims: "62.5 × 25.4", est: ["power", "cost"], src: [S.pca] },
  { cat: "driver", id: "cnc-grbl", name: "CNC shield + GRBL firmware", vendor: "Generic / gnea", rating: 2,
    note: "GRBL 2/10: CNC-oriented software, not a finished-product control architecture. CNC shield 2/10: generic development board, not product-grade packaging.",
    desc: "A4988 step/dir drivers on an Uno shield, commanded with G-code at 115200 baud (30 kHz step ceiling). Jog commands need >10 ms segments, and the M8 coolant output that ANCILE used for its valve waits for queued moves to finish.",
    latMs: 20, provides: ["step"], needsMcu: "atmega328p", mass: 30, power: 0.2, cost: 15, dims: "69 × 53", est: ["latMs", "mass", "cost"], src: [S.grbl] },
  { cat: "driver", id: "tmc2209", name: "TMC2209 step/dir driver (suggested)", vendor: "Trinamic / ADI", rating: null,
    note: "Suggested extra, not on the rated list. Direct step/dir from the controller, no G-code layer.",
    desc: "Stepper driver commanded straight from the controller's timers.",
    latMs: 0.05, provides: ["step"], needsMcu: "", mass: 5, power: 0.1, cost: 10, dims: "20 × 15", est: ["latMs", "mass", "cost"], src: [] },
  { cat: "driver", id: "drv8871", name: "DRV8871 H-bridge (suggested)", vendor: "Texas Instruments", rating: null,
    note: "Suggested extra, not on the rated list. Needed for plain DC actuators.",
    desc: "3.6 A brushed-DC driver for 12 V linear actuators.",
    latMs: 0.05, provides: ["dc"], needsMcu: "", mass: 4, power: 0.05, cost: 8, dims: "25 × 20", est: ["latMs", "mass", "cost"], src: [] },

  /* ---------------- actuators */
  { cat: "actuator", id: "sg90", name: "TowerPro SG90", vendor: "TowerPro", rating: 2,
    note: "Only 9 g, but hobby-grade construction.",
    desc: "Micro RC servo: 0.1 s per 60° at 4.8 V, 1.8 kgf·cm, plastic gears and a wide deadband.",
    kind: "servo", drive: "pwm", speed: 600, accel: 0, range: 150, deadMs: 5, posErr: 2, idleW: 0.05, force: 0.176,
    mass: 9, power: 1.0, cost: 3, dims: "22.2 × 11.8 × 31", est: ["deadMs", "posErr", "power"], src: [S.sg90] },
  { cat: "actuator", id: "nema17-pancake", name: "BondTech NEMA17 Pancake", vendor: "Bondtech", rating: 3,
    note: "Commercially available, but 129.5 g is substantial for a dense wearable assembly. (Bondtech's 25 mm pancake datasheet gives 150–153 g.)",
    desc: "25 mm short-body stepper, 1.8°/step, 18 N·cm holding, 0.7 A/phase. Precise and continuous, but holding current costs power all the time.",
    kind: "stepper", drive: "step", speed: 1800, accel: 30000, range: 360, deadMs: 1, posErr: 0.2, idleW: 2.2, force: 0.18,
    mass: 150, power: 4.5, cost: 25, dims: "42 × 42 × 25", est: ["speed", "accel", "deadMs", "posErr", "idleW", "power", "cost"], src: [S.bondtech] },
  { cat: "actuator", id: "actuonix-l12", name: "Actuonix L12 (50:1, 30 mm, RC)", vendor: "Actuonix", rating: 3,
    note: "Compact at 40–56 g depending on stroke, but intended for ordinary linear motion.",
    desc: "Micro linear actuator with RC-servo input. 50:1 gearing: 25 mm/s no-load, 17 N at 14 mm/s, 22 N max; 20% duty cycle. Strokes 10/30/50/100 mm weigh 28/34/40/56 g.",
    kind: "linear", drive: "pwm", speed: 20, accel: 0, range: 30, deadMs: 20, posErr: 0.3, idleW: 0.05, force: 22,
    mass: 34, power: 2.8, cost: 75, dims: "L12-30 body", est: ["speed", "deadMs", "posErr", "cost"], src: [S.actuonix] },
  { cat: "actuator", id: "robot-extreme-12v", name: "Robot Extreme 12 V actuator (50 mm)", vendor: "Robot Extreme", rating: 2,
    note: "55 g, but low-speed general-purpose actuator.",
    desc: "12 V DC linear actuator with limit switches, IP54. 64 N at 15 mm/s no-load; 1 A working. Needs an H-bridge.",
    kind: "linear", drive: "dc", speed: 15, accel: 0, range: 50, deadMs: 30, posErr: 1, idleW: 0, force: 64,
    mass: 55, power: 12, cost: 32.5, dims: "—", est: ["deadMs", "posErr"], src: [S.robotx] },

  /* ---------------- structure */
  { cat: "structure", id: "ancile-frame", name: "ANCILE turret frame", vendor: "ANCILE (original)", rating: 2,
    note: "Original assembly was relatively bulky and limited in movement.",
    desc: "Turret base 200 × 145 × 139 mm; 120° horizontal and 50° vertical travel.", role: "frame", slew: 120, ratio: 1, posErr: 1.5,
    mass: 400, power: 0, cost: 20, dims: "200 × 145 × 139", est: ["posErr", "mass", "cost"], src: [S.ancile] },
  { cat: "structure", id: "ancile-gearing", name: "ANCILE bearing / gearing", vendor: "ANCILE (original)", rating: 2,
    note: "Original design had documented positioning limitations; exact parts undisclosed.",
    desc: "Drive gear and slew bearing from the original build.", role: "gearing", slew: 360, ratio: 2, posErr: 2.5,
    mass: 60, power: 0, cost: 15, dims: "—", est: ["ratio", "posErr", "mass", "cost"], src: [S.ancile] },

  /* ---------------- pneumatics */
  { cat: "pneumatic", id: "ancile-compressor", name: "ANCILE original compressor", vendor: "Undisclosed", rating: 1,
    note: "Additional weight; exact specification undisclosed.",
    desc: "Compressor charging the launcher to 0.689 MPa (about 100 psi). The whole ANCILE launcher weighed 1.26 kg.", role: "source", bar: 6.9, deadMs: 0, duty: 0.05,
    mass: 600, power: 12, cost: 30, dims: "—", est: ["duty", "mass", "power", "cost"], src: [S.ancile] },
  { cat: "pneumatic", id: "co2-12g", name: "12 g CO₂ cartridge + regulator (suggested)", vendor: "Generic", rating: null,
    note: "Suggested extra, not on the rated list. No compressor power; limited shots per cartridge.",
    desc: "Stored-gas source with a regulator.", role: "source", bar: 6, deadMs: 0, duty: 0,
    mass: 80, power: 0, cost: 15, dims: "—", est: ["bar", "mass", "cost"], src: [] },
  { cat: "pneumatic", id: "ancile-valve", name: "ANCILE original solenoid valve", vendor: "Undisclosed", rating: 1,
    note: "Performance and model undisclosed.",
    desc: "Solenoid valve switched from GRBL's coolant output.", role: "valve", bar: 0, deadMs: 20, duty: 0,
    mass: 120, power: 4, cost: 15, dims: "—", est: ["deadMs", "mass", "power", "cost"], src: [S.ancile] },
  { cat: "pneumatic", id: "acrylic-hose", name: "Acrylic pneumatic hose", vendor: "ANCILE (original)", rating: 1,
    note: "Part of the original deployment arrangement, not independently validated.",
    desc: "Line from valve to launcher. Its length sets a transit delay.", role: "line", bar: 0, deadMs: 2, duty: 0,
    mass: 40, power: 0, cost: 5, dims: "—", est: ["deadMs", "mass", "cost"], src: [S.ancile] },

  /* ---------------- protective elements */
  { cat: "shield", id: "ancile-kevlar-100", name: "Kevlar sail 100 × 100 mm", vendor: "ANCILE (original)", rating: 3,
    note: "Lightweight, but only 100 × 100 mm and tested separately from the complete system.",
    desc: "40 g aramid sail. On a 2.89 kg pendulum at 3.4 m it stopped .22 LR to .357 Magnum; never tested as part of the full system.", w: 100, h: 100, areal: 4.0, level: "handgun",
    mass: 40, power: 0, cost: 10, dims: "100 × 100", est: ["cost"], src: [S.ancile, S.ancileJ] },
  { cat: "shield", id: "aramid-iiia-300x400", name: "Aramid panel 300 × 400 mm, IIIA class (reference)", vendor: "Generic reference", rating: null,
    note: "Reference element for sizing, not on the rated list.",
    desc: "Typical soft-armour areal density for handgun protection, sized to a torso.", w: 300, h: 400, areal: 5.0, level: "handgun",
    mass: 600, power: 0, cost: 250, dims: "300 × 400", est: ["areal", "cost"], src: [S.nij] },
  { cat: "shield", id: "uhmwpe-iii-250x300", name: "UHMWPE plate 250 × 300 mm, III class (reference)", vendor: "Generic reference", rating: null,
    note: "Reference element for sizing, not on the rated list.",
    desc: "Typical rifle-plate areal density. Shows what a moving rifle-rated element weighs.", w: 250, h: 300, areal: 19, level: "rifle",
    mass: 1425, power: 0, cost: 400, dims: "250 × 300", est: ["areal", "cost"], src: [S.nij] },
];

/* ------------------------------------------------------------------ threats */
const THREATS = [
  { id: "9mm", name: "9×19 mm pistol", short: "9 mm", group: "small", v0: 360, powered: false, mass: 8.0, d: 9.0, cd: 0.25,
    rmin: 5, rmax: 50, elMin: -8, elMax: 8, cVis: 0.5, cIR: 1.0, rcs: 1e-4, req: "handgun", note: "124 gr FMJ." },
  { id: "556", name: "5.56×45 mm rifle", short: "5.56", group: "small", v0: 940, powered: false, mass: 4.0, d: 5.7, cd: 0.30,
    rmin: 25, rmax: 400, elMin: -6, elMax: 8, cVis: 0.5, cIR: 3.0, rcs: 5e-5, req: "rifle", note: "M855-class ball." },
  { id: "762r", name: "7.62×39 mm rifle", short: "7.62×39", group: "small", v0: 715, powered: false, mass: 7.9, d: 7.9, cd: 0.35,
    rmin: 25, rmax: 300, elMin: -6, elMax: 8, cVis: 0.5, cIR: 2.5, rcs: 8e-5, req: "rifle", note: "M43-class ball." },
  { id: "762n", name: "7.62×51 mm rifle", short: "7.62×51", group: "small", v0: 840, powered: false, mass: 9.5, d: 7.8, cd: 0.29,
    rmin: 50, rmax: 600, elMin: -6, elMax: 8, cVis: 0.5, cIR: 3.0, rcs: 8e-5, req: "rifle", note: "M80-class ball." },
  { id: "127", name: "12.7×99 mm HMG", short: "12.7", group: "small", v0: 890, powered: false, mass: 42, d: 12.95, cd: 0.28,
    rmin: 100, rmax: 1500, elMin: -5, elMax: 6, cVis: 0.5, cIR: 3.5, rcs: 3e-4, req: "heavy", note: "M33-class ball." },
  { id: "40mm", name: "40 mm low-velocity grenade", short: "40 mm", group: "explosive", v0: 76, powered: false, mass: 230, d: 40, cd: 0.30,
    rmin: 50, rmax: 350, elMin: 5, elMax: 40, cVis: 0.6, cIR: 0.3, rcs: 3e-3, req: "fragment", note: "Lobbed; arrives from above. Fragmentation threat." },
  { id: "fpv", name: "FPV attack drone", short: "FPV", group: "aerial", v0: 35, powered: true, mass: 1200, d: 250, cd: 0,
    rmin: 30, rmax: 500, elMin: 3, elMax: 55, cVis: 0.4, cIR: 0.6, rcs: 0.03, req: "fragment", note: "Distance is where it starts its final run." },
  { id: "dart", name: "Foam dart (ANCILE test)", short: "Dart", group: "ref", v0: 7.5, powered: false, mass: 11.4, d: 12.7, cd: 0.8,
    rmin: 1.6, rmax: 1.8, elMin: 10, elMax: 18, cVis: 0.6, cIR: 0, rcs: 1e-4, req: "none",
    note: "ANCILE's validation projectile: launched 1.68 m away and 0.43 m above the turret. ANCILE reported 28.6 ± 8.3% interception overall, reliable at ≤ 7.5 m/s." },
  { id: "rpg", name: "RPG-type rocket (reference)", short: "RPG ref", group: "ref", v0: 250, powered: true, mass: 2200, d: 85, cd: 0,
    rmin: 50, rmax: 500, elMin: -4, elMax: 8, cVis: 0.6, cIR: 10, rcs: 0.05, req: "never", note: "Average flight speed. The class vehicle APS is built against." },
];

/* ------------------------------------------------------------------ environments */
const ENVIRONMENTS = [
  { id: "open-day", name: "Open terrain, daylight", light: 1.0, visMult: 1.0, clutter: 0.04, irClutter: 0.03, note: "Sky and dry ground behind the round." },
  { id: "wood-day", name: "Woodland, daylight", light: 0.5, visMult: 0.5, clutter: 0.14, irClutter: 0.04, note: "Foliage texture and shade." },
  { id: "urban-day", name: "Urban, daylight", light: 0.7, visMult: 0.7, clutter: 0.09, irClutter: 0.06, note: "Hard edges and glints." },
  { id: "dusk", name: "Overcast or dusk", light: 0.05, visMult: 0.8, clutter: 0.05, irClutter: 0.03, note: "Little light for short exposures." },
  { id: "night", name: "Night, no illumination", light: 0.0005, visMult: 1.0, clutter: 0.02, irClutter: 0.03, note: "Visible cameras are close to blind." },
];
const ACTIVITIES = [
  { id: "static", name: "Static / prone", omega: 0.05 },
  { id: "walk", name: "Walking", omega: 0.5 },
  { id: "run", name: "Running, scanning", omega: 2.0 },
];
const BATTERIES = [
  { id: "liion150", name: "Li-ion pack · 150 Wh/kg", whkg: 150 },
  { id: "liion200", name: "High-density Li-ion · 200 Wh/kg", whkg: 200 },
  { id: "lipo180", name: "LiPo · 180 Wh/kg", whkg: 180 },
];

/* ------------------------------------------------------------------ default build, scenario, requirements */
const DEFAULT_BUILD = {
  name: "Shortlist baseline",
  camera: "xiq-mq003cg", lens: "m12-100", pods: 4, podMount: "shoulder", roi: 1, expUs: 100,
  radar: "ti-iwr6843aop", radars: 1,
  compute: "orin-nano-super-15", fusion: "or",
  k: 5, confM: 3, confN: 4, stab: 0.8,
  controller: "teensy41", driver: "direct",
  aim: "none", frame: "none", gearing: "none",
  deploy: "none", pSource: "ancile-compressor", pValve: "ancile-valve", pLine: "acrylic-hose", bore: 16,
  shield: "none", standoff: 0.25, respMount: "back",
  battWh: 99, battChem: "liion150", extraMass: 0,
};

const EXAMPLE_BUILDS = [
  { ...DEFAULT_BUILD, name: "Example · Shortlist baseline" },
  { ...DEFAULT_BUILD, name: "Example · Resolution first", camera: "daheng-mer2-160", lens: "m12-70", pods: 6, compute: "orin-nano-super-25", battWh: 150 },
  { ...DEFAULT_BUILD, name: "Example · ANCILE-style reference", camera: "imx296-ancile", lens: "m12-70", pods: 2, podMount: "helmet", radar: "none", radars: 0,
    compute: "pi5", controller: "arduino-uno", driver: "cnc-grbl", aim: "nema17-pancake", frame: "ancile-frame", gearing: "ancile-gearing",
    deploy: "pneumatic", shield: "ancile-kevlar-100", roi: 0.43, battWh: 60 },
  { ...DEFAULT_BUILD, name: "Example · Thermal + drone watch", camera: "flir-boson-640", lens: "ge-50", pods: 8, podMount: "shoulder", compute: "orin-nano-module",
    aim: "nema17-pancake", driver: "tmc2209", deploy: "pneumatic", pSource: "co2-12g", shield: "aramid-iiia-300x400", battWh: 99 },
];

const DEFAULT_SCENARIO = {
  env: "open-day", activity: "walk", bearing: "uniform", needMs: 5, rounds: 600,
  threats: { "9mm": 1, "556": 1, "762r": 1, "762n": 1, "127": 1, "40mm": 1, "fpv": 1, "dart": 0, "rpg": 1 },
};
const DEFAULT_REQ = { maxMass: 3.0, maxHead: 0.4, minRuntime: 3, maxCost: 6000, maxFar: 1, minRating: 0 };

return { LEVELS, COMMON_FIELDS, CATEGORIES, CATEGORY_ORDER, THREAT_FIELDS, PARTS, THREATS, ENVIRONMENTS, ACTIVITIES, BATTERIES,
  DEFAULT_BUILD, EXAMPLE_BUILDS, DEFAULT_SCENARIO, DEFAULT_REQ, SOURCES: S };
});
