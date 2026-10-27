# Open questions from the first IFC run (3 Revit models)

Tested on three architectural IFC 2x3 exports: a 9-storey metal-stud/concrete residential tower, a
3-storey wood/CLT senior housing project, and a large wood-frame campus building (95-887 MB).
Revit's *Structural Material* is not in any of them; the structural layer is guessed.

## Database
1. Missing rows, the bulk of "no DB row": CFS stud layers (size x gauge x spacing - the single biggest gap),
   CLT/mass timber, wood I-joists/trusses, metal panel/ACM, EIFS, cement backer board, stone veneer,
   mineral wool, composite decking.
2. Composite deck slabs: Revit models "3 in. concrete + 2 in. deck" as two layers -> 36 psf, which misses the
   concrete in the flutes (~48 psf). Add composite-slab rows by total depth + deck profile?
3. Dimension convention: framing, CMU and brick rows are nominal (2x6 = 6, 8 in. CMU) while Revit layers are
   actual (5.5, 7.625). The matcher converts. Confirm "nominal for framing/masonry, actual for everything else".
4. Tile rows are 3/8 and 3/4 in. *with* mortar bed; Revit models 5/8 in. tile plus a separate mortar layer.
   Merge tile + mortar into one row?

## Matching defaults
5. Stud spacing is almost never in the model: 16 in. o.c. assumed, marked "suggested".
6. Same material in both ASCE and firm rows with different psf: firm value preferred, marked "suggested".
7. "Default Wall/Floor" placeholder layers are left to the user. Layer name vs modelled thickness
   disagreements (e.g. "Plywood - 3/4in" modelled at 5/8): modelled thickness used, marked "suggested".

## Assemblies
8. Finish-only walls (gyp soffit bulkheads, wall tile) are flagged and skipped. Skip, or fold into the
   floor/ceiling assembly?
9. Stacking: a ceiling joins the floor stack above it if the gap is <= 12 ft; elements overlapping in plan
   but not touching vertically (roof over roof) stay separate. Right rule?

## Infrastructure
10. Largest model: 887 MB, ~90 s to process -> background job + upload limit for the web version. The
    "export only elements visible in view" step should shrink files a lot (not measured yet).
11. Plans are in Revit shared coordinates, not rotated to true north. North-up, or match the sheets?
