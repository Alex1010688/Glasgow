# Asset mileage mode

Select the milepost icon above the bottom-left controls to enable mileage mode.
Every asset category then adds its estimated ELR and mileage to the existing popup.
Turning the mode off removes computed mileage from popups and clears search markers.
Measurement and radius tools turn mileage mode off, and vice versa.

Point assets use their stored coordinates, not the edge of the tapped icon. Lines
use the clicked position. The lookup has a strict **20 metre** radius: if no
reference falls within it, the mileage section is omitted from the popup.
Only the closest reference is returned, with its ELR and mileage. No Network Rail track identifiers,
track codes or running-line names are stored or returned. Existing asset names
and MyIM links are preserved.

Values display as **miles and yards**, rounded to the nearest yard, for example
`6m 1248yd`. Results are estimates, even though the display uses whole yards.

The mileage panel also searches by ELR, miles and yards (0–1759 yards). Search
loads reference data for all five mapped sections, reverses the calibrated
interpolation, and places a solid yellow circle above all other assets at each possible location. Nearby parallel
results and duplicate section coverage are merged within 20 metres. Separate
locations are kept. A partial load failure is reported so incomplete search
results cannot be mistaken for complete coverage. Search is limited to the
reference data included with the mapped assets, not the whole UK network.

## Data and calculations

The browser lazily loads `sections/<section>/mileage.json` and caches its parsed
index for the page session. It projects the point onto reference geometry and
interpolates along the polyline between adjacent mileage anchors. Anchor values
are total yards, not decimal miles. Increasing and decreasing mileages are
supported. Failed requests can be retried with another tap/search; stale results
cannot reappear after a popup closes or mileage mode is disabled.

Contains Network Rail information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

Source: [Network Rail GIS archive](https://github.com/openraildata/network-rail-gis/tree/a7c2cece9df7770e68a78cd716604c96ae38cd1a),
commit `a7c2cece9df7770e68a78cd716604c96ae38cd1a`, downloaded 2026-09-23.
This is historical reference data. See the source
[data caveats](https://github.com/openraildata/network-rail-gis/blob/a7c2cece9df7770e68a78cd716604c96ae38cd1a/CAVEATS.md).
No TrackFind code, hosted data or external mileage API is used.

## Rebuilding and testing

Download `.shp`, `.shx`, `.dbf` and `.prj` files for `NetworkLinks` and
`NetworkWaymarks` from `network-model/VectorLinks` and
`network-model/VectorWaymarks` at that commit into one directory. Install Python
packages `pyshp`, `pyproj`, and `shapely`, then run:

```
python scripts/build-mileage-data.py /path/to/shapefiles
node --test tests/mileage-lookup.test.cjs
```

The builder selects whole reference links within 150 metres of **all asset
geometries** in each section. This preparation buffer does not change the 20m
runtime lookup limit. Invalid asset polygons are repaired only for the coverage
calculation; original assets remain unchanged. British National Grid geometry is
converted to WGS84; miles.yards attributes become total yards. Link endpoints are
supplemented with same-ELR waymarks within 25 metres whose mileage lies strictly
between those endpoints. Conflicting anchor order and multipart geometries are
omitted rather than inventing connections. There is no interpolation between
links. Unknown discontinuities within a source link remain a source limitation.
Rebuild the files after adding asset coverage.
