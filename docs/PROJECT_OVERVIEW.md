# Ropon Radar — project and data overview

Ropon Radar (রোপণ) is a prototype about the relationship between monsoon rainfall timing and Aman rice transplanting in Rangpur District, Bangladesh. Its central idea is to compare the onset of usable rain with radar-detected transplant timing, then show the difference as an adaptation gap.

> **Important:** The current application is an illustrative prototype. Rainfall, radar observations, NISAR-like observations, and all analysis results are generated synthetic data, not measured NASA or satellite results. The real-data pipeline is planned and has not been implemented.

## Pages and views

| URL | Page | What it contains |
|---|---|---|
| `/` | Scene mode | Eight timed, keyboard-navigable scenes presented on a 1920×1080 stage. Intended for a narrated presentation or video. |
| `/?mode=explore` | Explore mode | Scrollable interactive dashboard with the same core visualizations, upazila selection, season and pixel controls, editable SMS examples, and an evidence drawer. |
| `/lowband.html` | Text-only view | Tables and text for the trends, transplant dates, gaps, detector tests, advisories, and data provenance. It uses the same synthetic model as the visual views. |
| `/tests/stats.test.html` | In-browser tests | 33 checks of statistics, event-detection rules, and seeded-random-number repeatability. These test the prototype calculations, not real-data accuracy. |

### The eight scene-mode scenes

1. **Under cloud:** Introduces the district and illustrates why optical imagery may be obscured during the monsoon. The cloud texture and cover value are generated effects, not imagery.
2. **Radar sees through:** Shows a synthetic VH backscatter curve. A drop followed by a rise illustrates the expected flooding/transplanting and crop-growth pattern.
3. **Where they planted:** Maps each upazila's median detected transplant date by season, 2017–2025. The season slider updates the map and summary table.
4. **The rain moved:** Displays 2001–2025 usable-rain onset dates and the selected upazila's trend estimate, confidence interval, and test results.
5. **The adaptation gap:** Displays the median gap map and a selected upazila's season-by-season gaps. It does not fit a trend to the gap series.
6. **Field replay:** Allows inspection of the radar-like series and detection rule, including synthetic flood-only, double-dip, and missing-data examples. A synthetic 2026 NISAR-like series is separately marked provisional.
7. **The advice:** Presents generated English and Bangla advisory and SMS examples, with a confidence label and SMS encoding/length counters.
8. **Evidence:** Shows the selected trend's inputs and methods, the synthetic mode and seed, and the proposed datasets.

The scenes have keyboard and on-screen navigation. Reduced-motion preferences and the `?still` query option suppress most animations. See the README for controls and direct-scene URL fragments.

## Technical flow

The browser loads the Rangpur boundary GeoJSON and English/Bangla translation files, then creates the model using a deterministic pseudorandom generator (mulberry32, seed 42). Substreams are separated by labels such as data type, upazila, and year, so generated output is repeatable. D3 v7 is bundled locally; fonts are self-hosted. The prototype does not fetch NASA or other observation products at runtime.

The analysis proceeds as follows:

1. **Usable-rain onset:** For each upazila and year, search daily rain from 1 June for the first three-day total of at least 20 mm. Reject a candidate if a dry spell longer than seven days occurs in the next 30 days. The first candidate passing both conditions is the onset; rejected false starts can be shown in the chart.
2. **Transplant detection:** For each radar-like pixel, search for minima from 15 June through 15 September. A candidate must be at least 3 dB below the median of observations 60–12 days earlier and show at least a 4 dB sustained rise within 45 days. The rise is based on the final three observations in that window. Distant passing dips are reported as alternates; missing or insufficient evidence can result in “not detected.”
3. **Seasonal summaries:** The model creates 36 notional rice pixels per upazila for each 2017–2025 season. It summarizes detected transplant dates with a median and IQR, and reports how many pixels were detected. The demo models a 12-day Sentinel-1 revisit in 2022–2024 and 6 days in other years.
4. **Rain-onset trend:** Mann–Kendall provides a tie-corrected monotonic-trend test; Sen's slope estimates change per year and a 95% confidence interval. Benjamini–Hochberg correction is applied across the eight upazilas at q = 0.10.
5. **Adaptation gap:** For each season with both dates, subtract onset day-of-year from transplant day-of-year. The map uses the median across available seasons. The prototype calls 15–30 days “on track,” based on an assumed seedbed-age range; this is a design assumption, not a locally validated threshold.
6. **Advisory and confidence:** Templates use the calculated trend and gap. A trend is described as a shift only when it remains significant after the multiple-testing correction. The prototype's “moderate” confidence requires a significant onset trend and available gaps in all but at most one radar season; otherwise it is “low.” “High” is not reachable with the current nine demo seasons.

### Main implementation files

| File | Responsibility |
|---|---|
| `index.html` | Loads D3 and starts the scene or explore application. |
| `lowband.html` | Builds the text-only report from the shared generated model. |
| `js/scenes.js` | Scene definitions, scene navigation, explore mode, evidence drawer, and advisory assembly. |
| `js/data.js` | Synthetic rainfall/radar model, deterministic data generation, and statistics orchestration. |
| `js/detect.js` | Rain-onset and transplant detection rules. |
| `js/stats.js` | Summary statistics, Mann–Kendall, Sen's slope, and Benjamini–Hochberg correction. |
| `js/charts.js`, `js/map.js` | D3 charts, maps, and synthetic cloud/radar textures. |
| `js/i18n.js`, `i18n/` | English and Bangla strings, formatting, and SMS encoding/length calculations. |
| `data/prepare_geo.py`, `data/*.geojson` | Boundary preparation script and checked-in Rangpur boundaries. |
| `tests/stats.test.html` | Browser-based tests for the statistical and detection functions. |

## Data provenance: used versus planned

### Used in the current demo

| Input | Actual status |
|---|---|
| Rainfall, 2001–2025 | Synthetic daily values generated in the browser. They include generated onset trends, regional variation, false starts, and dry spells. |
| Sentinel-1-like VH, 2017–2025 | Synthetic backscatter curves for notional rice pixels, with generated noise and missing acquisitions. They are not Sentinel-1 GRD downloads. |
| NISAR-like L-band HV, 2026 | Synthetic and explicitly provisional. The demo includes a no-data interval from 27 July to 10 August 2026; it is not a NISAR product. |
| Rangpur administrative boundaries | Real boundary geometry from geoBoundaries gbOpen for Bangladesh ADM2/ADM3, attributed in the repository to BBS/OCHA ROAP, release `9469f09`, CC BY 3.0 IGO. These are geographic context, not NASA data. |

The displayed values and statistical findings are calculated from the synthetic inputs. A fixed seed makes the demo repeatable; it does not make the synthetic values observations.

### Planned datasets

| Dataset | Planned role | Current implementation status |
|---|---|---|
| **NASA GPM IMERG** | Daily rainfall for 2001–2025, to estimate usable-rain onset. | Listed in the README and evidence view; no product ingestion or processing is implemented. |
| **NASA POWER** | Rainfall cross-check and agro-climate context. | Listed as planned; the exact variables and comparison method are not specified in the repository. |
| **Sentinel-1 GRD, C-band VH** | Radar time series for transplant detection, 2017–2025. | Planned observation source. Sentinel-1 is not a NASA mission; the demo uses synthetic VH data. |
| **NISAR GCOV, L-band** | Radar observations for the 2026 season, initially provisional. | Planned source; the demo uses synthetic HV data. Its display notes that the current detection thresholds were designed for C-band VH and are not calibrated for L-band HV. |
| **OPERA DSWx-S1** | Surface-water extent to help distinguish flooding from a crop-transplant signal, including ambiguous or double-dip cases. | Proposed supporting layer; it is not currently used by the detector. |

The project therefore has no implemented NASA-data pipeline yet. The current repository does not define product versions, access/download procedures, quality filtering, spatial or temporal aggregation, rice-mask creation, cross-sensor calibration, or validation against field observations. Those decisions and validation are prerequisites for interpreting outputs as real results or using them for farmer guidance.

## Interpretation and limitations

- The prototype is a demonstration of a possible analysis and communication workflow, not evidence that onset has shifted or planting is keeping pace in Rangpur.
- Synthetic input patterns and generator parameters are illustrative. A deterministic seed ensures reproducibility, not scientific validity.
- The 15–30-day “on track” band and generated advisories need agronomic and local validation before operational use.
- Radar revisit, missing-data behavior, and detector outcomes are modeled, not derived from actual acquisition inventories.
- The NISAR-like chart is particularly provisional: L-band HV is not interchangeable with C-band VH, and the thresholds require sensor-specific calibration.
- Statistical tests and unit-style checks verify code behavior on selected cases; they do not establish that the methods or conclusions are suitable for real observations.

## Run locally

From the repository root:

```bash
python serve.py
```

Then open `http://localhost:8000/`. The README documents the other view URLs, scene controls, and the option to serve with Python's standard HTTP server.
