from app import library
from app.library_other import AQUATIC, COMPANIONS, FISH, MUSHROOMS
from app.library_plants import PLANTS

REL_TYPES = {"beneficial", "pest", "nutrient", "compatible", "conditional", "incompatible"}
EVIDENCE = {"documented", "mixed", "traditional"}
FRUIT = ("apple", "pear", "plum", "cherry", "sourcherry", "peach", "apricot", "walnut", "hazelnut", "quince", "mulberry", "fig")


def test_ids_are_unique_everywhere():
    for rows in (PLANTS, AQUATIC, FISH, MUSHROOMS):
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids))
        assert all(i.isalnum() and i == i.lower() for i in ids), ids


def test_plants_have_sane_fields():
    for p in PLANTS:
        assert p["name"] and p["sci"] and p["family"], p["id"]
        assert p["native"] in {"native", "naturalised", "introduced"}, p["id"]
        assert p["edible"] in {"yes", "parts", "no", "toxic"}, p["id"]
        assert p["water"] in {"low", "medium", "high"}, p["id"]
        assert p["sun"] in {"full", "full-part", "part", "shade"}, p["id"]
        assert p["place"] in {"tree", "bush", "plant"}, p["id"]
        assert p["height"] > 0 and p["spacing"] > 0, p["id"]
        for key in ("flower", "harvest", "sow"):
            if p[key]:
                assert len(p[key]) == 2 and all(1 <= m <= 12 for m in p[key]), (p["id"], key)
        if p["place"] == "tree":
            assert p["canopy"], p["id"]


def test_toxic_plants_always_carry_a_warning():
    for p in PLANTS:
        if p["edible"] == "toxic":
            assert "toxic" in p["cats"] and p["tox"], p["id"]
            assert any(w in p["tox"].upper() for w in ("POISON", "DEADLY")), p["id"]
        if "toxic" in p["cats"]:
            assert p["tox"] and p["edible"] == "toxic", p["id"]
        if p["edible"] == "yes" and p["tox"]:
            assert "toxic" not in p["cats"], p["id"]  # caution only, not filed under toxic plants


def test_medicinal_entries_are_marked_traditional_and_risky_ones_warned():
    meds = [p for p in PLANTS if p["med"]]
    assert len(meds) >= 8
    for p in meds:
        assert "medicinal" in p["cats"]
        assert "raditional" in p["med"], p["id"]
    for pid in ("stjohnswort", "comfrey", "sage"):
        assert next(p for p in PLANTS if p["id"] == pid)["tox"], pid


def test_wild_garlic_look_alikes_are_called_out():
    wg = next(p for p in PLANTS if p["id"] == "wildgarlic")
    assert "lily of the valley" in wg["tox"].lower() and "autumn crocus" in wg["tox"].lower()


def test_companions_reference_real_plants_and_are_not_duplicated():
    ids = {p["id"] for p in PLANTS}
    seen = set()
    for c in COMPANIONS:
        assert c["a"] in ids and c["b"] in ids, c
        assert c["a"] != c["b"], c
        assert c["type"] in REL_TYPES, c
        assert c["evidence"] in EVIDENCE, c
        assert len(c["note"]) > 20, c
        key = frozenset((c["a"], c["b"]))
        assert key not in seen, f"duplicate pair {c['a']}/{c['b']}"
        seen.add(key)


def test_tradition_is_not_presented_as_established_science():
    basil = next(c for c in COMPANIONS if {c["a"], c["b"]} == {"tomato", "basil"})
    assert basil["evidence"] == "traditional"
    marigold = next(c for c in COMPANIONS if {c["a"], c["b"]} == {"tomato", "marigold"})
    assert marigold["evidence"] == "documented" and "nematode" in marigold["note"].lower()


def test_tomato_has_companions_and_known_conflicts():
    pairs = {frozenset((c["a"], c["b"])): c for c in COMPANIONS}
    assert pairs[frozenset(("tomato", "potato"))]["type"] == "incompatible"
    assert pairs[frozenset(("tomato", "walnut"))]["type"] == "incompatible"
    friends = [c for c in COMPANIONS if "tomato" in (c["a"], c["b"]) and c["type"] in {"beneficial", "pest", "compatible"}]
    assert len(friends) >= 4


def test_every_requested_fruit_tree_exists_with_pollination_info():
    byid = {p["id"]: p for p in PLANTS}
    for pid in FRUIT:
        p = byid[pid]
        assert p["pollination"]["selfFertile"] in {"yes", "no", "partial", "varies"}, pid
        assert p["pollination"]["note"], pid


def test_aquatic_data_flags_invasives_and_covers_all_zones():
    avoid = {a["id"] for a in AQUATIC if a["avoid"]}
    assert {"crassula", "parrotsfeather", "waterhyacinth", "elodea"} <= avoid
    assert {"oxygenating", "floating", "marginal", "shallow", "deep"} <= {a["zone"] for a in AQUATIC}
    assert all(a["depthCm"][0] <= a["depthCm"][1] for a in AQUATIC)


def test_fish_suitability_is_honest():
    by = {f["id"]: f for f in FISH}
    assert by["koi"]["nsp"] == "unsuitable" and by["grasscarp"]["nsp"] == "unsuitable"
    assert by["goldfish"]["nsp"] in {"not_recommended", "unsuitable"}
    assert all(f["nsp"] in {"suitable", "conditional", "not_recommended", "unsuitable"} for f in FISH)
    assert all(f["warning"] for f in FISH if f["nsp"] != "suitable")


def test_mushrooms_warn_loudly():
    assert {m["status"] for m in MUSHROOMS} >= {"edible", "edible_cooked", "poisonous", "deadly"}
    for m in MUSHROOMS:
        assert m["status"] in {"edible", "edible_cooked", "inedible", "poisonous", "deadly"}
        assert m["warning"] and m["lookalikes"], m["id"]
        assert all(1 <= x <= 12 for x in m["season"]), m["id"]
        if m["status"] in {"poisonous", "deadly"}:
            assert m["warning"].startswith(("DEADLY", "POISONOUS", "Toxic")), m["id"]
            assert m["cultivation"] == "none"
    deadly = {m["id"] for m in MUSHROOMS if m["status"] == "deadly"}
    assert {"deathcap", "destroyingangel", "galerina", "orellanus", "falsemorel"} <= deadly
    morel = next(m for m in MUSHROOMS if m["id"] == "morel")
    assert "NEVER eat raw" in morel["warning"] and "false morel" in morel["lookalikes"].lower()
    assert {m["id"] for m in MUSHROOMS if m["cultivation"] != "none"} >= {"oyster", "shiitake"}


def test_payload_and_endpoint():
    p = library.payload()
    assert "NEVER eat" in p["disclaimers"]["mushrooms"] and "TRADITIONAL" in p["disclaimers"]["medicinal"]
    assert len(p["plants"]) >= 70 and len(p["mushrooms"]) >= 20 and len(p["companions"]) >= 40
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        r = c.get("/api/library")
    assert r.status_code == 200 and r.json()["plants"][0]["id"] == "tomato"


def test_demo_only_references_species_that_exist_and_shows_a_conflict(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    from app.main import app
    ids = {p["id"] for p in PLANTS} | {a["id"] for a in AQUATIC}
    fish = {f["id"] for f in FISH}
    with TestClient(app) as c:
        pid = c.post("/api/demo").json()["id"]
        objs = c.get(f"/api/properties/{pid}").json()["objects"]
    used = set()
    pairs = set()
    for o in objs:
        p = o["props"]
        if p.get("speciesId"):
            assert p["speciesId"] in ids, p["speciesId"]
        for pl in p.get("plantings", []):
            assert pl["speciesId"] in ids, pl["speciesId"]
            used.add(pl["speciesId"])
        for f in p.get("fish", []):
            assert f["speciesId"] in fish
        kinds = {x["speciesId"] for x in p.get("plantings", [])}
        if {"potato", "tomato"} <= kinds:
            pairs.add("conflict")
    assert pairs == {"conflict"}
    kinds = {o["kind"] for o in objs}
    assert {"gh_bed", "gh_heater", "pond_pump", "pond_stream", "plant"} <= kinds


def test_woody_plants_say_whether_they_keep_their_leaves():
    """The shadow model needs to know which trees shade in winter."""
    leaf = {p["id"]: p["leaf"] for p in PLANTS}
    assert set(leaf.values()) == {"deciduous", "evergreen"}
    for pid in ("spruce", "fir", "scotspine", "yew"):
        assert leaf[pid] == "evergreen"
    for pid in ("apple", "walnut", "oak", "birch", "linden"):
        assert leaf[pid] == "deciduous"
