# Quarterra | ShineIQ Market Atlas V3

This repository contains the independently hosted public V3 Return on Cost market atlas for `https://quarterra.getshine.com/`.

## Source

Copied from the published GitHub Pages source: [GetShineBC/getshinebc.github.io/v3](https://github.com/GetShineBC/getshinebc.github.io/tree/main/v3) at main commit `18aae3a21e293d5d58f94b5ec687887d9a3d09fa`.

The content is copied unchanged except that navigation links have been adjusted for hosting from the domain root. The logo, public county datasets, map scripts, and data downloads are included.

## GitHub Pages setup

In this **dedicated public repository**, choose Settings -> Pages -> Deploy from a branch -> `main` / `(root)`. Set Custom domain to `quarterra.getshine.com`. Preserve the root `CNAME` file. When DNS points correctly, enable Enforce HTTPS.

DNS CNAME record managed by Avahi:
- Host: `quarterra`
- Type: `CNAME`
- Value: `getshinebc.github.io`

This source should not replace or modify the original V1/V2/V3 repository. For future V3 updates, cherry-pick the vetted source changes into this separate repo.

**Return on Cost** is a modeled retail-value screening metric, not realized savings or an investment ROI.
