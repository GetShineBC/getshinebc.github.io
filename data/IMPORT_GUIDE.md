# V2.1 bundled data and optional imports

For a shared deployment, run `scripts/prepare_public_inventory.py` in the publishing environment. It writes the ACS and HUD aggregates to `assets/enrichment-data.js`, which is loaded before the app and persists for all visitors. No runtime Census API key or user upload is needed once these data are bundled. The original delivered V2.1 update includes EIA rate trends but does NOT yet include the national ACS/HUD inventory; check `data/ENRICHMENT_AUDIT.json` and the per-layer status.

The offline parser tests passed with isolated synthetic fixtures. Live national source acquisition has NOT been validated in this environment. Do not describe the housing layers as populated until the actual official data is loaded and checked.

The instructions below describe OPTIONAL browser-session imports. They do not update the deployed bundle.

# V2 import guide (county FIPS are **five-character strings**)

Open **Data hub** in the dashboard, select the corresponding file, and inspect the matched, skipped and conflict counts. All imports are in-memory in the browser: no data leaves your computer, and page reload loses imported data. CSV columns must have a heading row; exports from Excel can change 5-digit FIPS to integers, but the importer pads digits to 5 when possible. Use standardized source dates and provide records only if verified. Never use the examples as real observations.

## 1. U.S. ACS 2024 renter-occupied units in buildings with 5 or more homes

**Filename example:** `acs_2024_b25032_counties.csv`  
**Expected fields:** `county_fips,renter_5plus_units`. A complete raw table can instead provide `county_fips,B25032_018E,B25032_019E,B25032_020E,B25032_021E`; the app sums those four categories.

This metric counts **renter-occupied residential units**, not buildings, LIHTC developments, or specifically solar-eligible roofs. Source: Census 2024 ACS 5-year detailed table B25032. https://data.census.gov/table/ACSDT5Y2024.B25032

A county with no ACS record remains **unknown**.

## 2. HUD LIHTC properties

Either provide one row **per county**:

`county_fips,lihtc_properties,lihtc_units,low_income_units`

Or one row **per property**, with a stable HUD identifier:

`county_fips,hud_id,project,n_units,li_units`

Multiple properties in one county are summed and duplicate HUD IDs are deduplicated. A duplicate HUD ID with conflicting addresses should be resolved upstream. Historical records and allocated-credit records are not identical to actively operating projects or Shine's sales pipeline; carry placed-in-service year and status as upstream provenance if possible.

Source: HUD LIHTC https://www.huduser.gov/portal/datasets/lihtc.html

## 3. Year-tagged 2026 utility rate snapshots

One county row for each meter class, with:

`county_fips,price_year,residential_price_usd_per_kwh,commercial_price_usd_per_kwh,source,effective_date`

or utility-level rows with `eia_utility_id` in place of county FIPS. Values must be **USD/kWh**, not cents (e.g. `0.175`). To supply cents, use `residential_cents_per_kwh` and `commercial_cents_per_kwh`. `price_year` must be exactly `2026`. Conflicting county/sector values are omitted rather than averaged. Utility ID matching is limited to utility assignment already present in the V1 baseline.

**Important:** Comparing a dated 2026 tariff price with EIA 2025 annual reported revenue/sales is not a like-for-like realized price change. Optional tariff uploads are displayed in county detail but NEVER feed the rate-shift map. That map now uses bundled EIA state averages for matched January-August periods in 2025 and 2026.

ETB source tariffs can have many components, fixed charges, demand charges, time-of-use tiers, minimum charges, and net-metering export credit. They require a representative load profile and time-series simulation for a multifamily property—do not simply average the listed rates.

## 4. Multi-point county PVGIS annual solar yield

One row per county:

`county_fips,solar_refined_kwh_per_kwdc_year,sample_count,solar_min_kwh_per_kwdc_year,solar_max_kwh_per_kwdc_year,solar_assumption_id`

The `solar_assumption_id` must contain exactly the standardized V1 key:

`pvgis53_era5_csi_free_20deg_south_14loss_nohorizon_1kwdc_v1`

The app requires `sample_count` >= 2 to prevent a one-point value from being mislabeled refined. The refined series is optional and disabled by default. When enabled, only counties with accepted refined results switch to their sample-average PV; the remainder retain the original V1 one-point model with a visible distinction in county detail. The acquisition script uses a reproducible set of sample points within each county geometry, not an apartment-property-weighted sample.

## Examples

Files in `data/examples/` contain **invented illustrative values** so you can test the importer format. **Do not publish them as real data or use them in decisions.**
