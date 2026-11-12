# Wearable APS Sim

Parts simulator for a wearable threat-warning and protection system. Pick a part for every slot (cameras, lens, radar, compute, controller, driver, aiming actuator, turret structure, pneumatics, protective element). The sim fires randomised threats at the wearer and shows where the chain breaks. A trade study sweeps whole slots of the library at once.

Open `sim/index.html` in a browser. It is a single file and needs no server; three.js loads from jsDelivr for the 3D view.

## What it does

| Section | What you get |
|---|---|
| Build | 3D wearer with every part placed on the body. Mass, head-borne mass, centre-of-mass shift, power, runtime, camera bandwidth, compute load, latency, coverage, false alerts per hour, weakest-link readiness and cost. Configuration checks flag incompatible parts, such as a stepper with no step driver, MIPI pods beyond the host's CSI ports, a linear actuator used to slew, or GRBL without an Uno. |
| Coverage | Azimuth × elevation map of what each pod and radar sees after body and pack occlusion. Click it to aim a test round. |
| One round | Frame-by-frame trace. Each tick shows the per-frame detection probability. The trace runs through M-of-N confirmation, pipeline latency and the alert, then the driver, slew and deploy times, and ends at impact. |
| Scenario | Monte Carlo over a weighted threat mix, environment (daylight to night), wearer activity, bearing distribution and requirements. Every round ends in one outcome, so the table shows which link fails. |
| Trade study | Tick candidate parts in any slot and run every combination. Scatter of objective against mass, power, cost, readiness or runtime, with the trade-off front, a ranked table, CSV copy and one-click load. |
| Verify | Ten checks that take the team's component fact-check into the sim. Each tests a part in its role, then varies the still-estimated values to see whether the verdict holds. A Markdown report is copied from the page or generated with `sim/tools/verify.js`. |
| Saved builds | Side-by-side comparison of saved builds. Four examples are included, among them an ANCILE-style reference. |
| Parts library | Every part with its rating, the reason for it, estimated fields marked "est." and source links. Add, edit, duplicate or hide parts and threats. Export or import the changes as JSON to share them. |

## Model in brief

- **Ballistics:** constant-Cd drag in closed form. Rockets and drones fly at constant speed.
- **Cameras:**
  - point-target SNR from pixel fill, lens energy, contrast and noise
  - photon-limited noise for visible sensors; light-independent noise for thermal
  - motion smear, plus bolometer lag for thermal
  - residual clutter from ego-motion between frames
  - per-frame Pd = Φ(SNR − k), M-of-N confirmation, false-alarm rate from the Gaussian tail
- **Event cameras:** sampled at their pixel latency; the wearer's movement sets the event rate and compute load.
- **Radar:** R_ref × σ^¼, with coherent-gain loss when a fast target crosses range bins faster than a chirp loop (consumer FMCW). Chronographs give no bearing and report too late to cue.
- **Response:** driver latency, slew with acceleration and gear reduction, then pneumatic deploy (pressure × bore ÷ moving mass) or actuator stroke. The element only protects if its geometry against the aim-point spread works out and its protection level matches the threat.
- **Readiness:** the weakest rated part, as with TRL.

The page's Model section lists every equation and simplification.

## Verification

`sim/VERIFICATION.md` is the current report. Re-run it after changing parts:

```bash
node sim/tools/verify.js --out sim/VERIFICATION.md
```

| Check | Sim verdict |
|---|---|
| TI IWR6843AOP as a threat cue | Not supported for small arms: about +90 dB short on 5.56 mm (+72 dB with a ballistic waveform); cues FPV drones in about half of front-quarter runs |
| Ariel 2025 W-band radar in real time | Depends on unknowns: useful in-beam below about 10 ms of processing, but one beam watches about 1% of the ground band |
| Daheng MER2-160 and XIMEA xiQ | Not supported for rifle rounds. Pistol rounds are cued by the 500 fps xiQ, which is end-of-life; the Daheng needs ROI or more USB bandwidth to match it |
| Orin NX 16GB against Orin Nano Super | Reference: USB bandwidth, not TOPS, limits Daheng pods to 2 at full rate on either |
| Teensy 4.1, S32K344, Uno | Supported: controller latency is under 1% of the response budget; choose on safety case and packaging |
| ANCILE assembly mass | Itemised parts add to 925 g against the stated 1.257 kg; 332 g is not accounted for |
| ANCILE result reproduced | The sim is optimistic: about 59 ms of hidden delay would bring its 12 m/s cut-off to the paper's 7.5–10 m/s |
| Kevlar sail 100 × 100 mm | Not supported: about 5% of torso and head paths even with perfect pointing; 90% needs about 490 × 650 mm |
| Certified armour baseline | Reference: a worn III-class plate stops more frontal rifle rounds than any active build here |
| ANCILE pneumatics (unidentified) | Depends on unknowns: deployment 23–90 ms across plausible valve, pressure and line values |

Figures are from the committed report at 600 rounds per case. The page's Verify section reruns them against your edited library and scenario.

## Ratings and data

Final-product suitability ratings (0–10) and their reasons come from the team's component assessment. Specs were checked against vendor datasheets where available, and each part lists its sources. Fields still estimated are listed in its `est` array and shown as "est." in the page. Parts marked "suggested" are extra candidates for the trade space and are not rated.

Notable findings from the spec check:
- **XIMEA MQ003 is discontinued.** It is listed as EOL on XIMEA's site.
- **LabRadar LX runs at 61 GHz,** not 24 GHz.
- **Bondtech's 25 mm pancake datasheet gives 150–153 g,** against 129.5 g in the assessment.
- **Actuonix L12 at 50:1 gives 22 N maximum.**
- **PCA9685 adds up to one PWM period of delay,** 10 ms on average at 50 Hz.
- **The 2025 Ariel W-band work was offline CW Doppler** with a few metres of range.
- **Prophesee sells the EVK4 excluding defence use.**

## Working on it

```
sim/
  src/catalog.js    parts, threats, environments, editor schema, example builds
  src/engine.js     model (no DOM; runs in Node and the browser)
  src/verify.js     verification checks and report (no DOM)
  src/ui/*.js       page modules: state, 3D scene, build rail, views, trade study, library
  src/page.html     markup; src/styles.css styles
  build.sh          inlines everything into wearable-aps-sim.html and index.html
  test/             engine tests (node --test)
  tools/trade.js    headless trade study to CSV
  tools/verify.js   runs every verification check, writes VERIFICATION.md
```

Rebuild the page after editing anything in `sim/src`:

```bash
sh sim/build.sh
```

Run the engine tests:

```bash
node --test sim/test/*.test.js
```

Run a headless sweep. `*` expands to every library part that fits the slot; `--library` merges JSON exported from the page:

```bash
node sim/tools/trade.js --sweep camera=* --sweep lens=* --sweep compute=* --sweep radar=none,ti-iwr6843aop --rounds 400 > trade.csv
```

To add a part permanently, add an entry to `PARTS` in `sim/src/catalog.js`. The fields for each category are listed in `CATEGORIES` in the same file. Then rebuild. Parts added in the page live in that browser until you export them.

Planning tool only. Results are the upper bound a simple optical and radar model allows; use them to steer bench tests, not to replace them.
