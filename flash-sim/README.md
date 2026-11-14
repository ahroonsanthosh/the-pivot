# Muzzle Flash Aspect

Browser simulation for one question: can a small infrared sensor worn by a soldier tell, at the moment a rifle fires, whether the shot is aimed at them or somewhere nearby?

Open `index.html` in a browser. Nothing to install. The study runs in the page (about 30 s) and re-runs when settings change.

## What it shows

- **Answer table** at the scenario distance: how often each sensor catches the flash, the smallest angle off the barrel line it can tell apart from dead-on (best case and realistic case), that angle as a miss distance, and warning time.
- **Smallest angle vs distance** (50–800 m) for four sensors, with the barrel elevation (where the targeted soldier actually sits) and the barrel-glow zone drawn on. Switch to miss distance in metres.
- **Smallest angle vs barrel-glow brightness** at a chosen distance.
- **What the sensor sees**: the true flash, the sensor image, and the signal over time with each exposure window.
- **Side-by-side images** at 0°, 2°, 5°, 20° and 90°.
- **Ballistics** for M80 ball and M118LR: flight time, warning time, barrel elevation, and how much glow the target sees.

PNG and CSV export on every plot. CSV files start with the settings used.

## Model in brief

| Part | Model | Default |
|---|---|---|
| Flash cloud | Uniform emitting and absorbing ellipsoid on the barrel line, optional gap from the muzzle | 0.7 × 0.35 m, 60 W/sr side-on peak (3–5 µm), 2 ms, opacity 0.5 across the width (matched to an unverified 0.83 front/side ratio), gap 0 |
| Barrel glow | Bore far end seen through the muzzle (overlap of two circles), dimmed by the cloud in front of it | 2 W/sr on axis, 1 ms fade, cut-off atan(7.62/500) = 0.87° |
| Bullet blocking | The bullet (7.82 mm) hides the bore until it moves off the observer's line of sight; shadow offset (x tanθ − drop)·R/(R − x) from the round's trajectory; observer below the barrel line | on (switchable) |
| Suppressor | Flash dimmer by a factor; glow unchanged, dimmed or hidden (separate setting) | ÷10, glow unchanged |
| Air | Exponential loss | 0.3 /km |
| Sensors | Lens from pixels, pitch, field of view, f-number; diffraction blur; photon, background and read noise; full-well clipping | see below |
| Ballistics | Point-mass G7 drag, ICAO sea-level air, no wind | M80 838 m/s G7 0.200; M118LR 786 m/s G7 0.250 |

Sensors:

| Sensor | Format | View | Rate | Exposure | Lens |
|---|---|---|---|---|---|
| Single detector | 1 uncooled PbSe-type element, 2 × 2 mm, D* 2 × 10⁹ | 60° | 10 kHz | 0.1 ms | 1.9 mm |
| Standard MWIR camera | 640 × 512, 15 µm, cooled | 40° | 60 Hz | 2 ms | 6.9 mm |
| Wide-view camera | same camera | 120° | 60 Hz | 2 ms | 2.3 mm |
| High-speed camera (best case, not wearable) | 320 × 256, 25 µm, cooled | 40° | 2 kHz | 0.45 ms | 5.7 mm |

The standard camera's exposure is 2 ms, not 5 ms: at F/2 a 300 K background alone would fill its pixels in about 5 ms.

### How "told apart" is decided

- **Best case**: everything about the flash is known, the exposure is timed to catch the most light, and only sensor noise is random. Ideal observer, P(correct) = Φ(d′/2), saturated pixels excluded. This is a bound.
- **Realistic case**: each shot draws its own flash brightness (±30 %), glow brightness (±15 %), flash size (±15 %), timing (±15 %), optional range error, exposure phase, sub-pixel position and image orientation. Features from the image and time series go into a quadratic classifier on rank-normalised features, trained on half the simulated shots and scored on the other half. Only detected shots count (matched filter, 5σ).
- Because the bullet hides the glow on the axis, P(correct) can rise and fall with angle inside the glow zone. Each result gives the smallest angle above which every angle reaches 90 % correct, plus any narrower bands below it that also pass. Inside the glow zone the realistic case tests a fixed grid of seven angles; above it, bisection.

## Checks

`node --test test/core.test.js` runs 18 physics checks, including:

- Stefan–Boltzmann.
- The cloud's analytic intensity matches the integral of its own radiance map.
- Thin and thick limits.
- The front/side ratio matches the Kastek measurements (0.85 vs 0.83).
- Glow geometry.
- Energy conservation and angle continuity in the image renderer.
- Camera NETD (17 mK, datasheet 19–20 mK).
- The realistic classifier scores chance on identical inputs.
- The G7 drag constant matches the reference library, and the vacuum limit is correct.
- Bullet blocking: the bore is fully covered as the bullet leaves, clearing times match hand estimates (dead-on about 40 ms from gravity drop alone; 0.3° about 1.1 ms), and near-axis angles become distinguishable from dead-on while 5° does not.

## Files

- `src/core.js`: physics, sensor model, statistics, ballistics. No DOM, also runs in Node.
- `src/app.js`: controls, charts, images, exports.
- `src/page.html`: layout and styles.
- `build.sh` / `build.js`: inline the three into `muzzle-flash-aspect.html` (page content) and `index.html` (open directly).
- `test/core.test.js`: physics checks.

Edit `src/`, then run `./build.sh`.

## Sources

- Kastek et al., Military University of Technology: 3–5 µm rifle flash intensities of 56.82 and 68.32 W/sr, 0.71 m flash. [Measurement of sniper infrared signatures](https://www.researchgate.net/publication/233864769_Measurement_of_sniper_infrared_signatures).
- G7 drag table (Lowry 1965) and drag constant: [py-ballisticcalc](https://pypi.org/project/py-ballisticcalc/).
- Cooled camera parameters: [FLIR SC7650](https://www.flir.com/products/sc7650/), [Lynred Scorpio MW](https://www.lynred.com/sites/default/files/2019-10/Scorpio-MW-datasheet.pdf).
- Uncooled PbSe: [Laser Components PB45](https://review.lasercomponents.com/us/product/pbse-detectors), [Agiltron](https://agiltron.com/PDFs/PbSe%20amplified%20infrared%20detector.pdf).

Planning values marked as estimates in the page (flash brightness, glow brightness, opacity, shot-to-shot variation, air loss) should be replaced with measured numbers when available.
