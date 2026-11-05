"""Checks the plant library against GBIF and writes backend/app/library_taxa.json (needs internet; run it when the library changes).

For every plant, aquatic plant, mushroom and fish it asks the GBIF Backbone Taxonomy (CC0) for the accepted scientific name, family and
status. For plants it also reads the GBIF species distribution records for Romania (World Checklist of Vascular Plants, the checklist
of introduced taxa in Romania, Catalogue of Life) and records whether they call the plant native, introduced or both.

Nothing is changed in the library by this script: it prints every place where the library and GBIF disagree so a person can decide.
Usage (from the project folder):  backend\\.venv\\Scripts\\python.exe scripts\\verify-taxonomy.py
"""
import asyncio
import json
import re
import sys
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app import library  # noqa: E402

OUT = ROOT / "backend" / "app" / "library_taxa.json"
GBIF = "https://api.gbif.org/v1"
UA = "EdenSmartEstate/1.3 (+https://github.com/unupunct/Eden-Smart-Estate; library check)"


# names GBIF only recognises with the author attached (a bare name matches a genus or a phylum)
AUTHOR_NAMES = {"Elodea canadensis": "Elodea canadensis Michx.", "Prunus dulcis": "Prunus dulcis (Mill.) D.A.Webb"}


def clean(name: str) -> str:
    if name in AUTHOR_NAMES:
        return AUTHOR_NAMES[name]
    n = name.split(" / ")[0].replace(" agg.", "").replace(" x ", " × ").strip()
    return re.sub(r"\s+", " ", n)


def source_label(s: str) -> str | None:
    """Only real regional checklists count; a record from some other database that merely mentions Romania is ignored."""
    if "World Checklist" in s:
        return "WCVP"
    if "introduced taxa in Romania" in s:
        return "Checklist of introduced taxa in Romania"
    if "Catalogue of Life" in s:
        return "Catalogue of Life"
    if "DAISIE" in s:
        return "DAISIE"
    return None


RO = re.compile(r"(?:^|[;,(]\s*)Romania(?:\s*\[(\w)\])?(?=\s*(?:[;,)]|$))")


def romania_flags(records: list[dict]) -> dict:
    native, intro, casual = set(), set(), set()
    for r in records:
        loc = (r.get("locality") or "").strip()
        src = source_label(r.get("source") or "")
        if src is None:
            continue
        es = (r.get("establishmentMeans") or "").upper()
        if loc.lower() == "romania" or loc.lower().startswith("romania "):
            (intro if es in ("INTRODUCED", "NATURALISED", "INVASIVE") else casual if es == "CASUAL" else native).add(src)
            continue
        m = RO.search(loc)
        if m:
            flag = m.group(1)
            (intro if flag == "I" else casual if flag == "c" else native).add(src)
    verdict = "unknown"
    if native and intro:
        verdict = "conflict"
    elif native:
        verdict = "native"
    elif intro:
        verdict = "introduced"
    elif casual:
        verdict = "casual"
    return {"verdict": verdict, "native": sorted(native), "introduced": sorted(intro), "casual": sorted(casual)}


async def one(client: httpx.AsyncClient, sem: asyncio.Semaphore, name: str, kingdom: str, want_ro: bool) -> dict:
    async with sem:
        for attempt in range(3):
            try:
                m = (await client.get(f"{GBIF}/species/match", params={"name": clean(name), "kingdom": kingdom, "verbose": "false"})).json()
                break
            except (httpx.HTTPError, ValueError):
                await asyncio.sleep(1 + attempt)
        else:
            return {"error": "unreachable"}
        if m.get("matchType") in ("HIGHERRANK", "NONE") or not m.get("usageKey"):
            # a name with a rank below species that GBIF does not know: ask for the species, then for the genus-and-species words only
            for alt in (" ".join(clean(name).split()[:2]), clean(name).split(" subsp.")[0].split(" var.")[0]):
                try:
                    m2 = (await client.get(f"{GBIF}/species/match", params={"name": alt, "kingdom": kingdom, "strict": "true"})).json()
                except (httpx.HTTPError, ValueError):
                    continue
                if m2.get("usageKey") and m2.get("matchType") not in ("HIGHERRANK", "NONE"):
                    m = m2
                    break
        if not m.get("usageKey") or m.get("matchType") == "NONE":
            return {"match": "NONE"}
        out = {"gbif": m["usageKey"], "name": m.get("canonicalName") or m.get("scientificName"), "authorship": (m.get("scientificName") or "").replace(m.get("canonicalName") or "", "").strip(),
               "family": m.get("family"), "status": m.get("status"), "match": m.get("matchType"), "rank": m.get("rank"), "confidence": m.get("confidence")}
        if m.get("acceptedUsageKey") and m.get("acceptedUsageKey") != m.get("usageKey"):
            try:
                acc = (await client.get(f"{GBIF}/species/{m['acceptedUsageKey']}")).json()
                out["acceptedKey"] = acc.get("key")
                out["acceptedName"] = acc.get("canonicalName")
                out["acceptedFamily"] = acc.get("family")
            except (httpx.HTTPError, ValueError):
                out["acceptedKey"] = m.get("acceptedUsageKey")
        if want_ro:
            key = m.get("speciesKey") or m.get("acceptedUsageKey") or m["usageKey"]
            recs, off = [], 0
            while True:
                try:
                    d = (await client.get(f"{GBIF}/species/{key}/distributions", params={"limit": 300, "offset": off})).json()
                except (httpx.HTTPError, ValueError):
                    break
                recs += d.get("results", [])
                if d.get("endOfRecords", True) or off > 3000:
                    break
                off += 300
            out["ro"] = romania_flags(recs)
        return out


async def main() -> None:
    sets = {
        "plants": ([(p["id"], p["sci"]) for p in library.PLANTS], "Plantae", True),
        "aquatic": ([(p["id"], p["sci"]) for p in library.AQUATIC], "Plantae", True),
        "mushrooms": ([(p["id"], p["sci"]) for p in library.MUSHROOMS], "Fungi", False),
        "fish": ([(p["id"], p["sci"]) for p in library.FISH], "Animalia", False),
    }
    result: dict = {"checkedOn": date.today().isoformat(), "source": {
        "taxonomy": "GBIF Backbone Taxonomy (CC0), api.gbif.org",
        "distribution": "GBIF species distribution records for Romania: World Checklist of Vascular Plants (WCVP), Checklist of introduced taxa in Romania, Catalogue of Life"}}
    sem = asyncio.Semaphore(6)
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": UA}) as client:
        for group, (items, kingdom, want_ro) in sets.items():
            rows = await asyncio.gather(*(one(client, sem, sci, kingdom, want_ro) for _id, sci in items))
            result[group] = {i: r for (i, _sci), r in zip(items, rows)}
            print(f"{group}: {len(items)} checked")
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print("wrote", OUT)

    # ---- report: where the library and GBIF disagree
    curated = {p["id"]: p for p in library.PLANTS}
    problems = []
    for group in ("plants", "aquatic", "mushrooms", "fish"):
        src = {"plants": library.PLANTS, "aquatic": library.AQUATIC, "mushrooms": library.MUSHROOMS, "fish": library.FISH}[group]
        for p in src:
            r = result[group][p["id"]]
            tag = f"{group}/{p['id']} ({p['sci']})"
            if r.get("error") or r.get("match") == "NONE" or "gbif" not in r:
                problems.append(f"NO MATCH   {tag}")
                continue
            if r["match"] not in ("EXACT",) or r.get("rank") not in ("SPECIES", "VARIETY", "SUBSPECIES", "FORM"):
                problems.append(f"{r['match']:10} {tag} -> {r['name']} [{r['status']}, {r['rank']}]")
            elif r["status"] != "ACCEPTED" and " var." not in p["sci"] and " subsp." not in p["sci"]:
                problems.append(f"{r['status']:10} {tag} -> accepted name is another one")
            if group == "plants" and r.get("family") and p.get("family") and r["family"] != p["family"]:
                problems.append(f"FAMILY     {tag}: library {p['family']}, GBIF {r['family']}")
            if group == "plants" and "ro" in r:
                v, cur = r["ro"]["verdict"], curated[p["id"]]["native"]
                if v == "introduced" and cur == "native":
                    problems.append(f"NATIVE?    {tag}: library says native, GBIF checklists say introduced in Romania ({', '.join(r['ro']['introduced'])})")
                if v == "native" and cur == "introduced":
                    problems.append(f"NATIVE?    {tag}: library says introduced, GBIF checklists say native in Romania ({', '.join(r['ro']['native'])})")
                if v == "conflict" and cur == "native":
                    problems.append(f"CONFLICT   {tag}: library native; checklists disagree among themselves")
    print(f"\n{len(problems)} differences to look at:")
    print("\n".join(problems))
    unknown = [i for i, r in result["plants"].items() if r.get("ro", {}).get("verdict") == "unknown"]
    print(f"\nRomania status unknown in the checklists for {len(unknown)} plants: {', '.join(unknown)}")


asyncio.run(main())
