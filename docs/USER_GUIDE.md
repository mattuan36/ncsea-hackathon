# LightenTheLoad — User Guide

LightenTheLoad helps a structural engineer produce a **dead load takeoff** from a building model and look up **wind, snow and seismic site loads** for a location in the United States.

> **Current status: wireframe.** Reading a model is simulated: whichever model you pick, the app uses the same sample building (Level 2 and Roof, 150' × 90'). Project name, materials, assemblies and the Lateral report live in the browser tab only and **reset when you reload the page**. Documents are the exception: they are stored in the database. Material weights are typical values; verify them against ASCE 7 Table C3.1-1 before any design use.

## Contents

1. [Running the app](#1-running-the-app)
2. [The top menu](#2-the-top-menu)
3. [Quick start: a dead load takeoff in 6 steps](#3-quick-start)
4. [Gravity (dead load takeoff)](#4-gravity-dead-load-takeoff)
5. [Materials DB](#5-materials-db)
6. [Lateral (wind, snow, seismic)](#6-lateral-wind-snow-seismic)
7. [Analytics](#7-analytics)
8. [Reports](#8-reports)
9. [Documents](#9-documents)
10. [Settings](#10-settings)
11. [Project assistant (Ask)](#11-project-assistant-ask)
12. [How the loads are calculated](#12-how-the-loads-are-calculated)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Running the app

You need three things running. Commands are run from the `ncsea-hackathon` folder.

| Part | Command | Address |
|---|---|---|
| Database (PostgreSQL) | `docker compose up -d` | port 55432 |
| Backend (FastAPI) | `cd backend && .venv/bin/python -m uvicorn app.main:app --port 8100` | <http://localhost:8100> |
| Frontend (React + Vite) | `cd frontend && npm install && npm run dev` | <http://localhost:5180> |

The frontend forwards `/api` requests to port 8100 (`frontend/vite.config.ts`), so the backend must use that port. Open <http://localhost:5180>. The app starts on **Documents**.

The Lateral page needs a SkyCiv account (see [section 6](#6-lateral-wind-snow-seismic)). The Ask assistant needs a language model server (see [section 11](#11-project-assistant-ask)). Everything else works without them.

## 2. The top menu

| Menu item | What it is for |
|---|---|
| **Analytics** | Totals and a bar chart of dead load by assembly |
| **Documents** | File storage: upload, download and delete project files |
| **Settings** | Project name and model source |
| **Materials DB** | The material list used to build assemblies |
| **Lateral** | Wind, snow and seismic site loads from SkyCiv |
| **Gravity** | The step-by-step dead load takeoff |
| **Reports** | Printable output of the takeoff |

The blue **Ask** button at the bottom right of every page opens the project assistant.

## 3. Quick start

1. Open **Gravity** and choose a model (upload an IFC or enter a Revit path). Click **Read … model**.
2. **Floor types**: untick any floor type you do not want in the takeoff. Click **Next**.
3. **Wall types**: same for walls. Click **Next**.
4. **Build assemblies**: for each type, set its layers (material and thickness). Click **Save & next** until you reach **Finish → type table**.
5. **Type table**: check the psf and status of every type.
6. **Plan view**: see quantities and kips on the plan, per level.

Then open **Analytics** for totals or **Reports** to print.

## 4. Gravity (dead load takeoff)

The page shows a six-step bar. Steps 2–6 are locked until a model is chosen in step 1. Once a model is chosen you can jump to any step by clicking it. A tick marks steps you have passed.

### Step 1 — Model

Pick where the model comes from:

- **Upload an IFC model**: click **Upload IFC** and choose an `.ifc` file (an `.rvt` file is also accepted). Files are stored in Documents › 3D Models. Existing `.ifc` and `.rvt` files in the project are listed; select one with its radio button.
- **Point to a Revit model**: type a local `.rvt` path or a cloud (ACC / BIM 360) link and click **Connect**.

The goal is fixed to **Dead load takeoffs / design criteria** (Lateral criteria from a model is marked "coming later"). The main button reads **Choose a model first** until you pick one, then **Read IFC model** or **Read Revit model**.

> Reading is simulated in this version. The sample floor and wall types are used whichever source you pick.

### Step 2 and 3 — Floor types and Wall types

A table lists every type found in the model, grouped by structural material, with instances and quantity (SF for floors, LF for walls).

- Untick **Use** to leave a type out of the takeoff.
- Types with **no instances** are tagged *unused* and hidden by default. Untick **Hide unused types** to see them.

Only ticked types appear in later steps.

### Step 4 — Build assemblies

An assembly is the stack of layers that makes up a floor or wall type. You walk through each included type: floors first, then walls, grouped by structural material. The list on the left shows every type with a status dot; click one to jump to it.

For each type:

1. **Assembly name**: rename it if you wish (this name is used in Analytics, Reports and the assistant).
2. **Structural material**: choose the material and click **Confirm material is correct** to mark it *Verified by engineer*. If your choice differs from the model, the original is shown ("Revit says …").
3. **Layers** (floors: top to bottom; walls: exterior to interior). For each layer:
   - pick a **Material** (type to search the list);
   - pick a **Thickness** from that material's options;
   - the **PSF** column shows the calculated weight; type a value in **Override** to force your own psf for that layer (the calculated value is struck through). Clear the box to go back to the calculated value;
   - the bin icon removes the layer.
   
   The total for the assembly is shown at the foot of the table. The **Section** drawing on the left updates as you edit.
4. **Add layer** adds a row. **New material** opens a form to create a material and use it right away (see [section 5](#5-materials-db)).
5. **Allowance**: choose a category such as MEP, Concrete Ponding, Future Finish or Solar. Choose **Add new…** to create your own.
6. **Already built a similar type?** Either:
   - **Copy layers from…** another assembly of the same kind and click **Copy**; or
   - **Merge as sub-assembly…** (also offered in the blue "Most similar" banner when the app finds a type with the same structural material and similar thickness). In the dialog pick the assembly to merge with and which one **governs**. The governing assembly's layers apply to both types, and the other becomes its sub-assembly. Open a merged type and click **Unmerge** to undo.

Move on with the buttons at the bottom:

| Button | Effect |
|---|---|
| **Previous** | Back one type |
| **Skip** | Marks the type *Skipped* and moves on |
| **Save & next** | Marks the type *Done* and moves on. On the last type it reads **Finish → type table** |

Merged types are not marked Done or Skipped; they show *Merged*.

### Step 5 — Type table

A read-only summary of every included type: assembly, instances, quantity, dead load in psf and status (To do, Done, Skipped, Merged). Use **Back** to fix anything that looks wrong.

### Step 6 — Plan view

A marked-up plan with a legend table.

- Switch **levels** with the tabs above the plan (Level 2, Roof).
- Each area shows its name and SF; walls are drawn in their assembly colour.
- **Click a legend row, an area or a wall to isolate it**; click **Show all** to clear.
- Expand a legend row (chevron) to see its breakdown.
- The footer shows floor area, wall length and total dead load in kips for the level.

## 5. Materials DB

Lists every material available to assemblies, with category, basis, unit weight and available thicknesses.

- **Search…** filters by name or category.
- Edit a **unit weight** directly in the table. Every assembly that uses the material updates.
- **Add material** opens a form: Name, Category, Weight basis, Unit weight and Thicknesses (inches, comma separated; use `0` when the material has no thickness, such as an allowance).
- Custom materials are tagged *custom* and can be deleted with the bin icon. Built-in materials cannot be deleted.

**Weight basis**

- **PCF**: a density. Layer psf = pcf × thickness (in) ÷ 12. Example: normal-weight concrete 145 pcf × 4.5 in ÷ 12 = 54.4 psf.
- **PSF**: a fixed weight per square foot. Some PSF materials list a different psf for each thickness (for example CMU: 6 in = 41 psf, 8 in = 55 psf).

Changes last only until you reload the page.

## 6. Lateral (wind, snow, seismic)

Gets site loads from the **SkyCiv Load Generator** for any point in the United States, including Alaska and Puerto Rico.

1. **Find the site.** Type an address or place and click **Search**. If several matches appear, click the right one. You can also type latitude and longitude, or pick a point on the map.
2. **Set the criteria**: **Risk category** (I–IV), **Design code** (ASCE 7-22 or ASCE 7-16) and **Site class**. The available site classes depend on the code; if you change the code and the current class is not valid, it resets to D.
3. **Enter your SkyCiv username and API key.** They are kept in this browser tab only and are sent only to `api.skyciv.com`. Each report uses SkyCiv credits.
4. Click **Generate SkyCiv report**.

A coordinate outside the United States and Puerto Rico is refused before anything is sent.

**The report** shows: the site (address, coordinates, elevation); a **Seismic design category** check; **Wind by risk category**; **Snow** values; **Seismic** parameters; and **Response spectra** charts. Any notes from SkyCiv appear as blue banners above the tables. The wind speed shown is the one for the risk category you chose, which can differ from SkyCiv's headline wind speed; a note says so when it does.

The report is kept while you move between pages (so the assistant can read it), but is lost on reload.

## 7. Analytics

A summary of the takeoff across the plan levels:

- **Total dead load** (kips), **Floor area** (SF), **Wall length** (LF);
- **Types reviewed**: included types marked Done or Merged, out of all included types;
- **Materials verified**: included types whose structural material you confirmed;
- **Dead load by assembly**: bars sorted by weight, with psf and quantity.

## 8. Reports

Output formats for the dead load takeoff, each with a title block (project, source model, date).

- **1 · Graphical output**: one plan sheet per level.
- **2 · Spreadsheet**: the assembly breakdown in a spreadsheet layout.
- **Print / PDF** prints the current tab; choose "Save as PDF" in the print dialog for a PDF.
- **Export .xlsx** is shown but disabled in this version.

## 9. Documents

File storage for the project, kept in the database.

- The left panel is the **folder tree**. Click a folder to open it; use the arrows to expand or collapse. The default tree is My Project › Project Documents (3D Models, Markups, Plans) and Calculations. Folder counts include subfolders.
- **Upload**: click **Upload**, or drag files onto the file list. Files go into the open folder. Maximum 200 MB per file.
- **Download / delete one file**: use the icons on its row. Delete asks you to confirm.
- **Several at once**: tick files, or tick folders to include every file inside them. A bar shows how many are selected with **Download** and **Delete** buttons. Bulk download starts one download per file.

## 10. Settings

- **Project name**: appears in Reports and the assistant.
- **Units**: fixed to Imperial (psf, pcf, SF, LF).
- **Model source**: read-only; change it in Gravity › Model.

## 11. Project assistant (Ask)

Click **Ask** at the bottom right. The assistant answers questions about **your current inputs and results**: assemblies and layers, materials, loads by level and assembly, and the Lateral report.

- Type a question and press Enter, or click one of the suggested questions.
- **Move** the window by dragging its title bar. **Resize** it by dragging the grip in its bottom-right corner. Close it with **✕**; the conversation is kept until you reload.
- Each question sends a fresh snapshot of the project, so answers reflect your latest edits.
- It only knows what is in the app. If you have not generated a Lateral report, it will say so and tell you how.
- It does not give engineering sign-off. Verify results yourself.

**Examples**: "What is the total dead load and which assembly contributes most?" · "Break down the psf of the Flat Plate Core." · "Which types are not finished yet?" · "What wind speed did SkyCiv return for risk category III?"

**Setup (once).** The assistant uses an open-source model served over an OpenAI-compatible API. The default is a local Ollama:

```bash
ollama serve
ollama pull llama3.1:8b
```

To use another server or model, set `LLM_BASE_URL`, `LLM_MODEL` and optionally `LLM_API_KEY` in the shell that starts the backend (see `.env.example`). `GET /api/agent/status` tells you whether the model server is reachable.

Answers come from a language model, so they can be wrong. Check any number you rely on against the page it came from.

## 12. How the loads are calculated

| Quantity | Formula |
|---|---|
| Layer weight, PCF material | density (pcf) × thickness (in) ÷ 12 |
| Layer weight, PSF material | the psf for that thickness, or the single psf value |
| Layer weight with an override | the override value |
| Assembly weight (psf) | sum of its layers |
| Floor load (kips) | psf × area (SF) ÷ 1000 |
| Wall load (kips) | psf × wall height (ft) × length (LF) ÷ 1000 |

A merged type uses its governing assembly's layers. Types you un-tick in steps 2 and 3 are left out of all totals. Floor areas and wall lengths come from the plan geometry of each level.

## 13. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Documents page shows an error, or uploads fail | The database or backend is not running. Run `docker compose up -d` and start the backend on port 8100. |
| Gravity steps 2–6 are greyed out | No model chosen. Pick one in step 1 and click **Read … model**. |
| My edits disappeared | Edits to materials, assemblies and settings last only until the page is reloaded. |
| "Enter the SkyCiv username and API key" | Fill in both fields on the Lateral page. |
| "That coordinate is outside the United States and Puerto Rico" | Move the pin or fix the coordinates. |
| SkyCiv returns an error | The message is shown under the buttons. Check the credentials and your credit balance. |
| Ask says it cannot reach the language model | Start the model server (`ollama serve`, then `ollama pull llama3.1:8b`) and try again. |
| Ask says the snapshot is too large | The project data is too big to send. Ask about a smaller part, or tell the developer. |
| Export .xlsx is disabled | Not built yet in this version. Use **Print / PDF**. |
