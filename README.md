# Wearable APS Sim

Interactive simulator for a wearable threat-warning demonstrator (camera pods, Jetson / Pi compute, TI mmWave radar, Teensy status controller).

Open `sim/index.html` in a browser. Edit `sim/wearable-aps-sim.html`, then run `sim/build.sh` to regenerate `index.html`.

What it does:
- 3D soldier model with camera pods (helmet, shoulder or vest), fields of view, radar, compute, battery and Teensy placed on the body
- Mass, head-borne mass, centre-of-mass shift, power, runtime, USB3 and compute load, coverage and cost for the chosen stack
- Single-round engagement trace: frames on target, track confirmation, pipeline latency, alert time vs impact
- Monte Carlo study ranking every camera + compute combination against five small-arms threats and an RPG reference

Model assumptions are listed on the page. Planning values marked "est." should be replaced with measured hardware numbers.
