"""The plant library as data: every entry is well formed, and what was checked against GBIF is recorded and surfaced."""
import collections
import json
from pathlib import Path

import pytest

from app import library
from app.library import AQUATIC, FISH, MUSHROOMS, PLANTS, TAXA

CATS = {"vegetable", "herb", "flower", "fruit_tree", "fruit_shrub", "forest_tree", "wild_edible", "ornamental_tree", "shrub", "climber", "nut_tree", "forest_plant"}


def test_the_library_has_grown_and_every_id_is_unique():
    ids = [p["id"] for p in PLANTS]
    assert len(ids) >= 190 and len(ids) == len(set(ids))
    assert not [i for i in ids if i != i.lower() or " " in i]


@pytest.mark.parametrize("p", PLANTS, ids=lambda p: p["id"])
def test_every_plant_is_well_formed(p):
    assert p["name"] and p["sci"] and p["family"] and p["cats"][0] in CATS, p["id"]
    assert p["native"] in ("native", "naturalised", "introduced") and p["edible"] in ("yes", "parts", "no", "toxic")
    assert p["sun"] in ("full", "full-part", "part", "shade") and p["water"] in ("low", "medium", "high")
    assert 0 < p["height"] <= 60 and 0 < p["spacing"] <= 2000
    for key in ("flower", "harvest", "sow"):
        if p[key] is not None:
            a, b = p[key]
            assert 1 <= a <= 12 and 1 <= b <= 12, (p["id"], key)
    assert p["place"] in ("tree", "bush", "plant") and p["leaf"] in ("deciduous", "evergreen")
    if p["place"] in ("tree", "bush"):
        assert p["canopy"] and p["canopy"] > 0, f"{p['id']}: woody plants need a crown size for the shade model"
    if p["pollination"]:
        assert p["pollination"]["selfFertile"] in ("yes", "no", "partial", "varies") and p["pollination"]["note"]
    if p["zone"] is not None:
        assert 1 <= p["zone"] <= 13
    assert p["notes"] or p["tox"] or p["wildlife"] or p["med"] or p["prop"], f"{p['id']} says nothing useful"


def test_poisonous_plants_new_in_this_version_say_so_in_capitals():
    new = {"rue", "wormwood", "tansy", "sweetpea", "daffodil", "snowdrop", "spindle", "privet", "holly", "horsechestnut", "locust", "datura", "henbane", "hogweed", "arum"}
    by = {p["id"]: p for p in PLANTS}
    for i in new:
        assert by[i]["edible"] == "toxic" and "toxic" in by[i]["cats"] and by[i]["tox"], i
    assert "ALL PARTS" in by["datura"]["tox"] and "ALL PARTS" in by["henbane"]["tox"]
    assert "burns" in by["hogweed"]["tox"] and "burns" in by["parsnip"]["tox"].lower() or "burns" in by["parsnip"]["tox"]


def test_evergreen_woody_plants_are_marked_so_the_shade_model_keeps_them_dense_in_winter():
    by = {p["id"]: p for p in PLANTS}
    for i in ("spruce", "fir", "scotspine", "yew", "juniper", "holly"):
        assert by[i]["leaf"] == "evergreen", i
    assert by["apple"]["leaf"] == "deciduous" and by["goatwillow"]["leaf"] == "deciduous"


def test_invasive_or_risky_plants_are_not_sold_as_harmless():
    by = {p["id"]: p for p in PLANTS}
    assert "invasive" in by["locust"]["notes"].lower() and "invasive" in by["hogweed"]["notes"].lower()
    assert "spreads" in by["jerusalem"]["notes"].lower() and "spreads" in by["horseradish"]["notes"].lower()


def test_dioecious_fruit_says_that_both_sexes_are_needed():
    by = {p["id"]: p for p in PLANTS}
    for i in ("kiwiberry", "holly", "juniper", "asparagus", "seabuckthorn"):
        assert by[i]["pollination"] and ("male" in by[i]["pollination"]["note"].lower()), i


# ------------------------------------------------------------------ what GBIF said
def test_the_check_covers_every_entry_and_is_dated_and_sourced():
    assert TAXA["checkedOn"] and "GBIF" in TAXA["source"]["taxonomy"] and "WCVP" in TAXA["source"]["distribution"]
    for group, items in (("plants", PLANTS), ("aquatic", AQUATIC), ("mushrooms", MUSHROOMS), ("fish", FISH)):
        assert set(TAXA[group]) == {i["id"] for i in items}, f"{group}: run scripts/verify-taxonomy.py after changing the library"


def test_nearly_everything_matched_at_species_level():
    for group, items in (("plants", PLANTS), ("aquatic", AQUATIC), ("mushrooms", MUSHROOMS), ("fish", FISH)):
        missing = [i["id"] for i in items if not i["taxon"]]
        assert len(missing) <= max(1, len(items) // 25), (group, missing)


def test_taxon_records_carry_the_source_ids_and_only_plants_get_romanian_status():
    t = {p["id"]: p["taxon"] for p in PLANTS}["tomato"]
    assert t["gbif"] and t["name"] == "Solanum lycopersicum" and t["family"] == "Solanaceae" and t["status"] == "ACCEPTED" and t["checked"] == TAXA["checkedOn"]
    assert t["ro"]["verdict"] == "introduced" and t["ro"]["introduced"]
    oak = {p["id"]: p["taxon"] for p in PLANTS}["oak"]
    assert oak["ro"]["verdict"] == "native" and oak["ro"]["native"]
    assert all("ro" not in m["taxon"] for m in MUSHROOMS if m["taxon"]) and all("ro" not in f["taxon"] for f in FISH if f["taxon"])


def test_where_gbif_has_another_accepted_name_it_is_shown_not_silently_applied():
    by = {p["id"]: p for p in PLANTS}
    assert by["pea"]["sci"] == "Pisum sativum" and by["pea"]["taxon"]["status"] == "SYNONYM" and by["pea"]["taxon"]["acceptedName"] == "Lathyrus oleraceus"
    assert by["servicetree"]["sci"] == "Sorbus domestica" and by["servicetree"]["taxon"]["status"] == "SYNONYM" and by["servicetree"]["taxon"]["acceptedName"]
    assert "acceptedName" not in by["tomato"]["taxon"]


def test_the_library_payload_carries_the_check_and_its_source():
    p = library.payload()
    assert p["taxaSource"]["checkedOn"] == TAXA["checkedOn"] and "GBIF" in p["taxaSource"]["taxonomy"]
    assert all("taxon" in x for x in p["plants"] + p["aquatic"] + p["mushrooms"] + p["fish"])
    assert "Names are checked, growing advice is not" in p["disclaimers"]["data"]


def test_the_stored_check_file_is_plain_json_with_no_secrets():
    raw = Path(library.__file__).with_name("library_taxa.json").read_text(encoding="utf-8")
    json.loads(raw)
    assert "@" not in raw and "key=" not in raw.lower()


def test_romanian_checklists_are_only_counted_from_real_checklists():
    names = collections.Counter(s for g in ("plants", "aquatic") for r in TAXA[g].values() for s in (r.get("ro") or {}).get("native", []) + (r.get("ro") or {}).get("introduced", []))
    assert set(names) <= {"WCVP", "Checklist of introduced taxa in Romania", "Catalogue of Life", "DAISIE"}
